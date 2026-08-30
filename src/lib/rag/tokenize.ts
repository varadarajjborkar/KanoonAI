/** Lexical utilities shared by the chunker, BM25 and the local encoder. */

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those of in on at to for with by from as is are was were be been being it its
   i you he she they we me him her them my your our their what which who whom how when where why do does did done have has had
   not no nor so such can could should would may might must will shall about into over under again further once here there all
   any both each few more most other some only own same too very s t just don now`.split(/\s+/),
);

/** Legal English is full of these; keeping them hurts BM25 far more than it helps. */
const LEGALESE_NOISE = new Set(['hereinafter', 'hereto', 'thereof', 'therein', 'whereas', 'aforesaid', 'hereby']);

/**
 * Very light suffix stripping. A full Porter stemmer over-collapses legal terms
 * ("assignment" -> "assign" is fine, "liability" -> "liabil" is not worth it),
 * so we only fold the endings that actually cause misses in practice.
 */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  for (const suf of ['ations', 'ation', 'ements', 'ement', 'ingly', 'edly', 'ies', 'ing', 'ed', 'es', 's']) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) {
      const base = w.slice(0, -suf.length);
      return suf === 'ies' ? `${base}y` : base;
    }
  }
  return w;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  // Keep section refs like "section 73" or "s.73" glued so they survive as one term.
  const normalised = text
    .toLowerCase()
    .replace(/\bsec(?:tion)?s?\.?\s*(\d+[a-z]*)/g, ' section$1 ')
    .replace(/\bart(?:icle)?s?\.?\s*(\d+[a-z]*)/g, ' article$1 ')
    .replace(/\bcl(?:ause)?\.?\s*(\d+(?:\.\d+)*)/g, ' clause$1 ');
  for (const raw of normalised.split(/[^a-z0-9$₹]+/)) {
    if (!raw || raw.length < 2) continue;
    if (STOPWORDS.has(raw) || LEGALESE_NOISE.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** Pull out statute references so we can surface a precise citation label. */
export function extractRef(text: string): string | undefined {
  const m =
    text.match(/\b(?:Section|Sec\.?|S\.)\s*(\d+[A-Z]{0,2})/i) ??
    text.match(/\bArticle\s*(\d+[A-Z]{0,2})/i) ??
    text.match(/\bClause\s*(\d+(?:\.\d+)*)/i);
  if (!m) return undefined;
  const kind = /article/i.test(m[0]) ? 'Art.' : /clause/i.test(m[0]) ? 'Cl.' : 'S.';
  return `${kind} ${m[1]}`;
}
