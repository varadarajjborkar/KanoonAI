import type { Chunk } from '../types.ts';
import type { RagParams } from './params.ts';
import { extractRef } from './tokenize.ts';

/**
 * Structure-aware chunker.
 *
 * Legal text has natural retrieval units - a section, an article, a numbered
 * clause. Cutting across them is the single biggest quality killer in a legal
 * RAG, so when `structureAware` is on we split on headings first and only fall
 * back to sliding windows for sections that are too long.
 */

const HEADING = new RegExp(
  [
    String.raw`^\s*(?:Section|Sec\.|S\.)\s*\d+[A-Z]{0,2}[.\s—-]`,
    String.raw`^\s*Article\s*\d+[A-Z]{0,2}[.\s—-]`,
    String.raw`^\s*\d+[A-Z]?\.\s+[A-Z"'(]`,
    String.raw`^\s*\(\d+\)\s`,
    String.raw`^\s*(?:CHAPTER|PART)\s+[IVXLC\d]+`,
    String.raw`^\s*\d+(?:\.\d+){1,3}\s+\S`,
  ].join('|'),
  'i',
);

export function normaliseText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[­​]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\w)-\n(\w)/g, '$1$2') // de-hyphenate across line breaks
    .trim();
}

/** Split into heading-led blocks; every block keeps its own heading line. */
function splitByStructure(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (HEADING.test(line) && current.join('\n').trim().length > 120) {
      blocks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks.filter((b) => b.trim().length > 0);
}

/** Sliding window that prefers to break on sentence boundaries. */
function windowSplit(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  const step = Math.max(120, size - overlap);
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      // Look back over the last 25% of the window for a clean sentence break.
      const tail = text.slice(end - Math.floor(size * 0.25), end);
      const bp = Math.max(tail.lastIndexOf('. '), tail.lastIndexOf('.\n'), tail.lastIndexOf('\n\n'));
      if (bp > 0) end = end - Math.floor(size * 0.25) + bp + 1;
    }
    out.push(text.slice(i, end).trim());
    if (end >= text.length) break;
    i = Math.max(i + step, end - overlap);
  }
  return out.filter(Boolean);
}

export interface ChunkInput {
  docId: string;
  title: string;
  source: 'corpus' | 'user';
  text: string;
  /** Optional per-page text so we can attach page numbers to citations. */
  pages?: { page: number; text: string }[];
}

/**
 * A statute section opens with its marginal note - "Conditions precedent to
 * retrenchment of workmen" - which names the topic far more plainly than the
 * operative text. We lift it once per block and carry it on every chunk of that
 * block, so a continuation chunk is still findable by topic.
 */
function marginalNote(block: string): string | undefined {
  const body = block.replace(/^\s*Section\s+[0-9A-Z]+\.\s*/i, '').trimStart();
  const stop = body.search(/[.\u2014]/);
  if (stop < 4 || stop > 140) return undefined;
  const note = body.slice(0, stop).trim();
  return note.length > 3 ? note : undefined;
}

export function chunkDocument(input: ChunkInput, p: RagParams): Chunk[] {
  const chunks: Chunk[] = [];
  let ordinal = 0;

  const units: { text: string; page?: number }[] = input.pages?.length
    ? input.pages.map((pg) => ({ text: normaliseText(pg.text), page: pg.page }))
    : [{ text: normaliseText(input.text) }];

  for (const unit of units) {
    if (!unit.text) continue;
    const blocks = p.structureAware ? splitByStructure(unit.text) : [unit.text];
    for (const block of blocks) {
      const pieces =
        block.length > p.chunkSize * 1.35
          ? windowSplit(block, p.chunkSize, p.chunkOverlap)
          : [block];
      const heading = marginalNote(block);
      for (const piece of pieces) {
        const text = piece.trim();
        if (text.length < 40) continue; // skip page furniture / stray headers
        chunks.push({
          id: `${input.docId}#${ordinal}`,
          docId: input.docId,
          source: input.source,
          text,
          title: input.title,
          ref: extractRef(text),
          heading,
          page: unit.page,
          ordinal: ordinal++,
        });
      }
    }
  }
  return chunks;
}
