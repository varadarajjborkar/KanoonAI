import { config } from './config.ts';

/**
 * Thin Ollama Cloud client.
 *
 * We talk to the native /api/chat + /api/embed endpoints rather than the
 * OpenAI-compatible shim because /api/chat is what exposes `images` for the
 * vision models and `think` for the reasoning models.
 */

export class OllamaError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'OllamaError';
    this.status = status;
    this.retryable = retryable;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** base64 PNG/JPEG payloads, no data: prefix. */
  images?: string[];
}

interface ChatOpts {
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Ask the model to emit a JSON object matching this shape. */
  json?: boolean;
  signal?: AbortSignal;
  /** Disable chain-of-thought on models that support it, for latency. */
  think?: boolean;
  /** Internal: guards the one retry we allow for budget-exhausted responses. */
  _retriedForLength?: boolean;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

async function call(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  if (!config.ollama.apiKey) {
    throw new OllamaError('OLLAMA_API_KEY is not set. Add it to .env.local.', 401, false);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.ollama.timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${config.ollama.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ollama.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new OllamaError(
        `Ollama ${path} failed (${res.status}): ${detail.slice(0, 300)}`,
        res.status,
        RETRYABLE.has(res.status),
      );
    }
    return res;
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    const aborted = (err as Error)?.name === 'AbortError';
    throw new OllamaError(
      aborted ? 'Model call timed out.' : `Model call failed: ${(err as Error).message}`,
      aborted ? 408 : 503,
      true,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Retry with jittered exponential backoff on transient failures only. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!(err instanceof OllamaError) || !err.retryable || i === attempts - 1) throw err;
      const wait = Math.min(4000, 2 ** i * 400) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

function buildBody(messages: ChatMessage[], o: ChatOpts, stream: boolean) {
  return {
    model: o.model ?? config.ollama.chatModel,
    messages,
    stream,
    ...(o.json ? { format: 'json' } : {}),
    ...(o.think === false ? { think: false } : {}),
    options: {
      temperature: o.temperature ?? 0.2,
      top_p: o.topP ?? 0.9,
      num_predict: o.maxTokens ?? 1200,
    },
  };
}

/** Single-shot completion. */
export async function chat(messages: ChatMessage[], o: ChatOpts = {}): Promise<string> {
  const res = await withRetry(() => call('/api/chat', buildBody(messages, o, false), o.signal));
  const data = (await res.json()) as {
    message?: { content?: string; thinking?: string };
    done_reason?: string;
  };
  const content = data.message?.content ?? '';

  // Reasoning models put chain-of-thought in `thinking`, and those tokens are
  // charged against num_predict. A long enough think therefore returns a
  // perfectly successful response with an empty answer. Retrying once with a
  // bigger budget fixes it; failing loudly beats returning '' to a caller that
  // is about to JSON.parse it.
  if (!content.trim() && data.done_reason === 'length') {
    if (!o._retriedForLength) {
      return chat(messages, {
        ...o,
        maxTokens: Math.min(8000, (o.maxTokens ?? 1200) * 3),
        _retriedForLength: true,
      });
    }
    throw new OllamaError(
      'The model spent its whole budget on internal reasoning and returned nothing. ' +
        'Use a model without hidden reasoning for structured calls.',
      500,
      false,
    );
  }
  return content;
}

/** Completion that must return JSON; falls back to salvaging the first {...} block. */
export async function chatJSON<T>(messages: ChatMessage[], o: ChatOpts = {}): Promise<T | null> {
  const raw = await chat(messages, { ...o, json: true, temperature: o.temperature ?? 0 });
  return parseLooseJSON<T>(raw);
}

export function parseLooseJSON<T>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/** Streaming completion: yields content deltas as they arrive. */
export async function* chatStream(
  messages: ChatMessage[],
  o: ChatOpts = {},
): AsyncGenerator<string> {
  const res = await withRetry(() => call('/api/chat', buildBody(messages, o, true), o.signal));
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const j = JSON.parse(t) as { message?: { content?: string }; done?: boolean };
        const delta = j.message?.content;
        if (delta) yield delta;
      } catch {
        /* partial JSON line, ignore */
      }
    }
  }
}

/** Batch embeddings. Returns [] when no embed model is configured. */
export async function embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (!config.ollama.embedModel || texts.length === 0) return [];
  const res = await withRetry(() =>
    call('/api/embed', { model: config.ollama.embedModel, input: texts }, signal),
  );
  const data = (await res.json()) as { embeddings?: number[][] };
  return data.embeddings ?? [];
}

/** Ask the vision model to transcribe a page image. */
export async function readImage(base64: string, hint: string, signal?: AbortSignal): Promise<string> {
  return chat(
    [
      {
        role: 'user',
        content: hint,
        images: [base64.replace(/^data:image\/\w+;base64,/, '')],
      },
    ],
    { model: config.ollama.visionModel, temperature: 0, maxTokens: 2400, signal, think: false },
  );
}
