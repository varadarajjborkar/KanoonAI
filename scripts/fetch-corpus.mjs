#!/usr/bin/env node
/**
 * Step 1 of the corpus pipeline: download the section-wise Indian Acts dataset
 * and keep only the curated slice.
 *
 *   node scripts/fetch-corpus.mjs [--all]
 *
 * Source: https://github.com/V0RTEXX99/indian-legal-acts-dataset
 * Original texts: India Code (https://www.indiacode.nic.in/), Government of India.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CURATED_ACTS } from './corpus-manifest.mjs';

const SRC = 'https://raw.githubusercontent.com/V0RTEXX99/indian-legal-acts-dataset/main/acts.jsonl';
const RAW = 'data/corpus/raw/acts.jsonl';
const OUT = 'data/corpus/acts';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function download() {
  if (fs.existsSync(RAW) && fs.statSync(RAW).size > 1_000_000) {
    console.log(`• using cached ${RAW}`);
    return;
  }
  fs.mkdirSync(path.dirname(RAW), { recursive: true });
  console.log(`• downloading ${SRC} (~41 MB)`);
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await fs.promises.writeFile(RAW, Buffer.from(await res.arrayBuffer()));
}


/* ------------------------------------------------------------- cleaning */

/**
 * The upstream dataset was extracted from India Code PDFs, and that extraction
 * has two systematic faults we have to repair or citations come out wrong:
 *
 *  1. Consecutive sections get merged into one record, so the second section
 *     silently disappears. In the Indian Contract Act this is what makes s.73
 *     (compensation for breach - one of the most-cited provisions in the whole
 *     Act) unreachable: its text sits inside the record labelled s.72.
 *  2. Footnotes and Schedule rows are sometimes recorded as if they were
 *     sections, which would make us cite "s.1" for a line of marginalia.
 *
 * We split (1) apart, and strip the section number from (2) so those passages
 * stay searchable but can never be cited with a number they do not own.
 */

// e.g. "73.Compensation for loss or damage caused by breach of contract.—"
const EMBEDDED_HEADING = /(?:^|[\s\]])(\d{1,3}[A-Z]?)\.\s*([A-Z][^.\u2014]{4,90}?)\s*[.\u2014-]{1,2}\u2014/g;

/** A genuine section body opens with its marginal note, e.g. "Definitions.—". */
const LOOKS_LIKE_SECTION = /^[\s\d[\]*]*[A-Z][^.\u2014]{3,120}?\s*[.\u2014]/;

const numOf = (s) => {
  const m = String(s ?? '').match(/^(\d+)/);
  return m ? Number(m[1]) : NaN;
};

/** Recursively pull merged sections apart. */
function splitMerged(section, text) {
  const current = numOf(section);
  if (!Number.isFinite(current)) return [{ section, text }];

  EMBEDDED_HEADING.lastIndex = 0;
  let match;
  // Skip the first characters: that is this section's own heading.
  while ((match = EMBEDDED_HEADING.exec(text))) {
    if (match.index < 30) continue;
    const next = numOf(match[1]);
    // Only trust a split when the number is the plausible next section - a
    // bare "5." inside an illustration must not tear the section in half.
    if (!Number.isFinite(next) || next <= current || next > current + 6) continue;

    const head = text.slice(0, match.index).trim();
    const tailStart = match.index + match[0].length - match[0].trimStart().length;
    const tail = text.slice(tailStart).replace(/^\s*/, '');
    const rest = tail.replace(new RegExp(`^${match[1]}\\.\\s*`), '');
    return [{ section, text: head }, ...splitMerged(match[1], rest)];
  }
  return [{ section, text }];
}

function cleanSections(raw) {
  const out = [];
  for (const s of raw) {
    for (const piece of splitMerged(s.section, s.text)) {
      const text = piece.text.trim();
      if (text.length < 25) continue;
      out.push({
        // Drop the number when the body does not read like a section, so we
        // never attach a confident citation to a footnote.
        section: LOOKS_LIKE_SECTION.test(text) ? String(piece.section ?? '').trim() : '',
        text,
      });
    }
  }

  // Merged records can produce the same section twice; keep the longer body.
  const best = new Map();
  const anonymous = [];
  for (const s of out) {
    if (!s.section) {
      anonymous.push(s);
      continue;
    }
    const prev = best.get(s.section);
    if (!prev || s.text.length > prev.text.length) best.set(s.section, s);
  }
  return [...best.values(), ...anonymous];
}

async function main() {
  const all = process.argv.includes('--all');
  await download();

  const wanted = new Set(CURATED_ACTS);
  const acts = new Map();

  const rl = readline.createInterface({
    input: fs.createReadStream(RAW),
    crlfDelay: Infinity,
  });
  let lines = 0;
  let skipped = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines++;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (rec.type !== 'act' || !rec.name || !rec.text) continue;
    if (!all && !wanted.has(rec.name)) continue;

    const entry = acts.get(rec.name) ?? { name: rec.name, sections: [] };
    entry.sections.push({
      section: String(rec.section ?? '').trim(),
      text: String(rec.text).replace(/\s+/g, ' ').trim(),
    });
    acts.set(rec.name, entry);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  let chars = 0;
  let recovered = 0;
  for (const [name, entry] of acts) {
    const before = entry.sections.length;
    entry.sections = cleanSections(entry.sections);
    recovered += entry.sections.length - before;
    // Sections arrive out of order in the source; sort numerically so neighbour
    // expansion at retrieval time actually pulls adjacent law.
    entry.sections.sort((a, b) => {
      const na = parseFloat(a.section) || 0;
      const nb = parseFloat(b.section) || 0;
      return na - nb || a.section.localeCompare(b.section);
    });
    chars += entry.sections.reduce((n, s) => n + s.text.length, 0);
    fs.writeFileSync(path.join(OUT, `${slug(name)}.json`), JSON.stringify(entry));
  }

  const missing = CURATED_ACTS.filter((a) => !acts.has(a));
  console.log(`• scanned ${lines} records (${skipped} unparseable)`);
  console.log(`• wrote ${acts.size} acts, ${(chars / 1e6).toFixed(2)} M chars -> ${OUT}/`);
  console.log(`• repaired ${recovered} merged/mislabelled sections`);
  if (missing.length) console.warn(`! not found in source: ${missing.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
