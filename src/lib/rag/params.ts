/**
 * Every knob the retrieval pipeline exposes.
 *
 * These start deliberately "messy" (see DEFAULT_PARAMS) and are then tuned one
 * at a time by scripts/eval/sweep.mjs against eval/goldset.json. The winning
 * values are written to eval/tuned-params.json and loaded by TUNED_PARAMS.
 */
export interface RagParams {
  /** Target chunk size in characters. */
  chunkSize: number;
  /** Characters of overlap carried between adjacent chunks. */
  chunkOverlap: number;
  /** Respect section/clause headings when splitting instead of cutting blindly. */
  structureAware: boolean;
  /** Candidates pulled from each retriever before fusion. */
  candidateK: number;
  /** Chunks that actually reach the answer model. */
  topK: number;
  /** Reciprocal-rank-fusion damping constant. */
  rrfK: number;
  /**
   * How to combine the results of the rewritten queries with each other:
   * 'rrf' sums reciprocal ranks, 'best' keeps each chunk's best rank across
   * phrasings. They are paraphrases of one question, not independent retrievers.
   */
  queryFusion: 'rrf' | 'best' | 'best-score' | 'weighted';
  /** Trust decay applied to each successive rewritten query under 'weighted'. */
  queryDecay: number;
  /**
   * Add the rewriter's extracted legal terms ("Section 138", "retrenchment",
   * "identity theft") as one more query. They are the most precise signal the
   * rewriter produces, and a bag of them matches statutory headings well.
   */
  useTerms: boolean;
  /**
   * How many times a section's marginal heading ("Documents of which
   * registration is compulsory") is repeated in the lexical index. Statutory
   * headings state the topic far more directly than the body text does.
   */
  headingWeight: number;
  /** Weight of the lexical channel in fusion (dense gets 1 - this). */
  lexicalWeight: number;
  /** MMR trade-off: 1 = pure relevance, 0 = pure diversity. */
  mmrLambda: number;
  /** Drop fused hits scoring below this fraction of the best hit. */
  minScoreRatio: number;
  /** Ask the LLM to re-rank the fused candidates. */
  useReranker: boolean;
  /** How many candidates the re-ranker sees. */
  rerankTop: number;
  /** Generate extra paraphrased queries to widen recall. */
  multiQuery: number;
  /** Pull the neighbouring chunks of every winner for continuity. */
  neighborWindow: number;
  /** BM25 term-frequency saturation. */
  bm25K1: number;
  /** BM25 length normalisation. */
  bm25B: number;
  /** Boost chunks coming from the user's own upload over the statute corpus. */
  userDocBoost: number;
  /** Hard cap on characters handed to the answer model. */
  maxContextChars: number;
}

/** Intentionally un-tuned starting point - the sweep's job is to beat this. */
export const DEFAULT_PARAMS: RagParams = {
  chunkSize: 1800,
  chunkOverlap: 100,
  structureAware: false,
  candidateK: 20,
  topK: 8,
  rrfK: 60,
  queryFusion: 'rrf',
  queryDecay: 1,
  useTerms: false,
  headingWeight: 1,
  lexicalWeight: 0.5,
  mmrLambda: 1,
  minScoreRatio: 0,
  useReranker: false,
  rerankTop: 12,
  multiQuery: 0,
  neighborWindow: 0,
  bm25K1: 1.2,
  bm25B: 0.75,
  userDocBoost: 1,
  maxContextChars: 24000,
};

/** Search space explored by the sweep, one dimension at a time. */
export const PARAM_GRID: Partial<Record<keyof RagParams, Array<number | boolean | string>>> = {
  chunkSize: [600, 900, 1200, 1800, 2400],
  chunkOverlap: [0, 100, 180, 300],
  structureAware: [false, true],
  candidateK: [20, 40, 60],
  topK: [4, 6, 8, 10, 12],
  rrfK: [1, 3, 10, 30, 60, 120],
  queryFusion: ['rrf', 'best', 'best-score', 'weighted'],
  queryDecay: [0.5, 0.7, 0.85, 1],
  useTerms: [false, true],
  maxContextChars: [6000, 9000, 12000, 18000, 24000],
  headingWeight: [1, 2, 3, 4, 6, 8],
  lexicalWeight: [0.3, 0.5, 0.65, 0.8, 1],
  mmrLambda: [0.5, 0.7, 0.85, 1],
  minScoreRatio: [0, 0.15, 0.3, 0.45],
  multiQuery: [0, 2, 3],
  neighborWindow: [0, 1, 2],
  bm25K1: [0.9, 1.2, 1.6, 2],
  bm25B: [0.5, 0.65, 0.75, 0.9],
  userDocBoost: [1, 1.15, 1.35],
};

export function withParams(p?: Partial<RagParams>): RagParams {
  return { ...DEFAULT_PARAMS, ...(p ?? {}) };
}
