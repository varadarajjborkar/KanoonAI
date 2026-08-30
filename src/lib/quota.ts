import { db, hasRedisBackend } from './redis.ts';

/**
 * Daily token budget.
 *
 * The username is a namespace, not a credential, so anyone with the URL can use
 * the deployment's model quota. This meters real usage - Ollama reports exact
 * `prompt_eval_count` and `eval_count` per call - and cuts a caller off once
 * they have spent their day's budget.
 *
 * Three scopes, and the strictest one wins:
 *   device  - one browser, keyed by an id it generates and keeps
 *   user    - one username, across their devices
 *   global  - the whole deployment, which is what actually protects the bill
 *
 * Honest about what this is: device ids and usernames are both client-supplied,
 * so a determined person can reset either by clearing storage or picking a new
 * name. The global cap is the only scope they cannot walk around, and real
 * protection for a public URL is access control, not metering.
 */

const num = (k: string, d: number) => {
  const v = Number((process.env[k] ?? '').trim());
  return Number.isFinite(v) && v > 0 ? v : d;
};

export const BUDGETS = {
  /** Per username per day. */
  user: num('DAILY_TOKEN_BUDGET', 100_000),
  /** Per browser per day. Slightly lower: one person, one device. */
  device: num('DAILY_DEVICE_TOKEN_BUDGET', 100_000),
  /** Whole deployment per day. The backstop on the API bill. */
  global: num('GLOBAL_DAILY_TOKEN_BUDGET', 2_000_000),
};

/** IST has no DST, so the day boundary is a fixed +5:30 offset. */
export function istDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Epoch millis of the next midnight IST, for telling the user when they reset. */
export function nextResetAt(now: Date = new Date()): number {
  const shifted = new Date(now.getTime() + 5.5 * 3600_000);
  const nextMidnightIst = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  );
  return nextMidnightIst - 5.5 * 3600_000;
}

const key = (scope: string, id: string) => `kanoon:tok:${scope}:${id}:${istDay()}`;
const TTL = 60 * 60 * 40; // outlives one IST day, expires itself

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  scope: 'user' | 'device' | 'global';
}

export interface QuotaVerdict {
  ok: boolean;
  resetAt: number;
  /** The scope closest to its limit, which is what the UI should show. */
  tightest: QuotaState;
  states: QuotaState[];
  /** True when nothing durable is storing counts, so this is not enforceable. */
  enforceable: boolean;
}

async function read(scope: 'user' | 'device' | 'global', id: string, limit: number): Promise<QuotaState> {
  const used = (await db().get<number>(key(scope, id)).catch(() => 0)) ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used), scope };
}

export async function checkQuota(user: string, device: string): Promise<QuotaVerdict> {
  const states = await Promise.all([
    read('user', user, BUDGETS.user),
    read('device', device || 'unknown', BUDGETS.device),
    read('global', 'all', BUDGETS.global),
  ]);
  const tightest = states.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
  return {
    ok: states.every((s) => s.used < s.limit),
    resetAt: nextResetAt(),
    tightest,
    states,
    enforceable: hasRedisBackend(),
  };
}

/**
 * Add real usage to every scope. Called after a model responds, so a request
 * already in flight is never killed mid-answer; the next one is refused instead.
 */
export async function recordUsage(user: string, device: string, tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const targets: Array<[string, string]> = [
    ['user', user],
    ['device', device || 'unknown'],
    ['global', 'all'],
  ];
  await Promise.all(
    targets.map(async ([scope, id]) => {
      const k = key(scope, id);
      const current = (await db().get<number>(k).catch(() => 0)) ?? 0;
      await db().set(k, current + tokens, TTL).catch(() => undefined);
    }),
  );
}

/** Friendly message for a caller who has run out. */
export function exhaustedMessage(v: QuotaVerdict): string {
  const hours = Math.max(1, Math.round((v.resetAt - Date.now()) / 3600_000));
  const who =
    v.tightest.scope === 'global'
      ? 'This demo has used up its shared daily allowance'
      : 'You have used up your daily allowance';
  return (
    `${who}. It resets at midnight IST, in about ${hours} hour${hours === 1 ? '' : 's'}. ` +
    'Anything you have already uploaded stays in your browser, so you can pick up right where you left off.'
  );
}
