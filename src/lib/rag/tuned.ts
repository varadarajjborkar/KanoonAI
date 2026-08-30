import type { RagParams } from './params.ts';

/**
 * Tuned retrieval parameters.
 *
 * GENERATED FILE - written by `npm run eval:sweep`, which searches one
 * parameter at a time against eval/goldset.json and keeps a change only when it
 * measurably improves the objective on that batch. Edit the sweep, not this file.
 *
 * Objective: 0.6*hit@topK + 0.4*MRR - 0.08*(context/24000)
 *   baseline 0.0303 (hit 0.083)
 *   tuned    0.6448 (hit 0.778)
 */
export const TUNED_PARAMS: RagParams = {
  chunkSize: 600,
  chunkOverlap: 100,
  structureAware: false,
  candidateK: 40,
  topK: 12,
  rrfK: 60,
  queryFusion: "best-score",
  queryDecay: 1,
  useTerms: false,
  headingWeight: 6,
  lexicalWeight: 0.8,
  mmrLambda: 0.5,
  minScoreRatio: 0,
  useReranker: false,
  rerankTop: 12,
  multiQuery: 3,
  neighborWindow: 0,
  bm25K1: 1.6,
  bm25B: 0.75,
  userDocBoost: 1,
  maxContextChars: 24000,
};

/** Set by the sweep so the UI can show what was actually tuned. */
export const TUNING_META = {
  tunedAt: "2026-08-30T17:41:19.333Z" as string | null,
  goldSetSize: 24,
  baseline: 0.0303 as number | null,
  final: 0.6448 as number | null,
};
