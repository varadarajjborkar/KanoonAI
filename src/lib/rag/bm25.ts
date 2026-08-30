import type { Chunk, RetrievalHit } from '../types.ts';
import { tokenize } from './tokenize.ts';


/**
 * Okapi BM25 over an in-memory inverted index.
 *
 * Runs entirely in the browser against whatever is in IndexedDB, which is the
 * point: the user's document never leaves their machine to be searched.
 */
export class BM25Index {
  private df = new Map<string, number>();
  private postings = new Map<string, Array<[number, number]>>(); // term -> [docIdx, tf]
  private lengths: number[] = [];
  private avgLen = 0;
  private chunks: Chunk[] = [];

  private k1: number;
  private b: number;
  private headingWeight: number;

  constructor(chunks: Chunk[], k1 = 1.2, b = 0.75, headingWeight = 1) {
    this.k1 = k1;
    this.b = b;
    this.headingWeight = headingWeight;
    this.build(chunks);
  }

  private build(chunks: Chunk[]) {
    this.chunks = chunks;
    let total = 0;
    chunks.forEach((c, idx) => {
      const terms = tokenize(`${c.title} ${c.ref ?? ''} ${c.text}`);
      // Repeating the section's marginal note raises its term frequencies, so a
      // query about "registering my land papers" can find the section actually
      // titled "Documents of which registration is compulsory". Only a real
      // heading is boosted - amplifying the first line of a continuation chunk
      // would just promote whatever sentence happened to be cut in half.
      if (c.heading) {
        const headingTerms = tokenize(c.heading);
        for (let r = 1; r < this.headingWeight; r++) terms.push(...headingTerms);
      }
      this.lengths[idx] = terms.length;
      total += terms.length;
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [term, count] of tf) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
        const list = this.postings.get(term) ?? [];
        list.push([idx, count]);
        this.postings.set(term, list);
      }
    });
    this.avgLen = chunks.length ? total / chunks.length : 1;
  }

  get size() {
    return this.chunks.length;
  }

  search(query: string, k: number): RetrievalHit[] {
    const qTerms = tokenize(query);
    if (!qTerms.length || !this.chunks.length) return [];
    const scores = new Map<number, number>();
    const N = this.chunks.length;

    for (const term of new Set(qTerms)) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const df = this.df.get(term) ?? 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const [idx, tf] of posting) {
        const norm = 1 - this.b + this.b * (this.lengths[idx] / this.avgLen);
        const contrib = (idf * (tf * (this.k1 + 1))) / (tf + this.k1 * norm);
        scores.set(idx, (scores.get(idx) ?? 0) + contrib);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([idx, score], rank) => ({ chunk: this.chunks[idx], score, bm25: score, rank }));
  }
}
