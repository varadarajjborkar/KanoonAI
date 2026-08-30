import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { embed } from '@/lib/ollama';
import { bad } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Embedding proxy. The browser never sees the API key, and when no embedding
 * model is configured we say so explicitly so the client can switch to its
 * local hashing encoder instead of silently retrieving nothing.
 */
export async function POST(req: Request) {
  let body: { texts?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad('Invalid JSON body.');
  }

  const texts = Array.isArray(body.texts) ? body.texts.filter((t): t is string => typeof t === 'string') : [];
  if (!texts.length) return bad('Provide a non-empty "texts" array.');
  if (texts.length > 256) return bad('Too many texts in one call (max 256).');

  if (!config.ollama.embedModel) {
    return NextResponse.json({ error: 'no_embed_model', embeddings: [] }, { status: 501 });
  }

  try {
    const embeddings = await embed(texts.map((t) => t.slice(0, 6000)));
    return NextResponse.json({ embeddings, model: config.ollama.embedModel });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, embeddings: [] },
      { status: 502 },
    );
  }
}
