/** LLM re-ranker for the sweep's A/B, hitting the same prompt the app uses. */
import { RERANK_SYSTEM } from '../../src/lib/agents/prompts.ts';
import { parseLooseJSON } from '../../src/lib/ollama.ts';

export function makeReranker() {
  const key = process.env.OLLAMA_API_KEY;
  const base = (process.env.OLLAMA_BASE_URL || 'https://ollama.com').replace(/\/+$/, '');
  const model = process.env.OLLAMA_FAST_MODEL || 'nemotron-3-nano:30b';

  return async (query, hits) => {
    const listing = hits
      .map((h, i) => `[${i + 1}] ${h.chunk.title}${h.chunk.ref ? ` ${h.chunk.ref}` : ''}\n${h.chunk.text.slice(0, 500)}`)
      .join('\n\n');
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
            { role: 'system', content: RERANK_SYSTEM },
            { role: 'user', content: `QUESTION: ${query}\n\nPASSAGES:\n${listing}` },
          ],
          options: { temperature: 0, num_predict: 600 },
        }),
        signal: AbortSignal.timeout(90000),
      });
      const json = await res.json();
      const parsed = parseLooseJSON(json.message?.content ?? '');
      if (!parsed?.order?.length) return hits;

      const seen = new Set();
      const ordered = [];
      for (const n of parsed.order) {
        const i = n - 1;
        if (Number.isInteger(i) && i >= 0 && i < hits.length && !seen.has(i)) {
          seen.add(i);
          ordered.push(hits[i]);
        }
      }
      hits.forEach((h, i) => !seen.has(i) && ordered.push(h));
      return ordered;
    } catch {
      return hits;
    }
  };
}
