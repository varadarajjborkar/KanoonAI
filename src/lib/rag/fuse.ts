import type { RetrievalHit } from '../types.ts';
import { cosine } from './embed.ts';

/**
 * Reciprocal Rank Fusion.
 *
 * BM25 scores and cosine similarities are not on the same scale and normalising
 * them is fragile (one outlier squashes the whole list). RRF only uses rank, so
 * it fuses the two channels without any calibration.
 */
export function rrf(
  lists: Array<{ hits: RetrievalHit[]; weight: number }>,
  k: number,
): RetrievalHit[] {
  const acc = new Map<string, RetrievalHit & { fused: number }>();
  for (const { hits, weight } of lists) {
    if (weight <= 0) continue;
    hits.forEach((hit, rank) => {
      const prev = acc.get(hit.chunk.id);
      const contrib = weight * (1 / (k + rank + 1));
      if (prev) {
        prev.fused += contrib;
        prev.bm25 = prev.bm25 ?? hit.bm25;
        prev.dense = prev.dense ?? hit.dense;
      } else {
        acc.set(hit.chunk.id, { ...hit, fused: contrib });
      }
    });
  }
  return [...acc.values()]
    .map((h) => ({ ...h, score: h.fused }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Fuse alternative phrasings of the SAME question by best rank.
 *
 * RRF sums reciprocal ranks, which is right for combining different retrievers
 * but wrong for combining paraphrases of one need: a chunk that a single good
 * rewrite nails at rank 1 scores 1/(k+1), while a chunk that four rewrites all
 * put at rank 5 scores 4/(k+5) and wins. Measured on the gold set, that is
 * exactly how "builder delay" (target at rank 1 for one phrasing) fell out of
 * the top 8. Taking each chunk's best rank across phrasings keeps the specific
 * hit and still lets every rewrite contribute candidates.
 */
export function fuseByBestRank(lists: RetrievalHit[][]): RetrievalHit[] {
  const best = new Map<string, { hit: RetrievalHit; rank: number }>();
  for (const hits of lists) {
    hits.forEach((hit, rank) => {
      const prev = best.get(hit.chunk.id);
      if (!prev || rank < prev.rank) best.set(hit.chunk.id, { hit, rank });
    });
  }
  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || b.hit.score - a.hit.score)
    .map((e) => e.hit);
}

/**
 * Best-rank fusion, but judged on absolute score rather than position.
 *
 * Pure best-rank has a sharp edge: a weak paraphrase still has a rank-1 result,
 * and that junk then tops the fused list. On the gold set this is exactly why
 * "company removed me from job without notice" surfaced a bailment section of
 * the Contract Act. Absolute BM25 score does not have that problem, because a
 * paraphrase that matched nothing rare scores low even at its own rank 1.
 */
export function fuseByBestScore(lists: RetrievalHit[][]): RetrievalHit[] {
  const best = new Map<string, RetrievalHit>();
  for (const hits of lists) {
    for (const hit of hits) {
      const prev = best.get(hit.chunk.id);
      if (!prev || hit.score > prev.score) best.set(hit.chunk.id, hit);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * Weighted RRF across paraphrases: keeps multi-query voting (which is robust to
 * any single bad rewrite) while letting the user's own words count for most.
 */
export function fuseWeightedQueries(
  lists: RetrievalHit[][],
  rrfK: number,
  decay: number,
): RetrievalHit[] {
  return rrf(
    lists.map((hits, i) => ({ hits, weight: Math.pow(decay, i) })),
    rrfK,
  );
}

/**
 * Maximal Marginal Relevance.
 *
 * Statutes repeat themselves and contracts restate the same clause in three
 * places; without MMR the top-k is often the same paragraph five times over.
 */
export function mmr(
  hits: RetrievalHit[],
  queryVec: Float32Array | null,
  vectors: Map<string, Float32Array>,
  k: number,
  lambda: number,
): RetrievalHit[] {
  if (lambda >= 1 || hits.length <= 1) return hits.slice(0, k);

  const selected: RetrievalHit[] = [];
  const pool = [...hits];
  const maxScore = hits[0]?.score || 1;

  while (selected.length < k && pool.length) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      const rel = cand.score / maxScore;
      const cv = vectors.get(cand.chunk.id);
      let redundancy = 0;
      for (const s of selected) {
        const sv = vectors.get(s.chunk.id);
        redundancy = Math.max(
          redundancy,
          cv && sv ? cosine(cv, sv) : jaccard(cand.chunk.text, s.chunk.text),
        );
      }
      const val = lambda * rel - (1 - lambda) * redundancy;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    selected.push(pool.splice(bestIdx, 1)[0]);
  }
  void queryVec;
  return selected;
}

/** Cheap textual overlap, used when we have no vectors to compare with. */
function jaccard(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const sb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}
