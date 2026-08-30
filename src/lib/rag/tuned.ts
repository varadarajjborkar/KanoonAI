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
 *   tuned    0.6338 (hit 0.750)
 */
export const TUNED_PARAMS: RagParams = {
  chunkSize: 600,
  chunkOverlap: 100,
  structureAware: false,
  candidateK: 20,
  topK: 6,
  rrfK: 60,
  queryFusion: "best-score",
  queryDecay: 1,
  useTerms: false,
  headingWeight: 8,
  lexicalWeight: 1,
  mmrLambda: 0.5,
  minScoreRatio: 0,
  useReranker: false,
  rerankTop: 12,
  multiQuery: 3,
  neighborWindow: 0,
  bm25K1: 0.9,
  bm25B: 0.75,
  userDocBoost: 1,
  maxContextChars: 24000,
};

/** Set by the sweep so the UI can show what was actually tuned. */
export const TUNING_META = {
  tunedAt: "2026-08-30T16:13:16.001Z" as string | null,
  goldSetSize: 24,
  baseline: 0.0303 as number | null,
  final: 0.6338 as number | null,
};
