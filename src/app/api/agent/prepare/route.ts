import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkInput } from '@/lib/guardrails';
import { routeQuery, rewriteQuery } from '@/lib/agents';
import { bad, requireUser } from '@/lib/http';
import { getMemory, rateLimit } from '@/lib/redis';
import { config, hasOllama } from '@/lib/config';

export const runtime = 'nodejs';
export const maxDuration = 45;

const Body = z.object({
  query: z.string(),
  hasDocs: z.boolean().default(false),
  multiQuery: z.number().int().min(0).max(4).default(2),
  history: z.string().max(8000).default(''),
});

/**
 * Turn 1 of the pipeline, batched into a single round trip:
 *   guardrail -> intent router -> query rewriter -> user memory.
 *
 * The browser needs all of this before it can retrieve locally, and three
 * separate fetches would show up as three separate spinners.
 */
export async function POST(req: Request) {
  const { user, error } = requireUser(req);
  if (error) return error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid request.');
  const { query, hasDocs, multiQuery, history } = parsed.data;

  // Guardrails run before anything is billed or sent anywhere.
  const verdict = checkInput(query);
  if (!verdict.ok) {
    return NextResponse.json({
      blocked: true,
      category: verdict.category,
      message: verdict.message,
    });
  }

  if (!(await rateLimit(user!, config.limits.rateLimitPerMin))) {
    return bad('You are going a bit fast. Wait a minute and try again.', 429);
  }

  const memory = await getMemory(user!).catch(() => []);

  // With no model key we still return a usable plan so BM25 retrieval works.
  if (!hasOllama()) {
    return NextResponse.json({
      blocked: false,
      intent: hasDocs ? 'doc_question' : 'law_question',
      needsRetrieval: true,
      language: 'en',
      queries: [verdict.sanitised],
      terms: [],
      clarified: verdict.sanitised,
      sanitised: verdict.sanitised,
      notices: [...verdict.notices, 'No model key configured - retrieval only.'],
      memory: memory.map((m) => m.text),
      degraded: true,
    });
  }

  // The router and the rewriter do not depend on each other, so they run
  // together. Sequentially they were the slowest stage in the whole request
  // (~4.5s of a ~10s answer); in parallel the stage costs one model call.
  const [route, rewritten] = await Promise.all([
    routeQuery(verdict.sanitised, hasDocs),
    rewriteQuery(verdict.sanitised, multiQuery, history),
  ]);

  // Smalltalk and out-of-scope skip retrieval, so their rewrites are discarded.
  const rewrite = route.needsRetrieval
    ? rewritten
    : { queries: [verdict.sanitised], terms: [], clarified: verdict.sanitised };

  return NextResponse.json({
    blocked: false,
    intent: route.intent,
    needsRetrieval: route.needsRetrieval,
    language: route.language,
    queries: rewrite.queries,
    terms: rewrite.terms,
    clarified: rewrite.clarified,
    sanitised: verdict.sanitised,
    notices: verdict.notices,
    memory: memory.map((m) => m.text),
    degraded: false,
  });
}
