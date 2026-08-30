import { NextResponse } from 'next/server';
import { readImage } from '@/lib/ollama';
import { VISION_PROMPT } from '@/lib/agents/prompts';
import { bad, requireUser } from '@/lib/http';
import { rateLimit } from '@/lib/redis';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Vision OCR for scanned pages and phone photos of documents.
 *
 * The browser rasterises the page and sends one image at a time, so a 40-page
 * scan streams through as 40 small requests instead of one request that would
 * blow past the serverless body limit and the function timeout.
 */
export async function POST(req: Request) {
  const { user, error } = requireUser(req);
  if (error) return error;

  let body: { image?: string; page?: number };
  try {
    body = await req.json();
  } catch {
    return bad('Invalid JSON body.');
  }

  const image = typeof body.image === 'string' ? body.image : '';
  if (!image) return bad('Provide a base64 "image".');
  // ~6MB of base64 is a generous full-page scan; beyond that the client should
  // have downscaled, and we refuse rather than time out.
  if (image.length > 8_000_000) return bad('Page image is too large. Try a lower-resolution scan.', 413);

  if (!(await rateLimit(user!, config.limits.rateLimitPerMin))) {
    return bad('You are going a bit fast. Wait a minute and try again.', 429);
  }

  try {
    const text = await readImage(image, VISION_PROMPT);
    const clean = text.trim();
    return NextResponse.json({
      text: clean === '[NO_TEXT]' ? '' : clean,
      page: body.page ?? null,
      empty: clean === '[NO_TEXT]' || clean.length < 12,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, text: '' }, { status: 502 });
  }
}
