import { z } from 'zod';
import { config, hasOllama } from '@/lib/config';
import { chat, chatStream, type ChatMessage } from '@/lib/ollama';
import { checkOutput, DISCLAIMER } from '@/lib/guardrails';
import { readability, unexplainedJargon } from '@/lib/readability';
import {
  ANSWER_SYSTEM,
  NO_CONTEXT_SYSTEM,
  SIMPLIFY_SYSTEM,
  answerUserPrompt,
} from '@/lib/agents/prompts';
import { bad, requireUser } from '@/lib/http';
import { rateLimit } from '@/lib/redis';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  question: z.string().min(1).max(4000),
  context: z.string().max(60000).default(''),
  citationCount: z.number().int().min(0).max(40).default(0),
  history: z.string().max(8000).default(''),
  memory: z.array(z.string()).max(20).default([]),
  risks: z.string().max(6000).default(''),
  intent: z.string().default('law_question'),
  language: z.string().default('en'),
});

/**
 * Answer generation.
 *
 * Streams tokens for responsiveness, then does a second pass over the completed
 * text: strip hallucinated citations, soften over-claims, and - if the answer
 * came out too hard to read - rewrite it simpler. The client shows the streamed
 * draft immediately and swaps in the checked version when `final` arrives.
 */

/** Below this Flesch score the answer is too dense for our target reader. */
const MIN_FLESCH = 45;

function sse(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function POST(req: Request) {
  const { user, error } = requireUser(req);
  if (error) return error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid request.');
  const b = parsed.data;

  if (!hasOllama()) {
    return bad(
      'No model key is configured. Add OLLAMA_API_KEY to .env.local and restart. Retrieval still works - you can see the matching sections in the sources panel.',
      503,
    );
  }
  if (!(await rateLimit(user!, config.limits.rateLimitPerMin))) {
    return bad('You are going a bit fast. Wait a minute and try again.', 429);
  }

  const grounded = b.context.trim().length > 0;
  const system = grounded ? ANSWER_SYSTEM : NO_CONTEXT_SYSTEM;

  const languageNote =
    b.language && b.language !== 'en'
      ? `\n\nThe user wrote in "${b.language}". Reply in that same language, in simple everyday words.`
      : '';

  const messages: ChatMessage[] = [
    { role: 'system', content: system + languageNote },
    {
      role: 'user',
      content: answerUserPrompt({
        question: b.question,
        context: b.context,
        history: b.history,
        memory: b.memory.join('\n'),
        risks: b.risks,
      }),
    },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = '';
      try {
        for await (const delta of chatStream(messages, {
          temperature: 0.25,
          maxTokens: 1400,
          signal: req.signal,
        })) {
          full += delta;
          controller.enqueue(sse({ type: 'delta', text: delta }));
        }

        /* ---------------------------------------------- output guardrails */
        const checked = checkOutput(full, b.citationCount);
        let finalText = checked.text;
        const warnings = [...checked.warnings];

        /* ------------------------------------------------- readability */
        const before = readability(finalText);
        const jargon = unexplainedJargon(finalText);
        const tooHard = before.flesch < MIN_FLESCH || jargon.length > 0;

        if (tooHard && finalText.length > 120 && finalText.length < 9000) {
          controller.enqueue(sse({ type: 'status', text: 'making this simpler...' }));
          const simpler = await chat(
            [
              { role: 'system', content: SIMPLIFY_SYSTEM },
              { role: 'user', content: finalText },
            ],
            { temperature: 0.2, maxTokens: 1500, signal: req.signal, think: false },
          ).catch(() => '');

          const after = simpler ? readability(simpler) : null;
          // Only accept the rewrite if it genuinely reads easier and kept the substance.
          if (after && after.flesch > before.flesch + 3 && simpler.length > finalText.length * 0.5) {
            finalText = checkOutput(simpler, b.citationCount).text;
            warnings.push(
              `simplified for readability (Flesch ${before.flesch} -> ${after.flesch})`,
            );
          }
        }

        controller.enqueue(
          sse({
            type: 'final',
            text: finalText,
            warnings,
            grounded,
            readability: readability(finalText),
            jargon: unexplainedJargon(finalText),
            disclaimer: DISCLAIMER,
          }),
        );
      } catch (err) {
        controller.enqueue(
          sse({
            type: 'error',
            message:
              (err as Error).message ||
              'The model did not respond. Please try again in a moment.',
            partial: full,
          }),
        );
      } finally {
        controller.enqueue(sse({ type: 'done' }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
