import { Redis } from '@upstash/redis';
import { config, hasRedis } from './config.ts';
import type { ChatSummary, Message } from './types.ts';

/**
 * Chat history + lightweight user memory.
 *
 * Upstash is used over the REST API so it works from Vercel's serverless runtime
 * without a TCP connection pool. When credentials are missing (local dev, a fresh
 * clone, a reviewer poking at the demo) we transparently fall back to a
 * process-local Map so nothing in the UI breaks.
 */

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_RECENT = 40;
const MAX_MEMORY = 20;

interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<void>;
}

class MemoryStore implements Store {
  private kv = new Map<string, unknown>();
  private z = new Map<string, Map<string, number>>();
  async get<T>(key: string) {
    return (this.kv.get(key) as T) ?? null;
  }
  async set(key: string, value: unknown) {
    this.kv.set(key, value);
  }
  async del(key: string) {
    this.kv.delete(key);
  }
  async zadd(key: string, score: number, member: string) {
    const m = this.z.get(key) ?? new Map();
    m.set(member, score);
    this.z.set(key, m);
  }
  async zrange(key: string, start: number, stop: number) {
    const m = [...(this.z.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]);
    return m.slice(start, stop === -1 ? undefined : stop + 1).map(([k]) => k);
  }
  async zrem(key: string, member: string) {
    this.z.get(key)?.delete(member);
  }
}

class UpstashStore implements Store {
  private r: Redis;

  constructor(r: Redis) {
    this.r = r;
  }
  async get<T>(key: string) {
    return (await this.r.get<T>(key)) ?? null;
  }
  async set(key: string, value: unknown, ttl = TTL_SECONDS) {
    await this.r.set(key, value, { ex: ttl });
  }
  async del(key: string) {
    await this.r.del(key);
  }
  async zadd(key: string, score: number, member: string) {
    await this.r.zadd(key, { score, member });
    await this.r.expire(key, TTL_SECONDS);
  }
  async zrange(key: string, start: number, stop: number) {
    return (await this.r.zrange<string[]>(key, start, stop, { rev: true })) ?? [];
  }
  async zrem(key: string, member: string) {
    await this.r.zrem(key, member);
  }
}

let store: Store | null = null;
export function db(): Store {
  if (!store) {
    store = hasRedis()
      ? new UpstashStore(new Redis({ url: config.redis.url, token: config.redis.token }))
      : new MemoryStore();
  }
  return store;
}

export const backend = () => (hasRedis() ? 'upstash' : 'memory');

/**
 * Whether anything written here survives between requests. On serverless the
 * in-memory fallback does not, which makes counters (rate limit, token quota)
 * decorative rather than enforced. Callers surface that rather than pretend.
 */
export const hasRedisBackend = () => hasRedis();

/* ---------------------------------------------------------------- keys */
const kChat = (u: string, id: string) => `kanoon:${u}:chat:${id}`;
const kIndex = (u: string) => `kanoon:${u}:chats`;
const kMemory = (u: string) => `kanoon:${u}:memory`;
const kRate = (u: string, bucket: number) => `kanoon:${u}:rl:${bucket}`;

/** Usernames are the only credential in this demo, so normalise them hard. */
export function normaliseUser(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

/* ---------------------------------------------------------------- chats */
export interface StoredChat {
  id: string;
  title: string;
  messages: Message[];
  docIds: string[];
  updatedAt: number;
}

export async function listChats(user: string): Promise<ChatSummary[]> {
  const ids = await db().zrange(kIndex(user), 0, MAX_RECENT - 1);
  const chats = await Promise.all(ids.map((id) => db().get<StoredChat>(kChat(user, id))));
  return chats
    .filter((c): c is StoredChat => Boolean(c))
    .map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      docCount: c.docIds?.length ?? 0,
    }));
}

export async function getChat(user: string, id: string): Promise<StoredChat | null> {
  return db().get<StoredChat>(kChat(user, id));
}

export async function saveChat(user: string, chat: StoredChat): Promise<void> {
  // Keep Redis small: history is a convenience, the browser holds the source of truth.
  const trimmed: StoredChat = { ...chat, messages: chat.messages.slice(-60) };
  await db().set(kChat(user, chat.id), trimmed);
  await db().zadd(kIndex(user), chat.updatedAt, chat.id);
  const ids = await db().zrange(kIndex(user), MAX_RECENT, -1);
  await Promise.all(ids.map((old) => Promise.all([db().del(kChat(user, old)), db().zrem(kIndex(user), old)])));
}

export async function deleteChat(user: string, id: string): Promise<void> {
  await Promise.all([db().del(kChat(user, id)), db().zrem(kIndex(user), id)]);
}

/* --------------------------------------------------------------- memory */
export interface MemoryFact {
  text: string;
  createdAt: number;
}

export async function getMemory(user: string): Promise<MemoryFact[]> {
  return (await db().get<MemoryFact[]>(kMemory(user))) ?? [];
}

export async function addMemory(user: string, facts: string[]): Promise<MemoryFact[]> {
  const existing = await getMemory(user);
  const seen = new Set(existing.map((f) => f.text.toLowerCase()));
  const fresh = facts
    .map((t) => t.trim())
    .filter((t) => t.length > 3 && t.length < 240 && !seen.has(t.toLowerCase()))
    .map((text) => ({ text, createdAt: Date.now() }));
  const next = [...existing, ...fresh].slice(-MAX_MEMORY);
  await db().set(kMemory(user), next);
  return next;
}

export async function clearMemory(user: string): Promise<void> {
  await db().del(kMemory(user));
}

/* ----------------------------------------------------------- rate limit */
export async function rateLimit(user: string, perMinute: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 60000);
  const key = kRate(user, bucket);
  const current = (await db().get<number>(key)) ?? 0;
  if (current >= perMinute) return false;
  await db().set(key, current + 1, 120);
  return true;
}
