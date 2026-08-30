/** Server-side runtime configuration. Never import this from a client component. */

const env = (k: string, d = '') => (process.env[k] ?? d).trim();

export const config = {
  ollama: {
    apiKey: env('OLLAMA_API_KEY'),
    baseUrl: env('OLLAMA_BASE_URL', 'https://ollama.com').replace(/\/+$/, ''),
    /** Main reasoning + answer model. */
    chatModel: env('OLLAMA_CHAT_MODEL', 'gpt-oss:120b'),
    /** Small model for router / grader / guardrail classification. */
    fastModel: env('OLLAMA_FAST_MODEL', 'nemotron-3-nano:30b'),
    /** Multimodal model that reads scanned pages and photos of documents. */
    visionModel: env('OLLAMA_VISION_MODEL', 'gemma4:31b'),
    /** Blank => dense retrieval falls back to the deterministic local encoder. */
    embedModel: env('OLLAMA_EMBED_MODEL', ''),
    timeoutMs: Number(env('OLLAMA_TIMEOUT_MS', '90000')),
  },
  redis: {
    // Vercel's Upstash marketplace integration injects KV_REST_API_* while a
    // database created directly on Upstash gives UPSTASH_REDIS_REST_*. Accept
    // both so the app works however the database was provisioned.
    url: env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL'),
    token: env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN'),
  },
  limits: {
    maxDocChars: Number(env('NEXT_PUBLIC_MAX_DOC_CHARS', '400000')),
    maxContextChars: Number(env('MAX_CONTEXT_CHARS', '24000')),
    maxEmbedBatch: 64,
    /** Per-user sliding window on generation calls. */
    rateLimitPerMin: Number(env('RATE_LIMIT_PER_MIN', '30')),
  },
} as const;

export const hasOllama = () => config.ollama.apiKey.length > 0;
export const hasRedis = () => config.redis.url.length > 0 && config.redis.token.length > 0;
