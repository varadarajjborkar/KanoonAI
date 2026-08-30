#!/usr/bin/env node
/**
 * Step 2: chunk the curated acts into retrieval units and shard them for the browser.
 *
 *   node scripts/build-index.mjs [--chunk-size 900] [--overlap 180] [--embed]
 *
 * Imports the app's own chunker (src/lib/rag/chunk.ts) so the index can never
 * drift from what the retriever expects. Node strips the types natively.
 *
 * Vectors are only baked in with --embed (needs OLLAMA_EMBED_MODEL). Without it
 * the client computes its deterministic hashing vectors locally on first load,
 * which keeps the download small and works with no key at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chunkDocument } from '../src/lib/rag/chunk.ts';
import { withParams } from '../src/lib/rag/params.ts';
import { HashingEncoder, quantise } from '../src/lib/rag/embed.ts';
import { ACT_TOPICS } from './corpus-manifest.mjs';

const SRC = 'data/corpus/acts';
const OUT = 'public/corpus';
const SHARD_TARGET = 900; // chunks per shard: a few hundred KB each

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function embedAll(texts) {
  const key = process.env.OLLAMA_API_KEY;
  const model = process.env.OLLAMA_EMBED_MODEL;
  const base = (process.env.OLLAMA_BASE_URL || 'https://ollama.com').replace(/\/+$/, '');
  if (!key || !model) return null;

  const out = [];
  for (let i = 0; i < texts.length; i += 48) {
    const batch = texts.slice(i, i + 48);
    const res = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: batch }),
    });
    if (!res.ok) throw new Error(`embed failed ${res.status}: ${await res.text()}`);
    const { embeddings } = await res.json();
    out.push(...embeddings);
    process.stdout.write(`\r  embedded ${out.length}/${texts.length}`);
  }
  process.stdout.write('\n');
  return out;
}

async function main() {
  const params = withParams({
    chunkSize: Number(arg('--chunk-size', 900)),
    chunkOverlap: Number(arg('--overlap', 180)),
    structureAware: true,
  });
  const doEmbed = process.argv.includes('--embed');

  if (!fs.existsSync(SRC)) {
    console.error(`! ${SRC} missing. Run: npm run corpus:fetch`);
    process.exit(1);
  }

  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.json'));
  const allChunks = [];
  const acts = [];

  for (const file of files) {
    const act = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));
    const docId = `corpus:${slug(act.name)}`;

    // Each statutory section is its own logical page, so the chunker keeps
    // section boundaries and we can cite "S. 73" precisely.
    const pages = act.sections.map((s, i) => ({
      page: i + 1,
      text: s.section ? `Section ${s.section}. ${s.text}` : s.text,
    }));

    // The chunker reports which page (= which statutory section) each chunk came
    // from, so we can stamp an exact citation ref instead of relying on the
    // regex guess. This is also what the eval harness judges relevance against.
    const chunks = chunkDocument(
      { docId, title: act.name, source: 'corpus', text: '', pages },
      params,
    ).map((c) => {
      const section = act.sections[(c.page ?? 1) - 1]?.section;
      const { page, ...rest } = c;
      void page;
      return section ? { ...rest, ref: `S. ${section}` } : rest;
    });

    allChunks.push(...chunks);
    acts.push({
      id: docId,
      name: act.name,
      sections: act.sections.length,
      chunks: chunks.length,
      topics: ACT_TOPICS[act.name] ?? '',
    });
  }

  /* ------------------------------------------------------------ vectors */
  let encoder = 'hashing-client';
  let dim = 512;
  if (doEmbed) {
    console.log(`• embedding ${allChunks.length} chunks with ${process.env.OLLAMA_EMBED_MODEL}`);
    const vecs = await embedAll(allChunks.map((c) => c.text));
    if (vecs?.length === allChunks.length) {
      const enc = new HashingEncoder(vecs[0].length);
      void enc;
      allChunks.forEach((c, i) => {
        c.vec = quantise(Float32Array.from(vecs[i]));
      });
      encoder = `ollama:${process.env.OLLAMA_EMBED_MODEL}`;
      dim = vecs[0].length;
    } else {
      console.warn('! embedding produced the wrong count; shipping without vectors');
    }
  }

  /* ------------------------------------------------------------- shards */
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const shards = [];
  for (let i = 0; i < allChunks.length; i += SHARD_TARGET) {
    const slice = allChunks.slice(i, i + SHARD_TARGET);
    const name = `shard-${String(shards.length).padStart(3, '0')}.json`;
    fs.writeFileSync(path.join(OUT, name), JSON.stringify(slice));
    shards.push({ file: name, chunks: slice.length, bytes: fs.statSync(path.join(OUT, name)).size });
  }

  const manifest = {
    version: 2,
    builtAt: new Date().toISOString(),
    source: 'India Code (Government of India) via V0RTEXX99/indian-legal-acts-dataset',
    encoder,
    dim,
    params: { chunkSize: params.chunkSize, chunkOverlap: params.chunkOverlap, structureAware: true },
    totals: {
      acts: acts.length,
      chunks: allChunks.length,
      chars: allChunks.reduce((n, c) => n + c.text.length, 0),
      bytes: shards.reduce((n, s) => n + s.bytes, 0),
    },
    acts,
    shards,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const mb = (manifest.totals.bytes / 1e6).toFixed(2);
  console.log(`• ${acts.length} acts -> ${allChunks.length} chunks in ${shards.length} shards (${mb} MB)`);
  console.log(`• encoder: ${encoder}`);
  const lens = allChunks.map((c) => c.text.length).sort((a, b) => a - b);
  const pct = (p) => lens[Math.floor(lens.length * p)];
  console.log(`• chunk chars  p10=${pct(0.1)}  p50=${pct(0.5)}  p90=${pct(0.9)}  max=${lens.at(-1)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
