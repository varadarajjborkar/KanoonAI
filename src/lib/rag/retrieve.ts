import type { Chunk, RetrievalHit } from '../types.ts';
import { BM25Index } from './bm25.ts';
import { cosine, dequantise, type Embedder } from './embed.ts';
import { fuseByBestRank, fuseByBestScore, fuseWeightedQueries, mmr, rrf } from './fuse.ts';
import type { RagParams } from './params.ts';

/**
 * The retrieval pipeline. Isomorphic on purpose: the browser runs it against
 * IndexedDB, and scripts/eval/sweep.mjs runs the exact same code against the
 * gold set, so a number from the sweep means something in the product.
 *
 *   queries -> [BM25 | dense] -> RRF -> score floor -> MMR -> neighbours -> budget
 */

export interface RetrieveInput {
  queries: string[];
  chunks: Chunk[];
  params: RagParams;
  embedder?: Embedder | null;
  /** Optional LLM re-ranker; skipped when params.useReranker is false. */
  rerank?: (query: string, hits: RetrievalHit[]) => Promise<RetrievalHit[]>;
  /** Reuse an index across queries instead of rebuilding it every keystroke. */
  index?: BM25Index | null;
}

export interface RetrieveResult {
  hits: RetrievalHit[];
  context: string;
  stats: {
    indexed: number;
    lexicalHits: number;
    denseHits: number;
    fused: number;
    afterFloor: number;
    returned: number;
    contextChars: number;
    denseEnabled: boolean;
  };
}

export async function retrieve(input: RetrieveInput): Promise<RetrieveResult> {
  const { chunks, params: p } = input;
  const queries = input.queries.filter((q) => q.trim().length > 0).slice(0, 1 + p.multiQuery);

  const empty: RetrieveResult = {
    hits: [],
    context: '',
    stats: {
      indexed: chunks.length,
      lexicalHits: 0,
      denseHits: 0,
      fused: 0,
      afterFloor: 0,
      returned: 0,
      contextChars: 0,
      denseEnabled: false,
    },
  };
  if (!chunks.length || !queries.length) return empty;

  /* ---------------------------------------------------------- lexical */
  const bm25 = input.index ?? new BM25Index(chunks, p.bm25K1, p.bm25B, p.headingWeight);
  const rawLexical = queries.map((q) => bm25.search(q, p.candidateK));
  const lexicalHits = new Set(rawLexical.flat().map((h) => h.chunk.id)).size;
  // Collapse the paraphrases into one ranking before they meet the dense channel.
  const lexicalLists = collapseQueries(rawLexical, p);

  /* ------------------------------------------------------------ dense */
  const vectors = new Map<string, Float32Array>();
  let denseLists: RetrievalHit[][] = [];
  let denseEnabled = false;

  if (input.embedder && p.lexicalWeight < 1) {
    // Vectors already computed at ingest/build time are reused; only chunks that
    // are missing one get encoded, which keeps repeat queries free.
    const missing: Chunk[] = [];
    for (const c of chunks) {
      const v = dequantise(c.vec);
      if (v) vectors.set(c.id, v);
      else missing.push(c);
    }
    try {
      if (missing.length) {
        const encoded = await input.embedder.encode(missing.map((c) => c.text));
        missing.forEach((c, i) => encoded[i] && vectors.set(c.id, encoded[i]));
      }
      const qVecs = await input.embedder.encode(queries);
      const rawDense = qVecs.map((qv) => {
        const scored: RetrievalHit[] = [];
        for (const c of chunks) {
          const cv = vectors.get(c.id);
          if (!cv) continue;
          scored.push({ chunk: c, score: cosine(qv, cv), dense: cosine(qv, cv) });
        }
        return scored.sort((a, b) => b.score - a.score).slice(0, p.candidateK);
      });
      denseLists = collapseQueries(rawDense, p);
      denseEnabled = true;
    } catch {
      // Embedding endpoint down => lexical-only. Better a good BM25 answer than none.
      denseLists = [];
      denseEnabled = false;
    }
  }

  /* ------------------------------------------------------------- fuse */
  const lists = [
    ...lexicalLists.map((hits) => ({ hits, weight: p.lexicalWeight })),
    ...denseLists.map((hits) => ({ hits, weight: 1 - p.lexicalWeight })),
  ];
  let fused = rrf(lists, p.rrfK);

  // A clause from the document in front of the user beats a generic statute.
  if (p.userDocBoost !== 1) {
    fused = fused
      .map((h) => (h.chunk.source === 'user' ? { ...h, score: h.score * p.userDocBoost } : h))
      .sort((a, b) => b.score - a.score);
  }
  const fusedCount = fused.length;

  /* ------------------------------------------------------ score floor */
  const best = fused[0]?.score ?? 0;
  let kept = p.minScoreRatio > 0 ? fused.filter((h) => h.score >= best * p.minScoreRatio) : fused;
  const afterFloor = kept.length;

  /* --------------------------------------------------------- re-rank */
  if (p.useReranker && input.rerank && kept.length > 1) {
    try {
      kept = await input.rerank(queries[0], kept.slice(0, p.rerankTop));
    } catch {
      /* re-ranker is an optimisation, never a hard dependency */
    }
  }

  /* ------------------------------------------------------------- MMR */
  let selected = mmr(kept, null, vectors, p.topK, p.mmrLambda);

  /* ------------------------------------------------------ neighbours */
  if (p.neighborWindow > 0) {
    const byDoc = new Map<string, Chunk[]>();
    for (const c of chunks) {
      const arr = byDoc.get(c.docId) ?? [];
      arr.push(c);
      byDoc.set(c.docId, arr);
    }
    for (const arr of byDoc.values()) arr.sort((a, b) => a.ordinal - b.ordinal);

    const have = new Set(selected.map((h) => h.chunk.id));
    const extra: RetrievalHit[] = [];
    for (const hit of selected) {
      const siblings = byDoc.get(hit.chunk.docId) ?? [];
      const at = siblings.findIndex((c) => c.id === hit.chunk.id);
      for (let d = 1; d <= p.neighborWindow; d++) {
        for (const n of [siblings[at - d], siblings[at + d]]) {
          if (n && !have.has(n.id)) {
            have.add(n.id);
            // Neighbours are context, not evidence - they rank strictly below.
            extra.push({ chunk: n, score: hit.score * 0.35 });
          }
        }
      }
    }
    selected = [...selected, ...extra];
  }

  /* ---------------------------------------------------- token budget */
  const parts: string[] = [];
  const final: RetrievalHit[] = [];
  let used = 0;
  for (const hit of selected) {
    const label = citationLabel(hit.chunk, final.length + 1);
    const body = `${label}\n${hit.chunk.text}`;
    if (used + body.length > p.maxContextChars && final.length > 0) break;
    parts.push(body);
    final.push(hit);
    used += body.length;
  }

  return {
    hits: final,
    context: parts.join('\n\n---\n\n'),
    stats: {
      indexed: chunks.length,
      lexicalHits,
      denseHits: new Set(denseLists.flat().map((h) => h.chunk.id)).size,
      fused: fusedCount,
      afterFloor,
      returned: final.length,
      contextChars: used,
      denseEnabled,
    },
  };
}

/**
 * The rewritten queries are alternative phrasings of one question, not
 * independent retrievers, so how they are combined is its own decision - and a
 * measurably important one. See eval/report.md for the comparison.
 */
function collapseQueries(lists: RetrievalHit[][], p: RagParams): RetrievalHit[][] {
  if (lists.length <= 1) return lists;
  switch (p.queryFusion) {
    case 'best':
      return [fuseByBestRank(lists)];
    case 'best-score':
      return [fuseByBestScore(lists)];
    case 'weighted':
      return [fuseWeightedQueries(lists, p.rrfK, p.queryDecay)];
    default:
      return lists;
  }
}

export function citationLabel(c: Chunk, n: number): string {
  const bits = [c.title];
  if (c.ref) bits.push(c.ref);
  if (c.page) bits.push(`p.${c.page}`);
  const origin = c.source === 'user' ? 'YOUR DOCUMENT' : 'INDIAN LAW';
  return `[${n}] (${origin}) ${bits.join(' - ')}`;
}
