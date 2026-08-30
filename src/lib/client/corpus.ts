'use client';

import type { Chunk } from '../types.ts';
import { HashingEncoder, quantise } from '../rag/embed.ts';
import { STORES, get, getAll, put, putMany } from './idb.ts';

/**
 * Loading the Indian-law corpus into the browser.
 *
 * The shards are static files, so Vercel's CDN serves them and our functions
 * never touch them. First visit downloads and caches them in IndexedDB along
 * with locally computed vectors; every later visit reads straight from disk.
 */

export interface CorpusManifest {
  version: number;
  builtAt: string;
  source: string;
  encoder: string;
  dim: number;
  totals: { acts: number; chunks: number; chars: number; bytes: number };
  acts: Array<{ id: string; name: string; sections: number; chunks: number; topics: string }>;
  shards: Array<{ file: string; chunks: number; bytes: number }>;
}

const META_KEY = 'corpus-state';

interface CorpusState {
  key: string;
  version: number;
  builtAt: string;
  encoder: string;
  chunks: number;
}

let cache: Chunk[] | null = null;
let inflight: Promise<Chunk[]> | null = null;

export async function loadManifest(): Promise<CorpusManifest | null> {
  try {
    const res = await fetch('/corpus/manifest.json', { cache: 'force-cache' });
    if (!res.ok) return null;
    return (await res.json()) as CorpusManifest;
  } catch {
    return null;
  }
}

/**
 * Returns every corpus chunk, downloading and indexing on first use.
 * `onProgress` drives the first-run progress bar.
 */
export async function loadCorpus(onProgress?: (pct: number, label: string) => void): Promise<Chunk[]> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const manifest = await loadManifest();
    if (!manifest) {
      // No corpus built yet: the app still works on uploaded documents alone.
      cache = [];
      return cache;
    }

    const state = await get<CorpusState>(STORES.meta, META_KEY).catch(() => undefined);
    const fresh = state && state.builtAt === manifest.builtAt && state.chunks === manifest.totals.chunks;

    if (fresh) {
      const stored = await getAll<Chunk>(STORES.corpus).catch(() => []);
      if (stored.length === manifest.totals.chunks) {
        onProgress?.(100, 'law library ready');
        cache = stored;
        return cache;
      }
    }

    /* ---------------------------------------------------------- download */
    const chunks: Chunk[] = [];
    for (let i = 0; i < manifest.shards.length; i++) {
      onProgress?.(Math.round((i / manifest.shards.length) * 60), 'downloading Indian law...');
      const res = await fetch(`/corpus/${manifest.shards[i].file}`, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`Could not load law library (shard ${i + 1}).`);
      chunks.push(...((await res.json()) as Chunk[]));
    }

    /* ----------------------------------------------------------- vectors */
    // The shipped shards carry vectors only when the index was built with a
    // remote embedding model. Otherwise we compute the deterministic hashing
    // vectors here - identical maths, just moved to the client to keep the
    // download small. Batched so the UI thread stays responsive.
    if (!chunks[0]?.vec) {
      const encoder = new HashingEncoder(512);
      for (let i = 0; i < chunks.length; i += 400) {
        const batch = chunks.slice(i, i + 400);
        for (const c of batch) c.vec = quantise(encoder.encodeOne(c.text));
        onProgress?.(60 + Math.round((i / chunks.length) * 35), 'indexing law library...');
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    /* ------------------------------------------------------------- cache */
    try {
      onProgress?.(96, 'saving to your browser...');
      await putMany(STORES.corpus, chunks);
      await put<CorpusState>(STORES.meta, {
        key: META_KEY,
        version: manifest.version,
        builtAt: manifest.builtAt,
        encoder: manifest.encoder,
        chunks: chunks.length,
      });
    } catch {
      // Out of quota or private browsing: keep going from memory this session.
    }

    onProgress?.(100, 'law library ready');
    cache = chunks;
    return chunks;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function corpusInMemory(): Chunk[] | null {
  return cache;
}

export function resetCorpusCache(): void {
  cache = null;
}
