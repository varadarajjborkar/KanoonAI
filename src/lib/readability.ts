/**
 * Readability scoring.
 *
 * The whole point of this product is that someone with little legal vocabulary
 * and shaky English can read the answer. So "was the answer good?" includes
 * "could a 13-year-old read it?", and that is measurable rather than a vibe.
 */

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:es|ed|[^laeiouy]e)$/, '')
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export interface Readability {
  /** Flesch Reading Ease: higher is easier. 60+ is plain English. */
  flesch: number;
  /** Approximate school grade needed to read it. */
  grade: number;
  words: number;
  sentences: number;
  longWordRatio: number;
}

export function readability(text: string): Readability {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = clean.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const sentences = clean.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 2);
  const nWords = Math.max(1, words.length);
  const nSent = Math.max(1, sentences.length);
  const totalSyl = words.reduce((a, w) => a + syllables(w), 0);

  const wps = nWords / nSent;
  const spw = totalSyl / nWords;

  return {
    flesch: Math.round((206.835 - 1.015 * wps - 84.6 * spw) * 10) / 10,
    grade: Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10,
    words: nWords,
    sentences: nSent,
    longWordRatio: words.filter((w) => w.length > 12).length / nWords,
  };
}

/** Jargon that must never appear unexplained in an answer aimed at a layperson. */
export const JARGON = [
  'hereinafter', 'heretofore', 'thereof', 'therein', 'hereby', 'whereas',
  'aforesaid', 'notwithstanding', 'indemnify', 'indemnification', 'estoppel',
  'force majeure', 'lien', 'covenant', 'sine die', 'prima facie', 'ultra vires',
  'ex parte', 'mutatis mutandis', 'inter alia', 'pursuant to', 'liquidated damages',
  'subrogation', 'novation', 'arbitration', 'jurisdiction', 'injunction',
];

export function unexplainedJargon(text: string): string[] {
  const lower = text.toLowerCase();
  return JARGON.filter((term) => {
    if (!lower.includes(term)) return false;
    // Treat it as explained if the answer defines it nearby: quotes, a dash, or
    // "means" / "i.e." within the same sentence.
    const idx = lower.indexOf(term);
    const window = lower.slice(idx, idx + 160);
    return !/(means|meaning|that is|i\.e\.|in simple|in plain|— |- |\(|"|')/.test(window);
  });
}
