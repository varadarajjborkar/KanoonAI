#!/usr/bin/env node
/**
 * One-parameter-at-a-time retrieval sweep (coordinate ascent).
 *
 *   node scripts/eval/sweep.mjs [--passes 2] [--no-rerank]
 *
 * Method: start from the deliberately untuned DEFAULT_PARAMS, then walk the
 * parameters in order of expected impact. For each one, hold everything else
 * fixed, try every value in its grid against the same batch, and keep the value
 * only if it improves the objective. Repeat for a second pass, because later
 * parameters change what the earlier ones should have been.
 *
 * The objective is deliberately not raw recall:
 *
 *     0.6*hit + 0.4*MRR - 0.08*(contextChars/24000) - 0.02*(ms/1000)
 *
 * Recall alone is bought by raising topK, and ranking quality can be bought with
 * an expensive re-ranker. Pricing both context and time makes those the real
 * trade-offs they are in production.
 *
 * Writes the winner to src/lib/rag/tuned.ts and a report to eval/report.md.
 */
import fs from 'node:fs';
import { DEFAULT_PARAMS, PARAM_GRID } from '../../src/lib/rag/params.ts';
import { evaluate, evaluateAveraged, fmt, loadBatch } from './lib.mjs';
import { ensureRewrites, expansionFrom, loadSamples } from './rewrites.mjs';

/** Swept in order of expected impact: chunking first, then fusion, then filters. */
const ORDER = [
  'structureAware',
  'chunkSize',
  'chunkOverlap',
  'multiQuery',
  'queryFusion',
  'queryDecay',
  'useTerms',
  'headingWeight',
  'lexicalWeight',
  'candidateK',
  'topK',
  'rrfK',
  'bm25K1',
  'bm25B',
  'mmrLambda',
  'minScoreRatio',
  'neighborWindow',
  'maxContextChars',
];

/** Minimum objective gain before a parameter change is accepted. */
const IMPROVEMENT_EPS = 0.005;

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const passes = Number(arg('--passes', 2));
  const batch = loadBatch();

  console.log(`\nKanoonAI retrieval sweep — ${batch.length} gold queries\n${'='.repeat(64)}`);

  const samples = loadSamples();
  const expansions = samples.length
    ? samples.map(expansionFrom)
    : [expansionFrom(await ensureRewrites(batch))];
  console.log(
    `averaging over ${expansions.length} fixed rewrite sample(s) from eval/rewrites/\n` +
      '(rewriting is a model call; one sample is not a measurement)',
  );
  const opts = {};
  const run = (params, extra = {}) => evaluateAveraged(batch, params, expansions, { ...opts, ...extra });

  let current = { ...DEFAULT_PARAMS };
  const baseline = await run(current);
  report('BASELINE (untuned)', baseline);

  const history = [];
  let best = baseline;

  for (let pass = 1; pass <= passes; pass++) {
    console.log(`\n${'='.repeat(64)}\nPASS ${pass} of ${passes}\n${'='.repeat(64)}`);
    let improvedThisPass = false;

    for (const param of ORDER) {
      const grid = PARAM_GRID[param];
      if (!grid) continue;

      console.log(`\n▸ ${param}   (currently ${JSON.stringify(current[param])})`);
      console.log(
        `  ${'value'.padEnd(9)}${'obj'.padEnd(9)}${'hit'.padEnd(8)}${'MRR'.padEnd(8)}` +
          `${'nDCG'.padEnd(8)}${'cover'.padEnd(8)}${'ctx'.padEnd(8)}ms`,
      );

      let bestValue = current[param];
      let bestResult = best;

      for (const value of grid) {
        const trial = { ...current, [param]: value };
        const result = await run(trial);
        // Require a real margin. With a 1e-6 epsilon the sweep happily traded
        // 3.7x the context for 0.0013 of objective - a win indistinguishable
        // from noise, paid for with latency the user actually feels.
        const winner = result.objective > bestResult.objective + IMPROVEMENT_EPS;
        if (winner) {
          bestValue = value;
          bestResult = result;
        }
        console.log(
          `  ${String(value).padEnd(9)}${fmt(result.objective, 4).padEnd(9)}` +
            `${fmt(result.hit, 3).padEnd(8)}${fmt(result.mrr, 3).padEnd(8)}` +
            `${fmt(result.ndcg, 3).padEnd(8)}${fmt(result.coverage, 3).padEnd(8)}` +
            `${String(Math.round(result.avgContext)).padEnd(8)}${fmt(result.msPerQuery, 0)}` +
            (winner ? '  <- best' : ''),
        );
      }

      if (JSON.stringify(bestValue) !== JSON.stringify(current[param])) {
        console.log(
          `  => ${param}: ${JSON.stringify(current[param])} -> ${JSON.stringify(bestValue)} ` +
            `(objective ${fmt(best.objective, 4)} -> ${fmt(bestResult.objective, 4)})`,
        );
        history.push({
          pass,
          param,
          from: current[param],
          to: bestValue,
          objective: bestResult.objective,
          hit: bestResult.hit,
        });
        current = { ...current, [param]: bestValue };
        best = bestResult;
        improvedThisPass = true;
      } else {
        console.log('  => unchanged');
      }
    }

    if (!improvedThisPass) {
      console.log('\nNo parameter improved in this pass; converged.');
      break;
    }
  }

  /* ---------------------------------------------------------- re-ranker */
  // Evaluated separately, not in the grid: it costs one model call per query
  // per configuration, which would dominate the sweep's runtime for a decision
  // that is a straight yes/no.
  let rerankResult = null;
  if (!process.argv.includes('--no-rerank') && process.env.OLLAMA_API_KEY) {
    console.log(`\n${'='.repeat(64)}\nRE-RANKER A/B\n${'='.repeat(64)}`);
    const { makeReranker } = await import('./rerank.mjs');
    rerankResult = await run({ ...current, useReranker: true }, { rerank: makeReranker() });
    console.log(`  off: obj ${fmt(best.objective, 4)}  hit ${fmt(best.hit, 3)}  ${fmt(best.msPerQuery, 0)}ms`);
    console.log(
      `  on : obj ${fmt(rerankResult.objective, 4)}  hit ${fmt(rerankResult.hit, 3)}  ${fmt(rerankResult.msPerQuery, 0)}ms`,
    );
    // The re-ranker costs ~400x the latency of pure retrieval, so it has to earn
    // its place with a real margin, not a rounding-level win.
    const RERANK_MIN_GAIN = 0.01;
    if (rerankResult.objective > best.objective + RERANK_MIN_GAIN) {
      console.log('  => re-ranker ON');
      current = { ...current, useReranker: true };
      best = rerankResult;
    } else {
      console.log(
        `  => re-ranker OFF (gain ${fmt(rerankResult.objective - best.objective, 4)} < ${RERANK_MIN_GAIN} required to justify the latency)`,
      );
    }
  }

  /* -------------------------------------------------------------- write */
  report('FINAL (tuned)', best);
  console.log('\nChanges made:');
  for (const h of history) {
    console.log(`  pass ${h.pass}  ${h.param}: ${JSON.stringify(h.from)} -> ${JSON.stringify(h.to)}`);
  }
  console.log(
    `\nobjective ${fmt(baseline.objective, 4)} -> ${fmt(best.objective, 4)}   ` +
      `hit@topK ${fmt(baseline.hit, 3)} -> ${fmt(best.hit, 3)}`,
  );

  writeTuned(current, { baseline, best, batch });
  writeReport({ current, baseline, best, history, batch, rerankResult });
  console.log('\n• wrote src/lib/rag/tuned.ts');
  console.log('• wrote eval/report.md');

  const stillMissing = best.perQuery.filter((q) => !q.hit).map((q) => q.id);
  if (stillMissing.length) console.log(`\nStill missed: ${stillMissing.join(', ')}`);
}

function report(label, r) {
  console.log(`\n${label}`);
  console.log(`  objective ${fmt(r.objective, 4)}   hit ${fmt(r.hit, 3)}   MRR ${fmt(r.mrr, 3)}   nDCG ${fmt(r.ndcg, 3)}`);
  console.log(`  coverage ${fmt(r.coverage, 3)}   ctx ${Math.round(r.avgContext)} chars   ${fmt(r.msPerQuery, 0)} ms/query   ${r.chunkCount} chunks`);
  if (r.samples > 1) console.log(`  averaged over ${r.samples} rewrite samples, hit spread ${fmt(r.hitSpread, 3)}`);
}

function writeTuned(params, { baseline, best, batch }) {
  const body = Object.entries(params)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');

  fs.writeFileSync(
    'src/lib/rag/tuned.ts',
    `import type { RagParams } from './params.ts';

/**
 * Tuned retrieval parameters.
 *
 * GENERATED FILE - written by \`npm run eval:sweep\`, which searches one
 * parameter at a time against eval/goldset.json and keeps a change only when it
 * measurably improves the objective on that batch. Edit the sweep, not this file.
 *
 * Objective: 0.6*hit@topK + 0.4*MRR - 0.08*(context/24000)
 *   baseline ${baseline.objective.toFixed(4)} (hit ${baseline.hit.toFixed(3)})
 *   tuned    ${best.objective.toFixed(4)} (hit ${best.hit.toFixed(3)})
 */
export const TUNED_PARAMS: RagParams = {
${body}
};

/** Set by the sweep so the UI can show what was actually tuned. */
export const TUNING_META = {
  tunedAt: ${JSON.stringify(new Date().toISOString())} as string | null,
  goldSetSize: ${batch.length},
  baseline: ${baseline.objective.toFixed(4)} as number | null,
  final: ${best.objective.toFixed(4)} as number | null,
};
`,
  );
}

function writeReport({ current, baseline, best, history, batch, rerankResult }) {
  const row = (r) =>
    `| ${fmt(r.objective, 4)} | ${fmt(r.hit, 3)} | ${fmt(r.mrr, 3)} | ${fmt(r.ndcg, 3)} | ` +
    `${fmt(r.coverage, 3)} | ${Math.round(r.avgContext)} | ${fmt(r.msPerQuery, 0)} |`;

  const md = `# Retrieval tuning report

Generated ${new Date().toISOString()} against \`eval/goldset.json\` (${batch.length} queries).

## Objective

\`\`\`
0.6*hit + 0.4*MRR - 0.08*(contextChars/24000) - 0.02*(ms/1000)
\`\`\`

Recall on its own is bought by raising \`topK\`, and ranking quality can be bought
with an expensive re-ranker. Pricing both context and time turns those into the
real trade-offs they are in production.

## Result

| run | objective | hit@topK | MRR | nDCG | coverage | ctx chars | ms/query |
|---|---|---|---|---|---|---|---|
| baseline (untuned) ${row(baseline)}
| tuned ${row(best)}

## Parameter changes, in the order they were swept

| pass | parameter | from | to | objective after |
|---|---|---|---|---|
${history.map((h) => `| ${h.pass} | \`${h.param}\` | \`${JSON.stringify(h.from)}\` | \`${JSON.stringify(h.to)}\` | ${fmt(h.objective, 4)} |`).join('\n') || '| — | none improved | | | |'}

## Final parameters

\`\`\`json
${JSON.stringify(current, null, 2)}
\`\`\`

${rerankResult ? `## Re-ranker A/B\n\n| re-ranker | objective | hit@topK | ms/query |\n|---|---|---|---|\n| off | ${fmt(best.objective, 4)} | ${fmt(best.hit, 3)} | ${fmt(best.msPerQuery, 0)} |\n| on | ${fmt(rerankResult.objective, 4)} | ${fmt(rerankResult.hit, 3)} | ${fmt(rerankResult.msPerQuery, 0)} |\n` : ''}

## Per-query outcome (tuned)

| query | hit | reciprocal rank | coverage |
|---|---|---|---|
${best.perQuery.map((q) => `| \`${q.id}\` | ${q.hit ? '✅' : '❌'} | ${fmt(q.rr, 2)} | ${fmt(q.coverage, 2)} |`).join('\n')}

## Not swept

- \`userDocBoost\` — the gold set is statute-only, so there is no uploaded
  document to trade off against. It is exercised by the decision-tree tests instead.
- \`maxContextChars\`, \`rerankTop\` — budget ceilings rather than quality knobs.
`;
  fs.writeFileSync('eval/report.md', md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
