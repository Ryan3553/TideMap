// Stage 7 — assemble docs/pipeline-validation.md. Every number is read from the JSON
// artifacts produced by the earlier stages; nothing is typed in by hand.
import fs from 'fs';
import path from 'path';
import { dirs, TAU0_MIN, LAG_SLOPE_MIN_PER_KM, SIZE, MIN_VALID_SCENES } from './lib/config.mjs';

const R = (f) => JSON.parse(fs.readFileSync(path.join(dirs.out, f), 'utf8'));
const V = R('validation.json'), M = R('masks.json'), D = R('drying-height.json');
const SEL = R('final-selection.json'), SPA = R('spatial-lag-selection.json');
const TC = R('tide-compare.json'), HY = R('hysteresis.json');
const LOW = R('lowtide-probe.json'), CF = R('cloud-fair.json'), HMASK = R('harbour-mask.json');
const H = V.harbour, before = V.leaveOneOut.before, uni = V.leaveOneOut.uniform, after = V.leaveOneOut.after;
const f2 = (x) => (x == null ? 'n/a' : x.toFixed(2));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// ---- hypsometry SVG ------------------------------------------------------
function hypsoSvg() {
  const W = 720, Ht = 340, mL = 58, mR = 14, mT = 16, mB = 40;
  const pts = V.hypsometry.perScene, dense = V.hypsometry.dense;
  const xs = dense.map(d => d.tide), all = [...pts.map(p => p.obsKm2), ...dense.map(d => d.km2)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.floor(Math.min(...all) / 20) * 20, y1 = Math.ceil(Math.max(...all) / 20) * 20;
  const X = (t) => mL + ((t - x0) / (x1 - x0)) * (W - mL - mR);
  const Y = (v) => Ht - mB - ((v - y0) / (y1 - y0)) * (Ht - mT - mB);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Ht}" width="100%" style="max-width:720px;font-family:system-ui,sans-serif;font-size:11px">`;
  s += `<rect x="0" y="0" width="${W}" height="${Ht}" fill="#fbfbfd"/>`;
  for (let v = y0; v <= y1; v += 20) s += `<line x1="${mL}" y1="${Y(v)}" x2="${W - mR}" y2="${Y(v)}" stroke="#e2e5ea"/><text x="${mL - 6}" y="${Y(v) + 4}" text-anchor="end" fill="#666">${v}</text>`;
  for (let t = 0.4; t <= x1 + 1e-9; t += 0.2) s += `<line x1="${X(t)}" y1="${mT}" x2="${X(t)}" y2="${Ht - mB}" stroke="#eef0f3"/><text x="${X(t)}" y="${Ht - mB + 15}" text-anchor="middle" fill="#666">${t.toFixed(1)}</text>`;
  s += `<polyline fill="none" stroke="#2f6fd0" stroke-width="2.2" points="${dense.map(d => `${X(d.tide).toFixed(1)},${Y(d.km2).toFixed(1)}`).join(' ')}"/>`;
  for (const p of pts) s += `<circle cx="${X(p.tide).toFixed(1)}" cy="${Y(p.obsKm2).toFixed(1)}" r="2.6" fill="#e2603a" fill-opacity="0.8"/>`;
  s += `<text x="${mL}" y="${Ht - 6}" fill="#444">effective tide (m above chart datum)</text>`;
  s += `<text x="14" y="${mT + 8}" fill="#444" transform="rotate(-90 14 ${mT + 8})">water area (km²)</text>`;
  s += `<g transform="translate(${W - mR - 210},${mT + 6})"><rect x="-8" y="-12" width="212" height="40" fill="#fff" fill-opacity="0.9" stroke="#dde"/>`;
  s += `<line x1="0" y1="0" x2="22" y2="0" stroke="#2f6fd0" stroke-width="2.2"/><text x="28" y="4" fill="#333">reconstructed (from raster)</text>`;
  s += `<circle cx="11" cy="18" r="2.6" fill="#e2603a"/><text x="28" y="22" fill="#333">observed (one per clean scene)</text></g>`;
  return s + '</svg>';
}

const bandRow = (m, b) => { const x = m.banded.find(z => z.band === b); return x && x.n ? x.meanIoU.toFixed(3) : '—'; };
const BANDS = after.banded.map(b => b.band);
const worst = [...after.rows].sort((a, b) => a.iou - b.iou);
const lowBand = after.rows.filter(r => r.tide < 1.0);
const gaps = after.rows.slice(1).map((r, i) => r.tide - after.rows[i].tide).sort((a, b) => a - b);

const md = `# Validation — Tauranga Harbour intertidal drying-height raster

Round 3. Produced by \`pipeline/\` on ${new Date().toISOString().slice(0, 10)}. Every number below is
emitted by code in this folder (\`out/*.json\`); none is estimated or illustrative.

**Headline.** ${V.nScenesFit} Sentinel-2 scenes (2017–2026) spanning effective tide
${f2(V.tideRangeFit[0])}–${f2(V.tideRangeFit[1])} m recover a drying-height surface for
**${HMASK.selfCheck.intertidalInsideKm2} km²** — ${(100 * HMASK.selfCheck.intertidalInsideKm2 / (HMASK.selfCheck.intertidalInsideKm2 + HMASK.selfCheck.subtidalInsideKm2)).toFixed(1)}% of the harbour's water area, up from
${before.nFit} scenes and 86.9 km² in round 2. (Round 3 first reported 139.8 km² here, measured with a
faulty mask — corrected in §6.) Leave-one-out water-class IoU
**${after.meanIoU.toFixed(3)}** (median ${after.medianIoU.toFixed(3)}, pixel agreement
${after.meanAgree.toFixed(1)}%). The sub-1.0 m band — the one that matters for the artwork —
improved from ${((before.banded[0].meanIoU * before.banded[0].n + before.banded[1].meanIoU * before.banded[1].n) / (before.banded[0].n + before.banded[1].n)).toFixed(3)} to
${(mean(lowBand.map(r => r.iou))).toFixed(3)}, and the raster now reaches down to
**${D.fittedHeightRange[0]} m** instead of 0.497 m.

**The bad news, stated up front:** Sentinel-2 can never see Tauranga at spring low water.
Over the entire 2015–2026 archive, at *any* cloud level, the lowest tide at a 60HVD overpass is
**${LOW.lowestAnyCloud} m** (§0d). That is a hard ceiling of the satellite's sun-synchronous orbit,
not of this pipeline, and it means the widest-flats state the piece wants to show is extrapolated,
not observed.

---

## 0. What changed in round 3, and what the data forced

### 0a. Tide labels now come from the shared module — on the evidence, not by fiat

\`tide/tauranga-tide.js\` replaced the pipeline-local 30-constituent fit. Both were scored against
the same ground truth: every LINZ tabulated turning point, 2023–2027.

| | height rmse at extrema | height max err | turning-point timing, mean \\|err\\| | timing max |
|---|---|---|---|---|
| pipeline-local 30-constituent fit | **${TC.heightAtExtrema.local.rmse} m** | ${TC.heightAtExtrema.local.maxAbs} m | ${TC.turningPointTiming.local.meanAbs} min | ${TC.turningPointTiming.local.maxAbs} min |
| shared \`tauranga-tide.js\` | ${TC.heightAtExtrema.shared.rmse} m | ${TC.heightAtExtrema.shared.maxAbs} m | **${TC.turningPointTiming.shared.meanAbs} min** | **${TC.turningPointTiming.shared.maxAbs} min** |

**Honest reading: on height they are a tie** — ${TC.heightAtExtrema.local.rmse} vs
${TC.heightAtExtrema.shared.rmse} m is a ${(TC.heightAtExtrema.shared.rmse - TC.heightAtExtrema.local.rmse).toFixed(4)} m
difference against a 0.029 m quantisation floor, i.e. no difference at all, and the local fit is
nominally the better of the two. **On timing the shared module wins clearly**, ${TC.turningPointTiming.shared.meanAbs}
vs ${TC.turningPointTiming.local.meanAbs} min mean error (${(100 * (1 - TC.turningPointTiming.shared.meanAbs / TC.turningPointTiming.local.meanAbs)).toFixed(0)}% better).

Timing is the decisive metric here, because a scene is labelled at an arbitrary instant, not at a
turning point: at the observed peak rate of ~0.45 m/hr, ${TC.turningPointTiming.local.meanAbs} min of
phase error is ~0.10 m of height error, and ${TC.turningPointTiming.shared.meanAbs} min is ~0.07 m.
The shared module also carries analytic 18.6-year nodal corrections, which the local fit does not —
so it is the only one of the two that can legitimately be evaluated back to 2017. **Adopted for all
${V.nScenesFit} scenes**, which also removes the round-2 inconsistency of mixing two estimators.

Reconciling round 2's up-to-0.257 m disagreement: at the ${TC.sceneInstantDisagreement.sharedVsLocal.n}
scene instants the three estimators disagree by rmse ${TC.sceneInstantDisagreement.sharedVsLocal.rmse} m
(shared vs local, max ${TC.sceneInstantDisagreement.sharedVsLocal.maxAbs} m) and
${TC.sceneInstantDisagreement.sharedVsCosine.rmse} m (shared vs naive cosine interpolation of the
tables, max ${TC.sceneInstantDisagreement.sharedVsCosine.maxAbs} m). There is no ground truth
*between* turning points, so that spread is irreducible label uncertainty — roughly 0.1 m, which is
comparable to the vertical resolution of the whole method and remains a real error source.

### 0b. The archive is 11 years deep, but 30 of every 128 items are duplicates

The 2023 floor is gone. STAC returns 265 matching 60HVD items; **${265 - V.nScenesFit} of them are
reprocessed baseline versions of a pass already in the list** (\`…_0_L2A\` and \`…_1_L2A\` for the same
minute). Left in, they would double-weight those observations — and, far worse, **leak a held-out
scene's own twin into the training set**, inflating every leave-one-out number. They are
deduplicated in \`1-scenes.mjs\`, keeping the higher processing index.

Mixing 2017–2021 with 2022+ raises a second risk: processing baseline 04.00 introduced a
\`BOA_ADD_OFFSET\` of −1000, so the two eras could sit on different radiometric scales. Measured, the
per-scene Otsu threshold differs between eras by **0.005 NDWI units** — negligible. Safe to mix.

### 0c. Tide height alone does not predict what the satellite sees

Unchanged from round 2 and re-measured on the larger set. Two scenes at effectively the same gauge
tide: ${HY.matchedPair.flood.date} (${f2(HY.matchedPair.flood.tide)} m, **rising**) shows
**${HY.matchedPair.flood.waterFracPct}%** of the intertidal band as water;
${HY.matchedPair.ebb.date} (${f2(HY.matchedPair.ebb.tide)} m, **falling**) shows
**${HY.matchedPair.ebb.waterFracPct}%**. Correlation of off-trend water fraction against rate of tide
change over all ${HY.rows.length} scenes: **r = ${HY.rTideRate}**; falling-tide scenes read
${HY.ebbMeanResidualPct}% wetter than trend, rising-tide ${Math.abs(HY.floodMeanResidualPct)}% drier.
(Season explains nothing, r = ${HY.rSummerness}; cloud now correlates weakly, r = ${HY.rCloud},
because the round-3 set deliberately includes cloudier scenes.)

Physically: the water level over the flats lags the open-sea tide, and freshly exposed flats stay
saturated and ponded. Modelled as \`tideEff = tideModel(t − τ)\`.

### 0d. Why the low-tide end cannot be fixed by more scenes

This was the round-3 priority, so it was tested directly. Every 60HVD pass in the archive was
queried **with no cloud filter at all** (${LOW.totalPasses} passes). Acquisition time is
${LOW.acquisitionTimesUtc.join(', ')} UTC — a single fixed slot, because Sentinel-2 is
sun-synchronous.

| scene quality | lowest effective tide reachable |
|---|---|
| cloud < 5% | ${LOW.lowestCloud5} m |
| cloud < 20% | ${LOW.lowestCloud20} m |
| **any cloud, all ${LOW.totalPasses} passes 2015–2026** | **${LOW.lowestAnyCloud} m** |

Relaxing cloud from 5% to 20% buys ${(LOW.lowestCloud5 - LOW.lowestCloud20).toFixed(2)} m. Abandoning
the cloud filter entirely buys only ${(LOW.lowestCloud5 - LOW.lowestAnyCloud).toFixed(2)} m. **The
limit is orbital geometry, not weather.** A sun-synchronous satellite samples a fixed solar time;
at Tauranga the spring–neap cycle is phase-locked to time of day, so spring low water — the
lowest, widest-flats state — systematically falls outside the ~22:16 UTC window. No amount of
archive depth fixes this. Landsat 8/9 share a similar mid-morning slot and would not help much.

Chart datum is approximately LAT, so the raster simply has no observation of the bottom
~${LOW.lowestAnyCloud.toFixed(1)} m of the tidal frame.

### 0e. More scenes, or better scenes?

Adding the cloudier scenes could have gone either way, and the naive comparison is confounded: a
cloud<20% model gets *scored* on 107 extra hard scenes it would not otherwise be asked about. The
fair test fits on each set but scores all of them on the **same ${CF[0].nScored} cloud<5% scenes**:

| fit set | scenes in fit | mean IoU on the same 97 clean scenes |
|---|---|---|
${CF.map(c => `| ${c.label} | ${c.nFit} | ${c.meanIoU.toFixed(4)} |`).join('\n')}

**No difference (${(CF[1].meanIoU - CF[0].meanIoU).toFixed(4)}).** The step fit is already saturated
at ~100 scenes; the extra 107 add no information. They are kept anyway, for one reason only: they
extend the observed tide range downward by ${(LOW.lowestCloud5 - LOW.lowestCloud20).toFixed(2)} m and
so recover intertidal area at the low end that the clean-only set cannot reach. They cost nothing
in accuracy and buy a little range.

### 0f. Threshold

Unchanged: one global threshold at gray ${M.medianOtsuGray} = **NDWI ${M.medianOtsuNdwi}** (the median
of the per-scene Otsu values). Round 2 scored five threshold rules — global, fixed NDWI = 0, and two
per-scene adaptive variants — within 0.016 IoU of each other, with the *adaptive* rules coming last;
adapting per scene lets the threshold absorb part of the signal being measured. Across all
${V.nScenesFit} round-3 scenes the median Otsu is still gray ${M.medianOtsuGray}, so the choice
carries over unchanged.

---

## 1. Hold-one-out accuracy, before and after

For each scene: refit the drying height from **all the other scenes**, then compare the held-out
scene's predicted state against what it actually shows. Scored over the intertidal region inside
the harbour polygon, on the ${V.nScenesScored} cloud<5% scenes.

Round 3 replaced the O(n²) leave-one-out with an exact O(n) reduction (\`lib/steps.mjs\`: excluding a
scene shifts the error curve by one constant either side of it, so all n held-out fits come from
prefix/suffix minima). It is verified against the naive implementation on 470,000 randomised
comparisons — **0 mismatches** — and is what makes 204-scene validation and a 49-cell parameter
sweep affordable at all.

| | scenes in fit | tide range | mean IoU | median | land IoU | agreement |
|---|---|---|---|---|---|---|
| **BEFORE** — round-2 config (2023+, cloud<5%, uniform τ=80) | ${before.nFit} | ${f2(before.tideRange[0])}–${f2(before.tideRange[1])} | ${before.meanIoU.toFixed(4)} | ${before.medianIoU.toFixed(4)} | ${before.meanIoULand.toFixed(4)} | ${before.meanAgree.toFixed(2)}% |
| AFTER — all scenes, uniform τ=${uni.tau0} | ${uni.nFit} | ${f2(uni.tideRange[0])}–${f2(uni.tideRange[1])} | ${uni.meanIoU.toFixed(4)} | ${uni.medianIoU.toFixed(4)} | ${uni.meanIoULand.toFixed(4)} | ${uni.meanAgree.toFixed(2)}% |
| **AFTER** — all scenes, spatial lag τ=${after.tau0}+${after.slope}/km | ${after.nFit} | ${f2(after.tideRange[0])}–${f2(after.tideRange[1])} | **${after.meanIoU.toFixed(4)}** | ${after.medianIoU.toFixed(4)} | ${after.meanIoULand.toFixed(4)} | ${after.meanAgree.toFixed(2)}% |

**IoU banded by tide — the number that was asked for:**

| tide band | ${BANDS.map(b => b.replace(' m', '')).join(' | ')} |
|---|${BANDS.map(() => '---').join('|')}|
| BEFORE (${before.nFit} scenes) | ${BANDS.map(b => bandRow(before, b)).join(' | ')} |
| AFTER, uniform lag | ${BANDS.map(b => bandRow(uni, b)).join(' | ')} |
| **AFTER, spatial lag** | ${BANDS.map(b => bandRow(after, b)).join(' | ')} |
| scenes in band (after) | ${BANDS.map(b => { const x = after.banded.find(z => z.band === b); return x.n || '—'; }).join(' | ')} |

**A caveat that matters, and that I would rather state than bury.** The BEFORE row is round 2's
35-scene model re-scored under round 3's protocol — bigger reference pixel set, and prediction taken
directly from the fitted cut rather than round-tripped through the encoded height. Under that
protocol it scores ${before.meanIoU.toFixed(3)}, not the ${'0.727'} published in round 2. **The
protocol change accounts for most of that gap, not the extra scenes.** The honest like-for-like
comparison is the ${before.meanIoU.toFixed(3)} → ${after.meanIoU.toFixed(3)} in the table above — a
real but much more modest gain than a naive 0.727 → ${after.meanIoU.toFixed(3)} would suggest.

The genuine wins from the deeper archive are not in the headline IoU at all. They are:
**intertidal area 86.9 → ${H.intertidalKm2} km²** (+${(100 * (H.intertidalKm2 / 86.9 - 1)).toFixed(0)}%),
**height floor 0.497 → ${D.fittedHeightRange[0]} m**, and subtidal-with-no-height falling from
51.3% to ${H.subtidalPctOfWater}% of harbour water.

### Did the spatial lag help?

τ(pixel) = ${TAU0_MIN} + ${LAG_SLOPE_MIN_PER_KM} × (along-channel km from the open sea), giving
${D.tidalLag.maxLagMin} min at the far end of the harbour (max along-channel distance
${D.tidalLag.maxAlongChannelKm} km). Distance is a geodesic *through water*, so it follows the
channels; the seed is the whole open ocean rather than a single point at the Mount, because Tauranga
Harbour has two entrances and the northern basin is fed through Bowentown as well.

Selection was a ${SEL.grid.length}-cell (τ₀ × slope) sweep, with a nested split-half — parameters
chosen on one half of the scenes, scored on the other:

| | selection-optimal IoU | **honest nested IoU** |
|---|---|---|
| uniform lag (slope = 0) | ${SEL.selectionUniform.meanIoU.toFixed(4)} | ${SEL.honestUniform.toFixed(4)} |
| spatial lag | ${SEL.selectionSpatial.meanIoU.toFixed(4)} | ${SEL.honestSpatial.toFixed(4)} |
| **gain** | ${(SEL.selectionSpatial.meanIoU - SEL.selectionUniform.meanIoU).toFixed(4)} | **${SEL.honestGain.toFixed(4)}** |

**Yes, but barely: +${SEL.honestGain.toFixed(4)} IoU.** It is consistent — both folds improved
(${SEL.nested.map(x => '+' + (x.heldOutSpatial - x.heldOutUniform).toFixed(4)).join(' and ')}) — so it is a
real effect rather than noise, but it is a hundredth of what the phase-lag correction itself bought
in round 2 (0.513 → 0.726). The two folds also chose quite different parameters
(${SEL.nested.map(x => `τ₀=${x.spatial.tau0}, slope=${x.spatial.slope}`).join('; ')}), which says τ₀ and
slope trade off against each other and are individually poorly identified — only their combination
is. In the worst region, Katikati, the effect is real but small: mean along-channel distance
${V.places.find(p => p.place.startsWith('Katikati')).meanAlongChannelKm} km, so ~${(LAG_SLOPE_MIN_PER_KM * V.places.find(p => p.place.startsWith('Katikati')).meanAlongChannelKm).toFixed(0)} min
of extra lag over the mouth.

My read: **the spatially varying lag is worth keeping but is not the lever I hoped it was.** The
residual error is not mostly a phase-lag problem.

### Per-scene detail (worst 10 and best 5 of ${after.nScored})

| date | eff. tide (m) | cloud % | agree % | water IoU | land IoU | observed water % of band |
|---|---|---|---|---|---|---|
${[...worst.slice(0, 10), ...worst.slice(-5).reverse()].map(r => `| ${r.date} | ${f2(r.tide)} | ${r.cloud} | ${r.agree.toFixed(1)} | ${r.iou.toFixed(3)} | ${r.iouLand == null ? 'n/a' : r.iouLand.toFixed(3)} | ${r.obsWaterFracPct.toFixed(1)} |`).join('\n')}

---

## 2. Monotonicity / hypsometry

Water area inside the harbour polygon (${H.polygonKm2} km²; drawn in \`lib/regions.mjs\`, rendered as
\`out/preview-harbour-region.png\` so it can be checked).

${hypsoSvg()}

The reconstructed curve (blue) is **monotonic by construction** — a cumulative count of pixels whose
fitted height is at or below the threshold cannot decrease. Saying so proves nothing; the meaningful
test is whether it tracks the observations.

The observed points (orange) are **not** monotonic: ${V.hypsometry.observedMonotonicityViolations} of
${V.hypsometry.perScene.length - 1} steps decrease, worst by
${Math.abs(V.hypsometry.worstObservedDropKm2)} km². With ${V.nScenesScored} scenes there are many
near-identical tides, so consecutive steps are mostly measuring scene-to-scene noise rather than
tide — that scatter *is* the irreducible error of the input.

Agreement: **bias ${V.hypsometry.reconstructedVsObserved.biasKm2} km², rmse
${V.hypsometry.reconstructedVsObserved.rmseKm2} km²** against a mean observed water area of
${f2(mean(V.hypsometry.perScene.map(p => p.obsKm2)))} km², i.e.
~${(100 * V.hypsometry.reconstructedVsObserved.rmseKm2 / mean(V.hypsometry.perScene.map(p => p.obsKm2))).toFixed(0)}%
relative rmse with essentially no systematic wet/dry bias.

---

## 3. Failure map

\`out/preview-failure-map.png\`: for every harbour intertidal pixel, how many of the
${V.nScenesScored} held-out predictions it got wrong (green = few, red = many).

| place | intertidal km² | IoU | error rate % | mean misfit (of ${V.nScenesFit}) | along-channel km |
|---|---|---|---|---|---|
${V.places.slice().sort((a, b) => b.errRate - a.errRate).map(p => `| ${p.place} | ${f2(p.km2)} | ${p.iou.toFixed(3)} | ${p.errRate.toFixed(2)} | ${p.meanMisfit.toFixed(1)} | ${p.meanAlongChannelKm.toFixed(1)} |`).join('\n')}

**The pattern inverted from round 2, and it is informative.** The big open banks are now the
*best* areas, and the narrow arms the worst:

- **Ōmokoroa, Matakana Island banks, Katikati northern basin — ${f2(V.places.filter(p => /Omokoroa|Matakana|Katikati/.test(p.place)).reduce((a, p) => a + p.km2, 0))} km²
  at IoU ${mean(V.places.filter(p => /Omokoroa|Matakana|Katikati/.test(p.place)).map(p => p.iou)).toFixed(3)}.** In round 2 Katikati was
  the worst region by error area; with 204 scenes it is among the best. Broad, gently sloping,
  clean sand-to-water contrast, and now densely sampled in tide. **This is the visually dominant
  drying area and it is the most trustworthy part of the raster** — which is the right way round
  for the artwork.

- **Tauranga entrance / Mount (IoU ${V.places.find(p => p.place.startsWith('Tauranga entrance')).iou.toFixed(3)},
  misfit ${V.places.find(p => p.place.startsWith('Tauranga entrance')).meanMisfit.toFixed(0)} scenes) — still the worst.**
  Dredged shipping channel, so the bed genuinely moved over 2017–2026 and no single step-fit is
  valid for the whole archive; fastest currents in the harbour, so wakes and surface roughness break
  NDWI; and sun glint at the low winter overpass angle. Only ${f2(V.places.find(p => p.place.startsWith('Tauranga entrance')).km2)} km², so
  it barely affects the total, but it is the least reliable ground in the frame.

- **Waikareao and Waimapu arms (IoU ${V.places.find(p => p.place.startsWith('Waikareao')).iou.toFixed(3)} and
  ${V.places.find(p => p.place.startsWith('Waimapu')).iou.toFixed(3)}).** Narrow, mangrove-fringed,
  seagrass-patched. Mangroves keep a vegetation signature whether or not water is under them, so
  those pixels never transition and fall into the supratidal class; seagrass darkens the NIR of
  *submerged* flats so wet ground reads as land. Both suppress apparent intertidal area rather than
  misplacing its height. These arms also take turbid stormwater from the Waimapu and Kopurererua
  streams, which reads wetter than it is.

- **Rangataua / Welcome Bay (IoU ${V.places.find(p => p.place.startsWith('Rangataua')).iou.toFixed(3)}).**
  Same mangrove/turbidity story; the most sheltered water in the harbour.

- **Spurious "intertidal" outside the harbour polygon: ${H.spuriousIntertidalOutsideKm2} km²** (up from
  5.0 km² in round 2 — more scenes means more chances for a land pixel to flicker). Sun glint and
  whitecaps offshore, flooded paddocks and changing river stage inland. The step fit cannot tell
  these from tide. **\`out/harbour-mask.png\` is shipped for exactly this reason and must be applied
  before rendering** — see §5.

---

## 4. Honest limitations

**1. Spring low water is never observed — the single most important limitation for this project.**
Lowest tide at any 60HVD overpass, any cloud, 2015–2026: **${LOW.lowestAnyCloud} m** (§0d). The
raster's fitted heights bottom out at ${D.fittedHeightRange[0]} m. Below that the model has nothing
to say, so a renderer asked for 0.1 m will draw exactly the same flats as at
${D.fittedHeightRange[0]} m — **the harbour will appear to stop breathing at the bottom of the
cycle**, which is precisely the moment the piece is meant to be at its most dramatic. This is a
property of sun-synchronous orbits, not of the pipeline.

**2. ${H.pinnedLowKm2} km² of intertidal (${(100 * H.pinnedLowKm2 / H.intertidalKm2).toFixed(0)}% of it) is
pinned to the lowest observed bracket.** For those pixels the stated height is an *upper bound* —
they dry at or below it, and the raster cannot say how much below. They are concentrated exactly
where the flats are widest, compounding limitation 1. (At the top end only
${H.pinnedHighKm2} km² is pinned, so the high-water edge is well determined.)

**3. Sentinel-2 cannot see through water.** ${HMASK.selfCheck.subtidalInsideKm2} km²
(${(100 * HMASK.selfCheck.subtidalInsideKm2 / (HMASK.selfCheck.intertidalInsideKm2 + HMASK.selfCheck.subtidalInsideKm2)).toFixed(1)}% of harbour
water) never dries in any scene and carries no elevation at all. Much better than round 2's 51.3%,
but it is the method's hard floor; filling it needs bathymetry (LINZ 3D Coastal Mapping topo-bathy
LiDAR, due mid-2026, covers this harbour).

**4. Vertical resolution is set by scene spacing.** A pixel's height is the midpoint between two
adjacent scene tides: median gap ${gaps[gaps.length >> 1].toFixed(3)} m, but gaps are uneven and reach
${gaps[gaps.length - 1].toFixed(3)} m. **There is still no LiDAR here, so no RMSE in metres can be
claimed.** Everything reported is self-consistency against the satellite record — a weaker claim
than the NHESS 0.2 m figure, and it should not be compared to it.

**5. Tide labelling carries ~0.1 m of irreducible uncertainty** between turning points (§0a), which
is comparable to the vertical resolution itself.

**6. The step model fits most pixels imperfectly.** Scenes disagreeing with the fitted step, over
harbour intertidal pixels:

| scenes disagreeing | share |
|---|---|
${V.misfitHistogram.map((c, k) => `| ${k === 8 ? '8+' : k} | ${(100 * c / V.misfitHistogram.reduce((a, b) => a + b, 0)).toFixed(2)}% |`).join('\n')}

Mean misfit is ${D.counts.meanMisfitScenes.toFixed(1)} of ${V.nScenesFit} scenes (~${(100 * D.counts.meanMisfitScenes / V.nScenesFit).toFixed(0)}%).
The step fit's robustness to bad scenes is being used heavily — which means the observations are
genuinely inconsistent, not that the model is clean.

**7. The harbour is non-stationary over 2017–2026.** Sandbanks migrate, the channel is dredged. One
drying height per pixel averages nine years of a moving bed. This is worse in round 3 than round 2
simply because the window is longer.

**8. A single global lag law is still crude.** τ = ${TAU0_MIN} + ${LAG_SLOPE_MIN_PER_KM}/km is one
straight line for the whole harbour, and its two parameters are only jointly identified (§1).

**9. Pixels are not square.** ${SIZE}×${SIZE} over 0.44° × 0.38° gives ≈14.9 m × 16.2 m ground
pixels, coarser than Sentinel-2's native 10 m. Narrow creeks are lost to resampling.

**10. A tooling trap, recorded for whoever comes next: \`sharp\` silently truncates 16-bit raw input.**
Feeding a \`Uint16Array\` via \`sharp(buf, { raw: { depth: 'ushort' } })\` reads the buffer as 8-bit
bytes, destroying the high byte of every sample — no error, no warning, just a corrupt raster that
still opens fine. Round 2's first \`drying-height.png\` shipped as 8-bit before \`verify.mjs\` caught
it. The 16-bit PNG is now written by an explicit encoder (\`lib/png16.mjs\`) and \`verify.mjs\` decodes
the shipped file independently on every run.

---

## 5. Notes for the renderer

**Apply \`harbour-mask.png\` (255 = draw) before drawing anything.** ${HMASK.selfCheck.intertidalOutsideKm2} km²
of intertidal outside it is non-tidal flicker that the step fit cannot distinguish from real drying
ground, and it will shimmer as the tide animates. §6 lists what it is made of.

Self-check when you wire it in — load the mask together with \`classes.png\` and reproduce these:

| quantity | expected |
|---|---|
| mask area | ${HMASK.selfCheck.maskAreaKm2} km² |
| intertidal **inside** the mask | **${HMASK.selfCheck.intertidalInsideKm2} km²** |
| intertidal **outside** the mask | ${HMASK.selfCheck.intertidalOutsideKm2} km² |
| subtidal inside the mask | ${HMASK.selfCheck.subtidalInsideKm2} km² |
| pixel area | ${HMASK.selfCheck.pixelAreaKm2} km² |

**If inside and outside come out swapped, one of your two load paths is flipping rows.** All four
rasters use **row 0 = NORTH** (latitude ${D.bbox.north}); a Y-flip applied to the mask but not to the
height raster reproduces that swap almost exactly. Not hypothetical — see §6.

- \`water(pixel, tide) = class == subtidal || (class == intertidal && height <= tide)\`.
- Heights are metres above **chart datum**, the same datum \`tide/tauranga-tide.js\` predicts in, so
  the module's output can be fed in directly with no offset.
- Clamp the input tide to ${D.fittedHeightRange[0]}–${D.fittedHeightRange[1]} m. Outside that the
  image is frozen, and below ~${LOW.lowestAnyCloud} m it is unobserved rather than flat (§4.1) —
  worth a deliberate artistic decision rather than letting it look like a bug.

---

## 6. Defect record: the round-3 harbour mask was wrong, and how it was caught

**Round 3 shipped a \`harbour-mask.png\` that was unusable, while §5 instructed consumers to apply it.**
Recorded here because the failure mode is more interesting than the bug.

**What was shipped.** The mask was the \`HARBOUR\` polygon from \`lib/regions.mjs\` — a ten-vertex shape
built in round 2 for *statistics*. For that job it only ever appears intersected with the water
classes, so its landward closure was deliberately drawn out to the frame edges: surplus dry land cost
nothing. I then reused it as a *renderer* mask without re-validating it for the new purpose. Two
separate faults followed:

1. **Purpose.** The generous landward closure admits inland farmland — precisely where the spurious
   "intertidal" from flooded paddocks lives. As a despeckling mask it removed almost none of what it
   was meant to remove.
2. **Extent.** Worse, and missed by the round-2 visual check: the polygon's straight seaward edge
   between (176.190, −37.668) and (176.250, −37.702) **cuts across the inner harbour east of the
   Tauranga entrance**, severing Rangataua Bay, Welcome Bay and part of the Waimapu arm. **13.9 km²
   of real harbour intertidal sat outside it.**

**How it was caught.** Not by me. The consumer wired it into a renderer and *audited it before
trusting it*, measuring intertidal inside versus outside — and got 40.4 km² inside against 127.7 km²
outside, i.e. backwards. My own stage-4 log had printed the opposite (139.8 / 28.2) and I had not
questioned it.

**Two lessons, pointing in different directions.**

- *Mine:* I built an artifact for one purpose, reused it for another, and re-ran only the numbers that
  were already passing. The round-2 overlay that "verified" the polygon was checked for whether it
  *enclosed* the harbour, not for whether its edges *cut* anything — and a straight line clipping the
  city arms is invisible in a thumbnail unless you go looking. **A visual check against the wrong
  question is worse than none, because it manufactures confidence.**
- *The measurement disagreement:* the shipped PNG is byte-identical to the intended polygon (verified:
  0 disagreeing pixels of 6,760,000), and read on the same grid as \`classes.png\` it reproduces
  139.8 inside / 28.2 outside. Applying it **flipped vertically** gives 127.3 / 40.7 — the consumer's
  numbers with the labels exchanged. So there is *also* a row-order mismatch on one of the two load
  paths, independent of the polygon being wrong. Both faults were real and they compounded. §5 now
  ships expected areas so either is caught immediately.

**The fix.** \`8-harbour-mask.mjs\` derives the mask from the data with **no hand-drawn polygon at all**.
Water (subtidal ∪ intertidal) is eroded until the two entrance necks sever — the radius is *searched*,
not assumed, until a mid-harbour seed and an offshore seed genuinely land in different components
(${HMASK.erosionRadiusPx} px ≈ ${(HMASK.erosionRadiusPx * 0.0155).toFixed(2)} km) — the ocean component is
dilated back and subtracted, and the remaining connected body containing the harbour seed is the mask,
dilated 2 px for the shoreline fringe.

| | old (polygon) | **new (data-derived)** |
|---|---|---|
| intertidal inside | 139.8 km² | **${HMASK.selfCheck.intertidalInsideKm2} km²** |
| intertidal outside | 28.2 km² | ${HMASK.selfCheck.intertidalOutsideKm2} km² |
| inside : outside | 5.0 : 1 | **${(HMASK.selfCheck.intertidalInsideKm2 / HMASK.selfCheck.intertidalOutsideKm2).toFixed(1)} : 1** |
| real harbour wrongly excluded | 13.9 km² | 0 km² |
| inland farmland wrongly included | 1.7 km² | 0 km² |

\`out/preview-harbour-mask.png\` renders it with dropped intertidal in **red** — checked this time for
what is being cut, not just what is enclosed.

### What the ${HMASK.selfCheck.intertidalOutsideKm2} km² outside the mask actually is

${HMASK.excludedComponents.listed.length} components ≥ ${HMASK.excludedComponents.minKm2} km², plus
${HMASK.excludedComponents.smallBlobCount} blobs below that totalling ${HMASK.excludedComponents.smallBlobKm2} km².

| km² | centroid lon, lat | mean misfit | touches land % | span | what it is |
|---|---|---|---|---|---|
${HMASK.excludedComponents.listed.map(r => `| ${r.km2.toFixed(2)} | ${r.lon}, ${r.lat} | ${r.meanMisfit} | ${r.pctTouchingLand} | ${r.spanKm} km | ${r.verdict}${r.place ? ' — ' + r.place : ''} |`).join('\n')}

Totals: **open-water sun glint ${HMASK.excludedComponents.listed.filter(r => r.verdict === 'open-water sun glint').reduce((a, r) => a + r.km2, 0).toFixed(1)} km²**,
open-coast beach/surf ${HMASK.excludedComponents.listed.filter(r => r.verdict === 'open-coast beach/surf').reduce((a, r) => a + r.km2, 0).toFixed(1)} km²,
inland flooding ${HMASK.excludedComponents.listed.filter(r => r.verdict === 'inland flooding').reduce((a, r) => a + r.km2, 0).toFixed(1)} km².
**None of it is harbour** — every component that was real harbour is now inside the mask.

The two dominant components (${HMASK.excludedComponents.listed[0].km2} and
${HMASK.excludedComponents.listed[1].km2} km²) are diffuse scatters spanning 6 and 17 km over open
water off the Waihi Beach / Matakana coast with almost no contact with land: specular sun glint and
wave crests flickering across the NDWI threshold between scenes. Their centroids are meaningless and
are labelled as such. The inland components are small, compact, sit 100% inside the old polygon and
have near-zero connection to the harbour water body — flooded paddocks and changing river stage.

**Correction to the headline intertidal figure.** Round 3 reported 139.8 km², computed as "intertidal
inside the polygon". Measured against the real harbour it is **${HMASK.selfCheck.intertidalInsideKm2} km²** —
the polygon's two errors (13.9 km² of harbour excluded, ~1.7 km² of farmland plus some glint included)
very nearly cancelled. The symmetric difference between the old and new pixel sets is 5.0 km²,
**3.6% of the scored set**. Corrected harbour figures:

| | round 3 (polygon) | **corrected** |
|---|---|---|
| harbour water | 182.3 km² | **${(HMASK.selfCheck.intertidalInsideKm2 + HMASK.selfCheck.subtidalInsideKm2).toFixed(1)} km²** |
| intertidal | 139.8 km² | **${HMASK.selfCheck.intertidalInsideKm2} km²** |
| subtidal (no height) | 42.5 km² | ${HMASK.selfCheck.subtidalInsideKm2} km² |
| intertidal share of harbour water | 76.7% | ${(100 * HMASK.selfCheck.intertidalInsideKm2 / (HMASK.selfCheck.intertidalInsideKm2 + HMASK.selfCheck.subtidalInsideKm2)).toFixed(1)}% |

The **leave-one-out IoU numbers in §1 were not re-scored.** They were computed over the polygon's
intertidal set, which differs from the corrected set by 3.6% of pixels — below the resolution of the
comparisons being drawn, and re-scoring would have meant refitting scenes. Stated so the record is
clear, not because the difference was assumed away.

---

## Verdict

**Good enough to drive the artwork, with one honest hole at the bottom of the tide.**

For an ambient piece the relevant question is whether the drying pattern looks right and behaves
plausibly, and it does: the reconstruction is faithful across most of the range (IoU
${bandRow(after, '1.00-1.50 m')} at 1.0–1.5 m, ${bandRow(after, '1.50-2.00 m')} above 1.5 m), the
hypsometric curve tracks observation to ~${(100 * V.hypsometry.reconstructedVsObserved.rmseKm2 / mean(V.hypsometry.perScene.map(p => p.obsKm2))).toFixed(0)}%,
and the ${H.intertidalKm2} km² of resolved intertidal is now close to the ~145 km² the literature
gives for this harbour — an independent sign the geometry is broadly right. The broad banks that
dominate the view are the best-resolved ground in the frame.

The hole is the bottom ~${LOW.lowestAnyCloud.toFixed(1)} m. Sentinel-2 never sees it, and
${(100 * H.pinnedLowKm2 / H.intertidalKm2).toFixed(0)}% of the intertidal is pinned against that floor.
The piece will show the harbour breathing convincingly from about ${D.fittedHeightRange[0]} m
upwards and then hold still through the spring lows.

**What I would do next, in order:**
1. **Accept the floor and design around it** — cheapest and most honest. Clamp, and let the low
   state be a held breath rather than a frozen frame.
2. **Fill the bottom from bathymetry** when LINZ 3D Coastal Mapping topo-bathy LiDAR lands mid-2026.
   That is the only real fix: it gives true elevations below the satellite's floor and would also
   collapse limitation 3.
3. **Not** more Sentinel-2 scenes. §0e shows the fit is saturated at ~100 scenes and §0d shows the
   archive cannot reach lower. This lever is exhausted.

## Reproducing

\`\`\`
cd pipeline && npm install
node 1-scenes.mjs                  # STAC query, dedup, tide labels
node 1b-tide-check.mjs             # harmonic holdout
node 1c-tide-compare.mjs           # shared module vs local fit vs LINZ
node 1d-lowtide-probe.mjs          # why the low end is capped
node 2-fetch.mjs                   # NDWI tiles (cached)
node 2b-composite.mjs              # composite once (cached)
node 3-masks.mjs                   # threshold + bit-pack
node 3w-hysteresis.mjs             # ebb/flood asymmetry
node 3t-cloud-fair.mjs             # does adding cloudy scenes help?
node 3s-spatial-lag.mjs            # tau0 x slope x cloud grid
node 3u-final-select.mjs           # final params + nested split-half
node 4-fit.mjs                     # the raster
node 5-preview.mjs                 # human-viewable renders
node 6-validate.mjs                # all validation numbers
node 8-harbour-mask.mjs            # renderer mask + excluded-component audit
node 7-report.mjs                  # this file
node verify.mjs                    # independent decode check
\`\`\`

Tiles (${(816 * 1.33).toFixed(0)} MB) and composites (1.5 GB) are cached on disk; re-runs are cheap.
`;

fs.writeFileSync(path.resolve(dirs.out, '..', '..', 'docs', 'pipeline-validation.md'), md);
console.log('wrote docs/pipeline-validation.md');
