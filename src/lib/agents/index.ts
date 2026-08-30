import { config } from '../config.ts';
import { chatJSON, type ChatMessage, type Usage } from '../ollama.ts';
import type { RetrievalHit } from '../types.ts';
import { filterOnTopic } from './rewrite-guard.ts';
import {
  GRADER_SYSTEM,
  MEMORY_SYSTEM,
  RERANK_SYSTEM,
  REWRITE_SYSTEM,
  ROUTER_SYSTEM,
} from './prompts.ts';

/**
 * Small, single-purpose agents that sit around the retrieval core.
 *
 * Every one of them is optional: if the model call fails or returns junk, the
 * agent returns a sane fallback and the pipeline keeps going. A demo that dies
 * because a classifier hiccuped is a worse demo than one that degrades.
 */

export type Intent =
  | 'doc_question'
  | 'law_question'
  | 'risk_scan'
  | 'summarise'
  | 'followup'
  | 'smalltalk'
  | 'out_of_scope';

export interface RouteResult {
  intent: Intent;
  needsRetrieval: boolean;
  language: string;
  reason: string;
}

const VALID_INTENTS: Intent[] = [
  'doc_question',
  'law_question',
  'risk_scan',
  'summarise',
  'followup',
  'smalltalk',
  'out_of_scope',
];

/** Cheap deterministic pre-classifier, so obvious cases never cost a model call. */
function quickRoute(q: string, hasDocs: boolean): RouteResult | null {
  const t = q.trim().toLowerCase();
  if (t.length <= 24 && /^(hi|hey|hello|namaste|yo|thanks|thank you|ok|okay|bye|good (morning|evening))\b/.test(t)) {
    return { intent: 'smalltalk', needsRetrieval: false, language: 'en', reason: 'greeting' };
  }
  if (/\b(risk|risky|unfair|trap|catch|danger|problem|red flag)\b/.test(t) && hasDocs) {
    return { intent: 'risk_scan', needsRetrieval: true, language: 'en', reason: 'risk keywords' };
  }
  return null;
}

export async function routeQuery(
  query: string,
  hasDocs: boolean,
  signal?: AbortSignal,
  onUsage?: (u: Usage) => void,
): Promise<RouteResult> {
  const quick = quickRoute(query, hasDocs);
  if (quick) return quick;

  const fallback: RouteResult = {
    intent: hasDocs ? 'doc_question' : 'law_question',
    needsRetrieval: true,
    language: 'en',
    reason: 'fallback',
  };

  const res = await chatJSON<RouteResult>(
    [
      { role: 'system', content: ROUTER_SYSTEM },
      {
        role: 'user',
        content: `User has ${hasDocs ? 'uploaded a document' : 'not uploaded anything'}.\nMessage: ${query}`,
      },
    ],
    { model: config.ollama.fastModel, maxTokens: 500, signal, think: false, onUsage },
  ).catch(() => null);

  if (!res || !VALID_INTENTS.includes(res.intent)) return fallback;
  return {
    intent: res.intent,
    needsRetrieval: res.intent !== 'smalltalk' && res.intent !== 'out_of_scope',
    language: res.language || 'en',
    reason: res.reason || '',
  };
}

export interface RewriteResult {
  queries: string[];
  terms: string[];
  clarified: string;
}

/**
 * Query understanding. This is the single highest-leverage agent for our users:
 * they type "landlord not returning deposit" and the corpus says "wrongful
 * withholding of security deposit under the lease". Without this bridge, BM25
 * simply misses.
 */
export async function rewriteQuery(
  query: string,
  extraQueries: number,
  history: string,
  signal?: AbortSignal,
  onUsage?: (u: Usage) => void,
): Promise<RewriteResult> {
  const fallback: RewriteResult = { queries: [query], terms: [], clarified: query };
  if (extraQueries <= 0) return fallback;

  const res = await chatJSON<RewriteResult>(
    [
      { role: 'system', content: REWRITE_SYSTEM.replace('${n}', String(extraQueries + 1)) },
      {
        role: 'user',
        content: history ? `Conversation so far:\n${history}\n\nNew message: ${query}` : query,
      },
    ],
    { model: config.ollama.fastModel, maxTokens: 900, signal, think: false, onUsage },
  ).catch(() => null);

  if (!res?.queries?.length) return fallback;

  const cleaned = filterOnTopic(
    query,
    res.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 2),
    typeof res.clarified === 'string' ? res.clarified : '',
    Array.isArray(res.terms) ? res.terms.filter((t) => typeof t === 'string') : [],
  );

  const queries = [query, ...cleaned]
    .map((q) => q.trim())
    .filter((q, i, arr) => q.length > 2 && arr.indexOf(q) === i)
    .slice(0, extraQueries + 1);

  return {
    queries,
    terms: Array.isArray(res.terms) ? res.terms.filter((t) => typeof t === 'string').slice(0, 12) : [],
    clarified: typeof res.clarified === 'string' ? res.clarified : query,
  };
}

/** LLM re-ranker. Returns the hits reordered; falls back to the input order. */
export async function rerankHits(
  query: string,
  hits: RetrievalHit[],
  signal?: AbortSignal,
  onUsage?: (u: Usage) => void,
): Promise<RetrievalHit[]> {
  if (hits.length < 2) return hits;
  const listing = hits
    .map((h, i) => `[${i + 1}] ${h.chunk.title}${h.chunk.ref ? ` ${h.chunk.ref}` : ''}\n${h.chunk.text.slice(0, 500)}`)
    .join('\n\n');

  const res = await chatJSON<{ order: number[] }>(
    [
      { role: 'system', content: RERANK_SYSTEM },
      { role: 'user', content: `QUESTION: ${query}\n\nPASSAGES:\n${listing}` },
    ],
    { model: config.ollama.fastModel, maxTokens: 500, signal, think: false, onUsage },
  ).catch(() => null);

  if (!res?.order?.length) return hits;
  const seen = new Set<number>();
  const ordered: RetrievalHit[] = [];
  for (const n of res.order) {
    const idx = n - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < hits.length && !seen.has(idx)) {
      seen.add(idx);
      ordered.push(hits[idx]);
    }
  }
  hits.forEach((h, i) => !seen.has(i) && ordered.push(h));
  return ordered;
}

/** Relevance filter. Never returns an empty list - an unfiltered answer beats none. */
export async function gradeHits(
  query: string,
  hits: RetrievalHit[],
  signal?: AbortSignal,
  onUsage?: (u: Usage) => void,
): Promise<RetrievalHit[]> {
  if (hits.length < 3) return hits;
  const listing = hits
    .map((h, i) => `[${i + 1}] ${h.chunk.text.slice(0, 400)}`)
    .join('\n\n');

  const res = await chatJSON<{ keep: number[] }>(
    [
      { role: 'system', content: GRADER_SYSTEM },
      { role: 'user', content: `QUESTION: ${query}\n\nPASSAGES:\n${listing}` },
    ],
    { model: config.ollama.fastModel, maxTokens: 400, signal, think: false, onUsage },
  ).catch(() => null);

  if (!res?.keep?.length) return hits;
  const kept = hits.filter((_, i) => res.keep.includes(i + 1));
  return kept.length ? kept : hits;
}

/** Pulls durable, non-identifying facts worth remembering across chats. */
export async function extractMemory(
  exchange: string,
  signal?: AbortSignal,
  onUsage?: (u: Usage) => void,
): Promise<string[]> {
  const res = await chatJSON<{ facts: string[] }>(
    [
      { role: 'system', content: MEMORY_SYSTEM },
      { role: 'user', content: exchange.slice(0, 4000) },
    ],
    { model: config.ollama.fastModel, maxTokens: 500, signal, think: false, onUsage },
  ).catch(() => null);

  return (res?.facts ?? [])
    .filter((f) => typeof f === 'string' && f.trim().length > 3)
    .map((f) => f.trim())
    .slice(0, 4);
}

export function historyToText(messages: Array<{ role: string; content: string }>, turns = 4): string {
  return messages
    .slice(-turns * 2)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`)
    .join('\n');
}

export type { ChatMessage };
