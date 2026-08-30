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
      cache[item.id] = { queries, terms: parsed.terms ?? [] };
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

/** Builds the queryExpansion hook the evaluator calls. */
export function expansionFrom(cache) {
  return (item, multiQuery, useTerms) => {
    const entry = cache[item.id];
    if (!entry) return [item.query];
    const queries = multiQuery > 0 ? entry.queries.slice(0, multiQuery + 1) : [item.query];
    const terms = (entry.terms ?? []).join(' ').trim();
    return useTerms && terms.length > 8 ? [...queries, terms] : queries;
  };
}
