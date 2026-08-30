import { NextResponse } from 'next/server';
import { normaliseUser } from './redis.ts';

/** Username-only identity. There is no password by design; see README. */
export function userFrom(req: Request): string | null {
  const raw = req.headers.get('x-kanoon-user') ?? '';
  const user = normaliseUser(raw);
  return user.length >= 2 ? user : null;
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function requireUser(req: Request) {
  const user = userFrom(req);
  if (!user) return { user: null, error: bad('Sign in with a username first.', 401) };
  return { user, error: null };
}

/**
 * A stable id the browser generates and keeps. Not a credential - it is
 * client-supplied and resettable - but it gives the token budget a second scope
 * so one person cannot multiply their allowance just by renaming themselves.
 */
export function deviceFrom(req: Request): string {
  return (req.headers.get('x-kanoon-device') ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

/** 402-style refusal used when a caller has spent their daily token budget. */
export function quotaExhausted(message: string, resetAt: number) {
  return NextResponse.json({ error: message, quotaExhausted: true, resetAt }, { status: 429 });
}
