# Retrieval tuning report

Generated 2026-08-30T16:13:16.004Z against `eval/goldset.json` (24 queries).

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
| baseline (untuned) | 0.0303 | 0.083 | 0.014 | 0.030 | 0.083 | 7610 | 15 |
| tuned | 0.6338 | 0.750 | 0.488 | 0.758 | 0.698 | 3362 | 15 |

## Parameter changes, in the order they were swept

| pass | parameter | from | to | objective after |
|---|---|---|---|---|
| 1 | `chunkSize` | `1800` | `600` | 0.1048 |
| 1 | `multiQuery` | `0` | `3` | 0.3674 |
| 1 | `queryFusion` | `"rrf"` | `"best-score"` | 0.3951 |
| 1 | `headingWeight` | `1` | `8` | 0.4545 |
| 1 | `lexicalWeight` | `0.5` | `1` | 0.5708 |
| 1 | `topK` | `8` | `12` | 0.5899 |
| 1 | `bm25K1` | `1.2` | `0.9` | 0.5952 |
| 1 | `mmrLambda` | `1` | `0.5` | 0.6228 |
| 2 | `topK` | `12` | `6` | 0.6338 |

## Final parameters

```json
{
  "chunkSize": 600,
  "chunkOverlap": 100,
  "structureAware": false,
  "candidateK": 20,
  "topK": 6,
  "rrfK": 60,
  "queryFusion": "best-score",
  "queryDecay": 1,
  "useTerms": false,
  "headingWeight": 8,
  "lexicalWeight": 1,
  "mmrLambda": 0.5,
  "minScoreRatio": 0,
  "useReranker": false,
  "rerankTop": 12,
  "multiQuery": 3,
  "neighborWindow": 0,
  "bm25K1": 0.9,
  "bm25B": 0.75,
  "userDocBoost": 1,
  "maxContextChars": 24000
}
```

## Re-ranker A/B

| re-ranker | objective | hit@topK | ms/query |
|---|---|---|---|
| off | 0.6338 | 0.750 | 15 |
| on | 0.6060 | 0.708 | 1407 |


## Per-query outcome (tuned)

| query | hit | reciprocal rank | coverage |
|---|---|---|---|
| `cheque-bounce` | ✅ | 1.00 | 1.00 |
| `cheque-bounce-hinglish` | ✅ | 0.50 | 1.00 |
| `deposit-not-returned` | ✅ | 0.17 | 1.00 |
| `breach-compensation` | ✅ | 1.00 | 1.00 |
| `gratuity-eligibility` | ✅ | 0.50 | 1.00 |
| `maternity-leave` | ✅ | 0.25 | 1.00 |
| `rti-apply` | ✅ | 1.00 | 1.00 |
| `domestic-violence` | ✅ | 0.50 | 1.00 |
| `posh-complaint` | ✅ | 1.00 | 1.00 |
| `accident-claim` | ✅ | 0.17 | 1.00 |
| `free-lawyer` | ✅ | 0.17 | 0.50 |
| `parents-maintenance` | ✅ | 1.00 | 1.00 |
| `retrenchment` | ❌ | 0.00 | 0.00 |
| `register-property` | ❌ | 0.00 | 0.00 |
| `make-will` | ❌ | 0.00 | 0.00 |
| `force-sale` | ❌ | 0.00 | 0.00 |
| `online-fraud` | ❌ | 0.00 | 0.00 |
| `dowry` | ✅ | 0.20 | 0.50 |
| `builder-delay` | ✅ | 1.00 | 1.00 |
| `school-seat` | ✅ | 0.25 | 1.00 |
| `divorce-grounds` | ✅ | 1.00 | 1.00 |
| `disability-job` | ❌ | 0.00 | 0.00 |
| `salary-not-paid` | ✅ | 1.00 | 0.75 |
| `cheating-offence` | ✅ | 1.00 | 1.00 |

## Not swept

- `userDocBoost` — the gold set is statute-only, so there is no uploaded
  document to trade off against. It is exercised by the decision-tree tests instead.
- `maxContextChars`, `rerankTop` — budget ceilings rather than quality knobs.
