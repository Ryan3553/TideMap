// Stage 1b — validate the harmonic tide model before trusting it to label 2023
// scenes. Two tests:
//   A. holdout: fit on 2025+2026 extrema only, predict the 2024 extrema
//      (a full year OUTSIDE the fit window, backwards — the same kind of
//      extrapolation the 2023 labelling requires).
//   B. in-sample: fit on all years, check residual at every extremum.
// Also compares the harmonic model against the cosine interpolator at the
// 29 already-labelled scene acquisition instants.
import fs from 'fs';
import path from 'path';
import { extrema, tideAt } from './lib/tide.mjs';
import { fitHarmonic } from './lib/harmonic.mjs';
import { dirs } from './lib/config.mjs';

const yr = (t) => new Date(t).getUTCFullYear();
const stats = (errs) => {
  const n = errs.length, mean = errs.reduce((a, b) => a + b, 0) / n;
  const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / n);
  const max = Math.max(...errs.map(Math.abs));
  return { n, bias: +mean.toFixed(4), rmse: +rmse.toFixed(4), maxAbs: +max.toFixed(4) };
};

// --- A. backwards holdout ---
const fitSet = extrema.filter(e => yr(e.t) >= 2025);
const holdout = extrema.filter(e => yr(e.t) === 2024);
const fA = fitHarmonic(fitSet);
const errA = holdout.map(e => fA(e.t) - e.h);
const A = stats(errA);
console.log(`A. HOLDOUT  fit on ${fitSet.length} extrema (2025-26), predict ${holdout.length} extrema (2024, backwards extrapolation)`);
console.log(`   rmse ${A.rmse} m   bias ${A.bias} m   max|err| ${A.maxAbs} m`);

// --- B. in-sample ---
const fB = fitHarmonic(extrema);
const B = stats(extrema.map(e => fB(e.t) - e.h));
console.log(`B. IN-SAMPLE  ${B.n} extrema  rmse ${B.rmse} m   max|err| ${B.maxAbs} m`);
console.log(`   (LINZ publishes heights rounded to 0.1 m, so ~0.029 m rmse is the quantisation floor)`);

// --- C. agreement at the actual scene instants ---
// NB: compare against tideGauge (the UNLAGGED prediction). scenes.json's `tide`
// carries the effective-tide lag and is not the same quantity.
const scenes = JSON.parse(fs.readFileSync(path.join(dirs.out, 'scenes.json'), 'utf8'));
const withCos = scenes.filter(s => s.tideCosine != null);
const errC = withCos.map(s => fB(Date.parse(s.datetime)) - s.tideCosine);
const C = stats(errC);
console.log(`C. SCENE INSTANTS  ${C.n} scenes: harmonic vs cosine-interp (both unlagged)`);
console.log(`   rmse ${C.rmse} m   bias ${C.bias} m   max|err| ${C.maxAbs} m`);
console.log(`   (this is the disagreement between two ways of reading the same tables,`);
console.log(`    i.e. the uncertainty in the tide LABEL itself)`);

// --- D. do any scenes fall outside the tide-table window? ---
const outside = scenes.filter(s => s.tideCosine == null);
console.log(`D. scenes outside the tide-table window: ${outside.length}${outside.length ? ' (' + outside.map(s => s.datetime.slice(0, 10)).join(', ') + ')' : ' — all covered by official tables'}`);

fs.writeFileSync(path.join(dirs.out, 'tide-model-check.json'), JSON.stringify({
  holdout2024: A, inSample: B, sceneInstants: C,
  scenesOutsideTables: outside.length,
  tableYears: [...new Set(extrema.map(e => new Date(e.t).getUTCFullYear()))].sort(),
}, null, 2));
console.log('\nwrote out/tide-model-check.json');
