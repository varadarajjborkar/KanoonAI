import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addMemory, clearMemory, getMemory } from '@/lib/redis';
import { extractMemory } from '@/lib/agents';
import { redactPII } from '@/lib/guardrails';
import { hasOllama } from '@/lib/config';
import { bad, requireUser } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 30;

const Body = z.object({ exchange: z.string().max(8000) });

/** What KanoonAI remembers about you between chats. Visible and deletable. */
export async function GET(req: Request) {
  const { user, error } = requireUser(req);
  if (error) return error;
  return NextResponse.json({ memory: await getMemory(user!) });
}

/** Distil one exchange into durable, non-identifying facts. */
export async function POST(req: Request) {
  const { user, error } = requireUser(req);
  if (error) return error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad('Invalid request.');
  if (!hasOllama()) return NextResponse.json({ memory: await getMemory(user!) });

  // Memory outlives the chat, so it gets a second PII pass on the way in.
  const safe = redactPII(parsed.data.exchange).text;
  const facts = await extractMemory(safe).catch(() => []);
  const memory = facts.length ? await addMemory(user!, facts) : await getMemory(user!);
  return NextResponse.json({ memory });
}

export async function DELETE(req: Request) {
  const { user, error } = requireUser(req);
  if (error) return error;
  await clearMemory(user!);
  return NextResponse.json({ ok: true });
}
