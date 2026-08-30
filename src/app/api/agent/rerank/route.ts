import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rerankHits } from '@/lib/agents';
import { bad, requireUser } from '@/lib/http';
import { hasOllama } from '@/lib/config';
import type { RetrievalHit } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 45;

const Body = z.object({
  query: z.string().min(1),
  passages: z
    .array(z.object({ id: z.string(), title: z.string().default(''), text: z.string() }))
    .max(30),
});

/**
 * LLM re-ranking. The browser holds the chunks, so it sends only the shortlist
 * and gets back an ordering of ids - the document text still never gets stored
 * server-side, it only passes through.
 */
export async function POST(req: Request) {
  const { error } = requireUser(req);
  if (error) return error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid request.');
  const { query, passages } = parsed.data;

  if (!hasOllama() || passages.length < 2) {
    return NextResponse.json({ order: passages.map((p) => p.id) });
  }

  const hits = passages.map((p, i) => ({
    chunk: {
      id: p.id,
      docId: '',
      source: 'user' as const,
      text: p.text,
      title: p.title,
      ordinal: i,
    },
    score: 0,
  })) as RetrievalHit[];

  const ordered = await rerankHits(query, hits).catch(() => hits);
  return NextResponse.json({ order: ordered.map((h) => h.chunk.id) });
}
