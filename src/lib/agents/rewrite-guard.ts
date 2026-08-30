import { tokenize } from '../rag/tokenize.ts';

/**
 * Drop rewritten queries that wandered off the user's topic.
 *
 * Observed in production: a cheque-bounce question produced queries about
 * security deposits and domestic violence, lifted straight from the worked
 * examples in the rewriter's own prompt. Those polluted retrieval and degraded
 * the answer, so a prompt rule alone is not enough - this is the control.
 *
 * A rewrite survives if it shares any content word with what the user asked,
 * with the model's own restatement of it, or with the legal terms it extracted.
 * Those three together are broad enough that a genuine everyday-to-statutory
 * translation ("cheque bounced" -> "dishonour of cheque") always passes.
 *
 * Lives in its own module so the evaluation harness applies exactly the same
 * filter as the product; otherwise the sweep would be tuning a pipeline that
 * does not ship.
 */
export function filterOnTopic(
  original: string,
  candidates: string[],
  clarified = '',
  terms: string[] = [],
): string[] {
  const topic = new Set([
    ...tokenize(original),
    ...tokenize(clarified),
    ...tokenize(terms.join(' ')),
  ]);
  if (topic.size === 0) return candidates;
  return candidates.filter((q) => tokenize(q).some((t) => topic.has(t)));
}
