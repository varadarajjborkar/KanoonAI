/**
 * Shared machinery for the retrieval evaluation.
 *
 * It re-chunks the corpus from source for every chunking configuration, so a
 * sweep over chunkSize/overlap measures what it claims to measure rather than
 * re-scoring one fixed index. Chunk sets are cached by their chunking signature
 * because that is the expensive part.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chunkDocument } from '../../src/lib/rag/chunk.ts';
import { BM25Index } from '../../src/lib/rag/bm25.ts';
import { HashingEncoder, quantise } from '../../src/lib/rag/embed.ts';
import { retrieve } from '../../src/lib/rag/retrieve.ts';
import { withParams } from '../../src/lib/rag/params.ts';

const ACTS_DIR = 'data/corpus/acts';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let rawActs = null;
function loadActs() {
  if (rawActs) return rawActs;
  if (!fs.existsSync(ACTS_DIR)) {
    throw new Error(`${ACTS_DIR} not found. Run: npm run corpus:fetch`);
  }
  rawActs = fs
    .readdirSync(ACTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(ACTS_DIR, f), 'utf8')));
  return rawActs;
}

const chunkCache = new Map();
const encoder = new HashingEncoder(512);

/** Chunk + vectorise the whole corpus for one chunking configuration. */
export function buildCorpus(params) {
  const key = `${params.chunkSize}|${params.chunkOverlap}|${params.structureAware}`;
  const cached = chunkCache.get(key);
  if (cached) return cached;

  const chunks = [];
  for (const act of loadActs()) {
    const pages = act.sections.map((s, i) => ({
      page: i + 1,
      text: s.section ? `Section ${s.section}. ${s.text}` : s.text,
    }));
    const produced = chunkDocument(
      { docId: `corpus:${slug(act.name)}`, title: act.name, source: 'corpus', text: '', pages },
      params,
    ).map((c) => {
      const section = act.sections[(c.page ?? 1) - 1]?.section;
      const { page, ...rest } = c;
      void page;
      return section ? { ...rest, ref: `S. ${section}` } : rest;
    });
    chunks.push(...produced);
  }

  for (const c of chunks) c.vec = quantise(encoder.encodeOne(c.text));
  const built = { chunks };
  chunkCache.set(key, built);
  return built;
}

const indexCache = new Map();
function getIndex(chunks, params) {
  const key = `${chunks.length}|${params.chunkSize}|${params.chunkOverlap}|${params.structureAware}|${params.bm25K1}|${params.bm25B}|${params.headingWeight}`;
  let idx = indexCache.get(key);
  if (!idx) {
    idx = new BM25Index(chunks, params.bm25K1, params.bm25B, params.headingWeight);
    indexCache.set(key, idx);
  }
  return idx;
}

/** A hit counts only if it is the right Act AND the right section. */
function isRelevant(chunk, relevant) {
  return relevant.some(
    (r) => chunk.title === r.act && (r.refs.length === 0 || r.refs.includes(chunk.ref)),
  );
}

function dcg(gains) {
  return gains.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0);
}

/**
 * Run the full batch under one parameter set.
 *
 * The objective deliberately charges for context: recall is trivial to buy by
 * raising topK, and a bigger context costs the user latency, money and - the
 * part that actually matters here - the model's attention. So the sweep has to
 * find genuine gains, not just a bigger k.
 */
export async function evaluate(batch, paramOverrides, opts = {}) {
  const params = withParams(paramOverrides);
  const { chunks } = buildCorpus(params);
  const index = getIndex(chunks, params);

  const perQuery = [];
  let totalMs = 0;

  for (const item of batch) {
    const queries = opts.queryExpansion?.(item, params.multiQuery, params.useTerms) ?? [item.query];
    const t0 = performance.now();
    const result = await retrieve({
      queries,
      chunks,
      params,
      index,
      embedder: params.lexicalWeight < 1 ? encoder : null,
      rerank: opts.rerank,
    });
    totalMs += performance.now() - t0;

    const flags = result.hits.map((h) => (isRelevant(h.chunk, item.relevant) ? 1 : 0));
    const firstRank = flags.indexOf(1);

    // How many of the expected (act, section) pairs were actually surfaced.
    const wanted = item.relevant.flatMap((r) => r.refs.map((ref) => `${r.act}|${ref}`));
    const found = new Set(
      result.hits
        .map((h) => `${h.chunk.title}|${h.chunk.ref}`)
        .filter((k) => wanted.includes(k)),
    );

    const ideal = dcg(new Array(Math.min(wanted.length, params.topK)).fill(1));
    perQuery.push({
      id: item.id,
      hit: firstRank >= 0 ? 1 : 0,
      rr: firstRank >= 0 ? 1 / (firstRank + 1) : 0,
      ndcg: ideal > 0 ? dcg(flags) / ideal : 0,
      precision: flags.length ? flags.reduce((a, b) => a + b, 0) / flags.length : 0,
      coverage: wanted.length ? found.size / wanted.length : 0,
      contextChars: result.stats.contextChars,
      returned: result.stats.returned,
    });
  }

  const mean = (k) => perQuery.reduce((a, q) => a + q[k], 0) / (perQuery.length || 1);
  const avgContext = mean('contextChars');
  const hit = mean('hit');
  const mrr = mean('rr');

  return {
    hit,
    mrr,
    ndcg: mean('ndcg'),
    precision: mean('precision'),
    coverage: mean('coverage'),
    avgContext,
    avgReturned: mean('returned'),
    msPerQuery: totalMs / (batch.length || 1),
    // 0.08 is the price of a full context window, in units of hit-rate.
    objective: 0.6 * hit + 0.4 * mrr - 0.08 * (avgContext / 24000),
    perQuery,
    chunkCount: chunks.length,
  };
}

export function fmt(n, d = 3) {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

export function loadBatch() {
  return JSON.parse(fs.readFileSync('eval/goldset.json', 'utf8')).batch;
}
