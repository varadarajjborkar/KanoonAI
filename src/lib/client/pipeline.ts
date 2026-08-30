'use client';

import type { Chunk, Citation, DocMeta, Message, RetrievalHit, RiskFinding, TraceStep } from '../types.ts';
import { chunkDocument } from '../rag/chunk.ts';
import { BM25Index } from '../rag/bm25.ts';
import { HashingEncoder, RemoteEncoder, quantise, type Embedder } from '../rag/embed.ts';
import { citationLabel, retrieve } from '../rag/retrieve.ts';
import type { RagParams } from '../rag/params.ts';
import { scanRisks } from '../risk.ts';
import { STORES, allUserChunks, put, putMany } from './idb.ts';
import { loadCorpus, loadManifest } from './corpus.ts';
import { extractFile, type ExtractOptions } from './extract.ts';

/**
 * The client-side half of the RAG pipeline.
 *
 * Retrieval happens here, in the browser, over IndexedDB. The server only ever
 * sees the user's question and the handful of passages that won retrieval.
 */

/* ----------------------------------------------------------- encoder */

let encoderPromise: Promise<Embedder | null> | null = null;

/**
 * Pick one encoder for the whole session.
 *
 * Corpus vectors and query vectors must come from the same model or cosine
 * similarity is meaningless, so the corpus manifest decides: if it was built
 * with a remote model we use that, otherwise everyone uses the local hashing
 * encoder. Mixing them silently would look fine and retrieve garbage.
 */
export function getEncoder(): Promise<Embedder | null> {
  encoderPromise ??= (async () => {
    const manifest = await loadManifest();
    if (manifest?.encoder?.startsWith('ollama:')) {
      try {
        const res = await fetch('/api/health');
        const health = (await res.json()) as { ollama?: { embedModel?: string | null } };
        if (health.ollama?.embedModel && manifest.encoder === `ollama:${health.ollama.embedModel}`) {
          return new RemoteEncoder(manifest.dim);
        }
      } catch {
        /* fall through to local */
      }
    }
    return new HashingEncoder(manifest?.dim ?? 512);
  })();
  return encoderPromise;
}

/* ------------------------------------------------------------ ingest */

export interface IngestResult {
  doc: DocMeta;
  risks: RiskFinding[];
  warnings: string[];
}

export async function ingestFile(
  file: File,
  opts: ExtractOptions & { params: RagParams },
): Promise<IngestResult> {
  const extracted = await extractFile(file, opts);

  const maxChars = Number(process.env.NEXT_PUBLIC_MAX_DOC_CHARS ?? 400000);
  const warnings = [...extracted.warnings];
  let text = extracted.text;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    warnings.push(
      `This document is very long, so I indexed the first ${Math.round(maxChars / 1000)}k characters.`,
    );
  }

  const docId = `user:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  opts.onProgress?.(96, 'indexing on your device...');

  const chunks = chunkDocument(
    {
      docId,
      title: file.name.replace(/\.[^.]+$/, ''),
      source: 'user',
      text,
      pages: extracted.pages.map((p) => ({ page: p.page, text: p.text })),
    },
    { ...opts.params, structureAware: true },
  );

  if (!chunks.length) throw new Error(`I read "${file.name}" but found nothing worth indexing.`);

  // Vectors are computed once, at ingest, and stored beside the text.
  const encoder = await getEncoder();
  if (encoder) {
    try {
      const vecs = await encoder.encode(chunks.map((c) => c.text));
      chunks.forEach((c, i) => vecs[i] && (c.vec = quantise(vecs[i])));
    } catch {
      warnings.push('Could not build semantic vectors; keyword search is still active.');
    }
  }

  const doc: DocMeta = {
    id: docId,
    name: file.name,
    source: 'user',
    chars: text.length,
    chunks: chunks.length,
    createdAt: Date.now(),
    extraction: extracted.extraction,
    pages: extracted.pages.length,
  };

  try {
    await putMany(STORES.chunks, chunks);
    await put(STORES.docs, doc);
  } catch (err) {
    throw new Error(
      `Your browser would not store this document (${(err as Error).message}). ` +
        'Try removing an older document from the sidebar and uploading again.',
    );
  }

  invalidateIndex();
  opts.onProgress?.(100, 'ready');
  return { doc, risks: scanRisks(text), warnings };
}

/* ---------------------------------------------------------- indexing */

let indexCache: { signature: string; index: BM25Index; chunks: Chunk[] } | null = null;

export function invalidateIndex(): void {
  indexCache = null;
}

/**
 * Build (or reuse) the searchable set: the statute corpus plus whichever of the
 * user's documents this chat is scoped to. Rebuilding BM25 over 5k chunks costs
 * a few hundred milliseconds, so it is cached until the document set changes.
 */
async function buildSearchSet(
  docIds: string[],
  params: RagParams,
  onProgress?: (pct: number, label: string) => void,
): Promise<{ chunks: Chunk[]; index: BM25Index }> {
  const corpus = await loadCorpus(onProgress);
  const userChunks = (await allUserChunks().catch(() => []))
    .filter((c) => docIds.length === 0 || docIds.includes(c.docId));

  const chunks = [...userChunks, ...corpus];
  const signature = `${docIds.join(',')}|${chunks.length}|${params.bm25K1}|${params.bm25B}|${params.headingWeight}`;
  if (indexCache?.signature === signature) {
    return { chunks: indexCache.chunks, index: indexCache.index };
  }

  const index = new BM25Index(chunks, params.bm25K1, params.bm25B, params.headingWeight);
  indexCache = { signature, index, chunks };
  return { chunks, index };
}

/* --------------------------------------------------------------- ask */

export interface PrepareResponse {
  blocked: boolean;
  category?: string;
  message?: string;
  intent: string;
  needsRetrieval: boolean;
  language: string;
  queries: string[];
  terms: string[];
  clarified: string;
  sanitised: string;
  notices: string[];
  memory: string[];
  degraded: boolean;
}

export interface AskCallbacks {
  onStage?: (stage: string, detail?: string) => void;
  onDelta?: (text: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onCorpusProgress?: (pct: number, label: string) => void;
}

export interface AskResult {
  answer: string;
  citations: Citation[];
  risks: RiskFinding[];
  trace: TraceStep[];
  blocked?: { reason: string; category: string };
  warnings: string[];
  disclaimer?: string;
  stats?: Record<string, unknown>;
}

export async function ask(opts: {
  user: string;
  question: string;
  history: Message[];
  docIds: string[];
  params: RagParams;
  signal?: AbortSignal;
  callbacks?: AskCallbacks;
}): Promise<AskResult> {
  const { user, question, params, callbacks: cb } = opts;
  const trace: TraceStep[] = [];
  const t0 = performance.now();
  const step = (agent: string, since: number, detail: string) =>
    trace.push({ agent, ms: Math.round(performance.now() - since), detail });

  const historyText = opts.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  /* ------------------------------------------- 1. guardrails + planning */
  cb?.onStage?.('checking your question');
  const tPrep = performance.now();
  const prepRes = await fetch('/api/agent/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-kanoon-user': user },
    body: JSON.stringify({
      query: question,
      hasDocs: opts.docIds.length > 0,
      multiQuery: params.multiQuery,
      history: historyText,
    }),
    signal: opts.signal,
  });

  if (!prepRes.ok) {
    const err = (await prepRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Could not start (${prepRes.status}).`);
  }
  const prep = (await prepRes.json()) as PrepareResponse;
  step('guardrail + router', tPrep, prep.blocked ? `blocked: ${prep.category}` : `intent: ${prep.intent}`);

  if (prep.blocked) {
    return {
      answer: prep.message ?? 'I cannot help with that.',
      citations: [],
      risks: [],
      trace,
      blocked: { reason: prep.message ?? '', category: prep.category ?? 'blocked' },
      warnings: [],
    };
  }

  /* ------------------------------------------------------ 2. retrieval */
  let hits: RetrievalHit[] = [];
  let context = '';
  let stats: Record<string, unknown> = {};

  if (prep.needsRetrieval) {
    cb?.onStage?.('searching your documents and Indian law');
    const tRet = performance.now();
    const { chunks, index } = await buildSearchSet(opts.docIds, params, cb?.onCorpusProgress);

    // The rewriter's extracted terms are the most precise signal it produces,
    // so they go in as one more query when the tuned params ask for them.
    const termQuery = params.useTerms ? prep.terms.join(' ').trim() : '';
    const queries = prep.queries.length ? [...prep.queries] : [prep.sanitised];
    if (termQuery.length > 8) queries.push(termQuery);

    const result = await retrieve({
      queries,
      chunks,
      params: { ...params, multiQuery: Math.max(params.multiQuery, queries.length - 1) },
      index,
      embedder: params.lexicalWeight < 1 ? await getEncoder() : null,
      rerank: params.useReranker
        ? (q, candidates) => rerankViaApi(user, q, candidates, opts.signal)
        : undefined,
    });

    hits = result.hits;
    context = result.context;
    stats = result.stats;
    step(
      'retriever',
      tRet,
      `${result.stats.returned}/${result.stats.indexed} chunks, ${result.stats.denseEnabled ? 'hybrid' : 'lexical'}`,
    );
  }

  const citations: Citation[] = hits.map((h, i) => ({
    n: i + 1,
    chunkId: h.chunk.id,
    title: h.chunk.title,
    ref: h.chunk.ref,
    page: h.chunk.page,
    source: h.chunk.source,
    snippet: h.chunk.text.slice(0, 320),
    score: Math.round(h.score * 10000) / 10000,
  }));
  cb?.onCitations?.(citations);

  // Surface risky clauses from whatever we actually retrieved from their doc.
  const userText = hits
    .filter((h) => h.chunk.source === 'user')
    .map((h) => h.chunk.text)
    .join('\n\n');
  const risks = userText ? scanRisks(userText, 6) : [];

  /* ------------------------------------------------------- 3. generate */
  cb?.onStage?.('writing a plain-language answer');
  const tGen = performance.now();

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-kanoon-user': user },
    body: JSON.stringify({
      question: prep.sanitised,
      context,
      citationCount: citations.length,
      history: historyText,
      memory: prep.memory,
      risks: risks.map((r) => `- (${r.severity}) ${r.plain}`).join('\n'),
      intent: prep.intent,
      language: prep.language,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `The model is unavailable right now (${res.status}).`);
  }

  const out = await readSSE(res, cb);
  step('answer + output guardrail', tGen, out.warnings.join('; ') || 'clean');
  step('total', t0, `${Math.round(performance.now() - t0)}ms end to end`);

  return {
    answer: out.text,
    citations,
    risks,
    trace,
    warnings: [...prep.notices, ...out.warnings],
    disclaimer: out.disclaimer,
    stats: { ...stats, intent: prep.intent, queries: prep.queries, readability: out.readability },
  };
}

/* ------------------------------------------------------------ helpers */

interface StreamOut {
  text: string;
  warnings: string[];
  disclaimer?: string;
  readability?: unknown;
}

/** Reads the SSE stream, showing the draft live and swapping in the checked text. */
async function readSSE(res: Response, cb?: AskCallbacks): Promise<StreamOut> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('The server sent an empty response.');

  const decoder = new TextDecoder();
  let buffer = '';
  let draft = '';
  const out: StreamOut = { text: '', warnings: [] };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const evt of events) {
      const line = evt.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line.slice(6));
      } catch {
        continue;
      }

      switch (msg.type) {
        case 'delta':
          draft += String(msg.text ?? '');
          cb?.onDelta?.(String(msg.text ?? ''));
          break;
        case 'status':
          cb?.onStage?.(String(msg.text ?? ''));
          break;
        case 'final':
          out.text = String(msg.text ?? draft);
          out.warnings = Array.isArray(msg.warnings) ? (msg.warnings as string[]) : [];
          out.disclaimer = msg.disclaimer as string | undefined;
          out.readability = msg.readability;
          break;
        case 'error':
          if (!draft && !out.text) throw new Error(String(msg.message ?? 'Generation failed.'));
          out.text = out.text || draft;
          out.warnings.push(`The answer was cut short: ${String(msg.message)}`);
          break;
      }
    }
  }

  if (!out.text) out.text = draft;
  if (!out.text.trim()) throw new Error('The model returned an empty answer. Please try again.');
  return out;
}

async function rerankViaApi(
  user: string,
  query: string,
  hits: RetrievalHit[],
  signal?: AbortSignal,
): Promise<RetrievalHit[]> {
  const res = await fetch('/api/agent/rerank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-kanoon-user': user },
    body: JSON.stringify({
      query,
      passages: hits.map((h) => ({
        id: h.chunk.id,
        title: h.chunk.title,
        text: h.chunk.text.slice(0, 700),
      })),
    }),
    signal,
  });
  if (!res.ok) return hits;
  const { order } = (await res.json()) as { order: string[] };
  const byId = new Map(hits.map((h) => [h.chunk.id, h]));
  const sorted = order.map((id) => byId.get(id)).filter((h): h is RetrievalHit => Boolean(h));
  for (const h of hits) if (!order.includes(h.chunk.id)) sorted.push(h);
  return sorted;
}

export { citationLabel };
