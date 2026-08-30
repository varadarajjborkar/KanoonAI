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
