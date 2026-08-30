import { NextResponse } from 'next/server';
import { checkQuota } from '@/lib/quota';
import { deviceFrom, requireUser } from '@/lib/http';

export const runtime = 'nodejs';

/** What the sidebar shows: how much of today's token budget is left. */
export async function GET(req: Request) {
  const { user, error } = requireUser(req);
  if (error) return error;

  const q = await checkQuota(user!, deviceFrom(req));
  return NextResponse.json({
    remaining: q.tightest.remaining,
    limit: q.tightest.limit,
    used: q.tightest.used,
    scope: q.tightest.scope,
    resetAt: q.resetAt,
    enforceable: q.enforceable,
    states: q.states,
  });
}
