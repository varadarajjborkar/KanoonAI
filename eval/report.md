# Retrieval tuning report

Generated 2026-08-30T17:41:19.338Z against `eval/goldset.json` (24 queries).

## Objective

```
0.6 * hit@topK  +  0.4 * MRR  -  0.08 * (avgContextChars / 24000)
```

Recall on its own is bought by raising `topK`. The context penalty turns that
into a real trade-off, which is what it is in production: a bigger context costs
latency, money, and the model's attention.

## Result

| run | objective | hit@topK | MRR | nDCG | coverage | ctx chars | ms/query |
|---|---|---|---|---|---|---|---|
| baseline (untuned) | 0.0303 | 0.083 | 0.014 | 0.030 | 0.083 | 7610 | 14 |
| tuned | 0.6448 | 0.778 | 0.497 | 0.749 | 0.715 | 6263 | 89 |

## Parameter changes, in the order they were swept

| pass | parameter | from | to | objective after |
|---|---|---|---|---|
| 1 | `chunkSize` | `1800` | `600` | 0.1048 |
| 1 | `multiQuery` | `0` | `3` | 0.4924 |
| 1 | `headingWeight` | `1` | `6` | 0.5073 |
| 1 | `lexicalWeight` | `0.5` | `1` | 0.5536 |
| 1 | `topK` | `8` | `12` | 0.5818 |
| 1 | `mmrLambda` | `1` | `0.5` | 0.5931 |
| 2 | `queryFusion` | `"rrf"` | `"best-score"` | 0.6102 |
| 2 | `lexicalWeight` | `1` | `0.8` | 0.6279 |
| 2 | `candidateK` | `20` | `40` | 0.6365 |
| 2 | `bm25K1` | `1.2` | `1.6` | 0.6448 |

## Final parameters

```json
{
  "chunkSize": 600,
  "chunkOverlap": 100,
  "structureAware": false,
  "candidateK": 40,
  "topK": 12,
  "rrfK": 60,
  "queryFusion": "best-score",
  "queryDecay": 1,
  "useTerms": false,
  "headingWeight": 6,
  "lexicalWeight": 0.8,
  "mmrLambda": 0.5,
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
| off | 0.6448 | 0.778 | 89 |
| on | 0.6233 | 0.750 | 1327 |


## Per-query outcome (tuned)

| query | hit | reciprocal rank | coverage |
|---|---|---|---|
| `cheque-bounce` | ✅ | 0.53 | 1.00 |
| `cheque-bounce-hinglish` | ✅ | 0.48 | 1.00 |
| `deposit-not-returned` | ❌ | 0.00 | 0.00 |
| `breach-compensation` | ✅ | 0.56 | 0.67 |
| `gratuity-eligibility` | ✅ | 1.00 | 1.00 |
| `maternity-leave` | ✅ | 0.18 | 0.67 |
| `rti-apply` | ✅ | 0.69 | 1.00 |
| `domestic-violence` | ✅ | 1.00 | 1.00 |
| `posh-complaint` | ✅ | 0.67 | 1.00 |
| `accident-claim` | ✅ | 0.44 | 0.67 |
| `free-lawyer` | ✅ | 0.45 | 0.83 |
| `parents-maintenance` | ✅ | 1.00 | 1.00 |
| `retrenchment` | ❌ | 0.00 | 0.00 |
| `register-property` | ✅ | 0.33 | 0.33 |
| `make-will` | ✅ | 0.17 | 0.33 |
| `force-sale` | ✅ | 0.08 | 0.67 |
| `online-fraud` | ✅ | 0.57 | 0.50 |
| `dowry` | ✅ | 0.23 | 0.50 |
| `builder-delay` | ✅ | 0.40 | 0.67 |
| `school-seat` | ✅ | 0.36 | 1.00 |
| `divorce-grounds` | ✅ | 0.56 | 1.00 |
| `disability-job` | ✅ | 1.00 | 1.00 |
| `salary-not-paid` | ✅ | 0.83 | 0.67 |
| `cheating-offence` | ✅ | 0.40 | 0.67 |

## Not swept

- `userDocBoost` — the gold set is statute-only, so there is no uploaded
  document to trade off against. It is exercised by the decision-tree tests instead.
- `maxContextChars`, `rerankTop` — budget ceilings rather than quality knobs.
