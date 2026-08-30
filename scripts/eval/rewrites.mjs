/**
 * Pre-computes the query rewriter's output for the gold set and caches it.
 *
 * The rewriter is a real part of the pipeline, so `multiQuery` has to be
 * sweepable like any other parameter. Caching means the sweep re-uses one set
 * of rewrites across every configuration - otherwise a run costs hundreds of
 * model calls and the comparison is polluted by sampling noise.
 */
import fs from 'node:fs';
import { REWRITE_SYSTEM } from '../../src/lib/agents/prompts.ts';
import { parseLooseJSON } from '../../src/lib/ollama.ts';
import { filterOnTopic } from '../../src/lib/agents/rewrite-guard.ts';

const CACHE = 'eval/cache/rewrites.json';

export async function ensureRewrites(batch, { extra = 3, force = false } = {}) {
  const cache = !force && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

  const key = process.env.OLLAMA_API_KEY;
  const base = (process.env.OLLAMA_BASE_URL || 'https://ollama.com').replace(/\/+$/, '');
  const model = process.env.OLLAMA_FAST_MODEL || 'gpt-oss:20b';

  const missing = batch.filter((b) => !cache[b.id]);
  if (missing.length && !key) {
    console.warn('! OLLAMA_API_KEY not set - multiQuery will be evaluated as query-only.');
    return cache;
  }

  for (const item of missing) {
    process.stdout.write(`\r  rewriting ${Object.keys(cache).length + 1}/${batch.length}   `);
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format: 'json',
          messages: [
            { role: 'system', content: REWRITE_SYSTEM.replace('${n}', String(extra + 1)) },
            { role: 'user', content: item.query },
          ],
          options: { temperature: 0, num_predict: 1200 },
        }),
        signal: AbortSignal.timeout(90000),
      });
      const json = await res.json();
      // Same lenient parse the app uses, so the eval sees what production sees.
      const parsed = parseLooseJSON(json.message?.content ?? '') ?? {};
      const queries = [item.query, ...(parsed.queries ?? [])]
        .map((q) => String(q).trim())
        .filter((q, i, a) => q.length > 2 && a.indexOf(q) === i);
      cache[item.id] = { queries, terms: parsed.terms ?? [], clarified: parsed.clarified ?? '' };
    } catch (err) {
      console.warn(`\n! rewrite failed for ${item.id}: ${err.message}`);
      cache[item.id] = { queries: [item.query], terms: [] };
    }
  }
  if (missing.length) process.stdout.write('\n');

  fs.mkdirSync('eval/cache', { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  return cache;
}

/**
 * The fixed rewrite samples the sweep tunes against.
 *
 * Rewriting is a model call, so it is not deterministic: measured across three
 * independent samples, hit@topK on the gold set ranged 0.583 to 0.750 with the
 * same parameters. Tuning against a single sample therefore fits the sample,
 * not the pipeline. These are generated once, committed, and averaged over, so
 * a sweep is both honest and reproducible.
 */
export function loadSamples() {
  const dir = 'eval/rewrites';
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')));
}

/** Builds the queryExpansion hook the evaluator calls. */
export function expansionFrom(cache) {
  return (item, multiQuery, useTerms) => {
    const entry = cache[item.id];
    if (!entry) return [item.query];
    // Same guard the product applies, so the sweep tunes what actually ships.
    const guarded = [
      item.query,
      ...filterOnTopic(item.query, entry.queries.slice(1), entry.clarified ?? '', entry.terms ?? []),
    ];
    const queries = multiQuery > 0 ? guarded.slice(0, multiQuery + 1) : [item.query];
    const terms = (entry.terms ?? []).join(' ').trim();
    return useTerms && terms.length > 8 ? [...queries, terms] : queries;
  };
}
