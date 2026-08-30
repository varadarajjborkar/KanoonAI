# Retrieval tuning report

Generated 2026-08-30T18:01:32.588Z against `eval/goldset.json` (24 queries).

## Objective

```
0.6*hit + 0.4*MRR - 0.08*(contextChars/24000) - 0.02*(ms/1000)
```

Recall on its own is bought by raising `topK`, and ranking quality can be bought
with an expensive re-ranker. Pricing both context and time turns those into the
real trade-offs they are in production.

## Result

| run | objective | hit@topK | MRR | nDCG | coverage | ctx chars | ms/query |
|---|---|---|---|---|---|---|---|
| baseline (untuned) | 0.0301 | 0.083 | 0.014 | 0.030 | 0.083 | 7610 | 14 |
| tuned | 0.5952 | 0.764 | 0.398 | 0.907 | 0.698 | 6683 | 4 |

## Parameter changes, in the order they were swept

| pass | parameter | from | to | objective after |
|---|---|---|---|---|
| 1 | `chunkSize` | `1800` | `600` | 0.1042 |
| 1 | `multiQuery` | `0` | `3` | 0.4293 |
| 1 | `headingWeight` | `1` | `3` | 0.4956 |
| 1 | `lexicalWeight` | `0.5` | `1` | 0.5512 |
| 1 | `topK` | `8` | `12` | 0.5883 |
| 1 | `bm25K1` | `1.2` | `1.6` | 0.5952 |

## Final parameters

```json
{
  "chunkSize": 600,
  "chunkOverlap": 100,
  "structureAware": false,
  "candidateK": 20,
  "topK": 12,
  "rrfK": 60,
  "queryFusion": "rrf",
  "queryDecay": 1,
  "useTerms": false,
  "headingWeight": 3,
  "lexicalWeight": 1,
  "mmrLambda": 1,
  "minScoreRatio": 0,
  "useReranker": false,
  "rerankTop": 12,
  "multiQuery": 3,
  "neighborWindow": 0,
  "bm25K1": 1.6,
  "bm25B": 0.75,
  "userDocBoost": 1,
  "maxContextChars": 24000
}
```

## Re-ranker A/B

| re-ranker | objective | hit@topK | ms/query |
|---|---|---|---|
| off | 0.5952 | 0.764 | 4 |
| on | 0.5862 | 0.764 | 2180 |


## Per-query outcome (tuned)

| query | hit | reciprocal rank | coverage |
|---|---|---|---|
| `cheque-bounce` | ✅ | 0.78 | 1.00 |
| `cheque-bounce-hinglish` | ✅ | 0.53 | 1.00 |
| `deposit-not-returned` | ❌ | 0.00 | 0.00 |
| `breach-compensation` | ✅ | 1.00 | 0.83 |
| `gratuity-eligibility` | ✅ | 0.83 | 1.00 |
| `maternity-leave` | ✅ | 0.15 | 1.00 |
| `rti-apply` | ✅ | 0.46 | 1.00 |
| `domestic-violence` | ✅ | 0.49 | 1.00 |
| `posh-complaint` | ✅ | 0.67 | 1.00 |
| `accident-claim` | ✅ | 0.13 | 1.00 |
| `free-lawyer` | ❌ | 0.00 | 0.00 |
| `parents-maintenance` | ✅ | 0.44 | 1.00 |
| `retrenchment` | ❌ | 0.00 | 0.00 |
| `register-property` | ✅ | 0.38 | 0.67 |
| `make-will` | ✅ | 0.11 | 0.33 |
| `force-sale` | ✅ | 0.09 | 0.67 |
| `online-fraud` | ✅ | 0.70 | 0.50 |
| `dowry` | ✅ | 0.17 | 0.33 |
| `builder-delay` | ✅ | 0.33 | 0.33 |
| `school-seat` | ✅ | 0.20 | 1.00 |
| `divorce-grounds` | ✅ | 1.00 | 1.00 |
| `disability-job` | ✅ | 0.78 | 1.00 |
| `salary-not-paid` | ✅ | 0.15 | 0.42 |
| `cheating-offence` | ✅ | 0.16 | 0.67 |

## Not swept

- `userDocBoost` — the gold set is statute-only, so there is no uploaded
  document to trade off against. It is exercised by the decision-tree tests instead.
- `maxContextChars`, `rerankTop` — budget ceilings rather than quality knobs.
