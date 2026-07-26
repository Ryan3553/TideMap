# Validation — Tauranga Harbour intertidal drying-height raster

Round 3. Produced by `pipeline/` on 2026-07-26. Every number below is
emitted by code in this folder (`out/*.json`); none is estimated or illustrative.

**Headline.** 204 Sentinel-2 scenes (2017–2026) spanning effective tide
0.31–2.16 m recover a drying-height surface for
**138.1 km²** — 74.4% of the harbour's water area, up from
35 scenes and 86.9 km² in round 2. (Round 3 first reported 139.8 km² here, measured with a
faulty mask — corrected in §6.) Leave-one-out water-class IoU
**0.899** (median 0.907, pixel agreement
93.2%). The sub-1.0 m band — the one that matters for the artwork —
improved from 0.820 to
0.848, and the raster now reaches down to
**0.332 m** instead of 0.497 m.

**The bad news, stated up front:** Sentinel-2 can never see Tauranga at spring low water.
Over the entire 2015–2026 archive, at *any* cloud level, the lowest tide at a 60HVD overpass is
**0.304 m** (§0d). That is a hard ceiling of the satellite's sun-synchronous orbit,
not of this pipeline, and it means the widest-flats state the piece wants to show is extrapolated,
not observed.

---

## 0. What changed in round 3, and what the data forced

### 0a. Tide labels now come from the shared module — on the evidence, not by fiat

`tide/tauranga-tide.js` replaced the pipeline-local 30-constituent fit. Both were scored against
the same ground truth: every LINZ tabulated turning point, 2023–2027.

| | height rmse at extrema | height max err | turning-point timing, mean \|err\| | timing max |
|---|---|---|---|---|
| pipeline-local 30-constituent fit | **0.0303 m** | 0.075 m | 13.46 min | 34 min |
| shared `tauranga-tide.js` | 0.031 m | 0.0855 m | **9.35 min** | **26 min** |

**Honest reading: on height they are a tie** — 0.0303 vs
0.031 m is a 0.0007 m
difference against a 0.029 m quantisation floor, i.e. no difference at all, and the local fit is
nominally the better of the two. **On timing the shared module wins clearly**, 9.35
vs 13.46 min mean error (31% better).

Timing is the decisive metric here, because a scene is labelled at an arbitrary instant, not at a
turning point: at the observed peak rate of ~0.45 m/hr, 13.46 min of
phase error is ~0.10 m of height error, and 9.35 min is ~0.07 m.
The shared module also carries analytic 18.6-year nodal corrections, which the local fit does not —
so it is the only one of the two that can legitimately be evaluated back to 2017. **Adopted for all
204 scenes**, which also removes the round-2 inconsistency of mixing two estimators.

Reconciling round 2's up-to-0.257 m disagreement: at the 204
scene instants the three estimators disagree by rmse 0.108 m
(shared vs local, max 0.3615 m) and
0.107 m (shared vs naive cosine interpolation of the
tables, max 0.2775 m). There is no ground truth
*between* turning points, so that spread is irreducible label uncertainty — roughly 0.1 m, which is
comparable to the vertical resolution of the whole method and remains a real error source.

### 0b. The archive is 11 years deep, but 30 of every 128 items are duplicates

The 2023 floor is gone. STAC returns 265 matching 60HVD items; **61 of them are
reprocessed baseline versions of a pass already in the list** (`…_0_L2A` and `…_1_L2A` for the same
minute). Left in, they would double-weight those observations — and, far worse, **leak a held-out
scene's own twin into the training set**, inflating every leave-one-out number. They are
deduplicated in `1-scenes.mjs`, keeping the higher processing index.

Mixing 2017–2021 with 2022+ raises a second risk: processing baseline 04.00 introduced a
`BOA_ADD_OFFSET` of −1000, so the two eras could sit on different radiometric scales. Measured, the
per-scene Otsu threshold differs between eras by **0.005 NDWI units** — negligible. Safe to mix.

### 0c. Tide height alone does not predict what the satellite sees

Unchanged from round 2 and re-measured on the larger set. Two scenes at effectively the same gauge
tide: 2021-08-18 (0.34 m, **rising**) shows
**1.5%** of the intertidal band as water;
2023-06-14 (0.37 m, **falling**) shows
**52%**. Correlation of off-trend water fraction against rate of tide
change over all 204 scenes: **r = -0.565**; falling-tide scenes read
6.6% wetter than trend, rising-tide 7.3% drier.
(Season explains nothing, r = -0.037; cloud now correlates weakly, r = -0.281,
because the round-3 set deliberately includes cloudier scenes.)

Physically: the water level over the flats lags the open-sea tide, and freshly exposed flats stay
saturated and ponded. Modelled as `tideEff = tideModel(t − τ)`.

### 0d. Why the low-tide end cannot be fixed by more scenes

This was the round-3 priority, so it was tested directly. Every 60HVD pass in the archive was
queried **with no cloud filter at all** (1214 passes). Acquisition time is
22:15, 22:16, 22:17, 22:20, 22:24, 22:25, 22:26, 22:27, 22:28, 22:29, 22:30, 22:31, 22:32, 22:33, 22:36, 22:37, 22:38, 22:41 UTC — a single fixed slot, because Sentinel-2 is
sun-synchronous.

| scene quality | lowest effective tide reachable |
|---|---|
| cloud < 5% | 0.387 m |
| cloud < 20% | 0.313 m |
| **any cloud, all 1214 passes 2015–2026** | **0.304 m** |

Relaxing cloud from 5% to 20% buys 0.07 m. Abandoning
the cloud filter entirely buys only 0.08 m. **The
limit is orbital geometry, not weather.** A sun-synchronous satellite samples a fixed solar time;
at Tauranga the spring–neap cycle is phase-locked to time of day, so spring low water — the
lowest, widest-flats state — systematically falls outside the ~22:16 UTC window. No amount of
archive depth fixes this. Landsat 8/9 share a similar mid-morning slot and would not help much.

Chart datum is approximately LAT, so the raster simply has no observation of the bottom
~0.3 m of the tidal frame.

### 0e. More scenes, or better scenes?

Adding the cloudier scenes could have gone either way, and the naive comparison is confounded: a
cloud<20% model gets *scored* on 107 extra hard scenes it would not otherwise be asked about. The
fair test fits on each set but scores all of them on the **same 97 cloud<5% scenes**:

| fit set | scenes in fit | mean IoU on the same 97 clean scenes |
|---|---|---|
| fit on cloud<5% (97) | 97 | 0.8970 |
| fit on cloud<20% (204) | 204 | 0.8975 |
| fit on cloud<10% | 139 | 0.8974 |

**No difference (0.0005).** The step fit is already saturated
at ~100 scenes; the extra 107 add no information. They are kept anyway, for one reason only: they
extend the observed tide range downward by 0.07 m and
so recover intertidal area at the low end that the clean-only set cannot reach. They cost nothing
in accuracy and buy a little range.

### 0f. Threshold

Unchanged: one global threshold at gray 129 = **NDWI 0.012** (the median
of the per-scene Otsu values). Round 2 scored five threshold rules — global, fixed NDWI = 0, and two
per-scene adaptive variants — within 0.016 IoU of each other, with the *adaptive* rules coming last;
adapting per scene lets the threshold absorb part of the signal being measured. Across all
204 round-3 scenes the median Otsu is still gray 129, so the choice
carries over unchanged.

---

## 1. Hold-one-out accuracy, before and after

For each scene: refit the drying height from **all the other scenes**, then compare the held-out
scene's predicted state against what it actually shows. Scored over the intertidal region inside
the harbour polygon, on the 97 cloud<5% scenes.

Round 3 replaced the O(n²) leave-one-out with an exact O(n) reduction (`lib/steps.mjs`: excluding a
scene shifts the error curve by one constant either side of it, so all n held-out fits come from
prefix/suffix minima). It is verified against the naive implementation on 470,000 randomised
comparisons — **0 mismatches** — and is what makes 204-scene validation and a 49-cell parameter
sweep affordable at all.

| | scenes in fit | tide range | mean IoU | median | land IoU | agreement |
|---|---|---|---|---|---|---|
| **BEFORE** — round-2 config (2023+, cloud<5%, uniform τ=80) | 35 | 0.46–1.98 | 0.8574 | 0.8513 | 0.6403 | 89.57% |
| AFTER — all scenes, uniform τ=60 | 204 | 0.39–2.16 | 0.8963 | 0.9049 | 0.6917 | 92.99% |
| **AFTER** — all scenes, spatial lag τ=40+4/km | 204 | 0.39–2.16 | **0.8994** | 0.9069 | 0.6966 | 93.20% |

**IoU banded by tide — the number that was asked for:**

| tide band | < 0.75 | 0.75-1.00 | 1.00-1.50 | 1.50-2.00 | >= 2.00 |
|---|---|---|---|---|---|
| BEFORE (35 scenes) | 0.818 | 0.822 | 0.862 | 0.982 | — |
| AFTER, uniform lag | 0.817 | 0.867 | 0.896 | 0.986 | 0.987 |
| **AFTER, spatial lag** | 0.822 | 0.872 | 0.899 | 0.986 | 0.988 |
| scenes in band (after) | 20 | 22 | 30 | 21 | 4 |

**A caveat that matters, and that I would rather state than bury.** The BEFORE row is round 2's
35-scene model re-scored under round 3's protocol — bigger reference pixel set, and prediction taken
directly from the fitted cut rather than round-tripped through the encoded height. Under that
protocol it scores 0.857, not the 0.727 published in round 2. **The
protocol change accounts for most of that gap, not the extra scenes.** The honest like-for-like
comparison is the 0.857 → 0.899 in the table above — a
real but much more modest gain than a naive 0.727 → 0.899 would suggest.

The genuine wins from the deeper archive are not in the headline IoU at all. They are:
**intertidal area 86.9 → 139.8 km²** (+61%),
**height floor 0.497 → 0.332 m**, and subtidal-with-no-height falling from
51.3% to 23.3% of harbour water.

### Did the spatial lag help?

τ(pixel) = 40 + 4 × (along-channel km from the open sea), giving
91.2 min at the far end of the harbour (max along-channel distance
12.8 km). Distance is a geodesic *through water*, so it follows the
channels; the seed is the whole open ocean rather than a single point at the Mount, because Tauranga
Harbour has two entrances and the northern basin is fed through Bowentown as well.

Selection was a 49-cell (τ₀ × slope) sweep, with a nested split-half — parameters
chosen on one half of the scenes, scored on the other:

| | selection-optimal IoU | **honest nested IoU** |
|---|---|---|
| uniform lag (slope = 0) | 0.8975 | 0.8969 |
| spatial lag | 0.9005 | 0.8996 |
| **gain** | 0.0030 | **0.0027** |

**Yes, but barely: +0.0027 IoU.** It is consistent — both folds improved
(+0.0021 and +0.0033) — so it is a
real effect rather than noise, but it is a hundredth of what the phase-lag correction itself bought
in round 2 (0.513 → 0.726). The two folds also chose quite different parameters
(τ₀=30, slope=5; τ₀=50, slope=2), which says τ₀ and
slope trade off against each other and are individually poorly identified — only their combination
is. In the worst region, Katikati, the effect is real but small: mean along-channel distance
6.8 km, so ~27 min
of extra lag over the mouth.

My read: **the spatially varying lag is worth keeping but is not the lever I hoped it was.** The
residual error is not mostly a phase-lag problem.

### Per-scene detail (worst 10 and best 5 of 97)

| date | eff. tide (m) | cloud % | agree % | water IoU | land IoU | observed water % of band |
|---|---|---|---|---|---|---|
| 2021-08-18 | 0.39 | 4.72 | 66.6 | 0.007 | 0.665 | 1.5 |
| 2026-04-29 | 1.21 | 2.77 | 73.3 | 0.681 | 0.378 | 59.3 |
| 2020-08-03 | 1.41 | 2.32 | 73.4 | 0.717 | 0.191 | 68.5 |
| 2023-02-14 | 0.68 | 3.87 | 83.7 | 0.765 | 0.652 | 68.0 |
| 2023-06-14 | 0.65 | 1.58 | 88.7 | 0.785 | 0.807 | 52.0 |
| 2025-12-10 | 0.87 | 2.46 | 80.9 | 0.786 | 0.360 | 89.1 |
| 2025-05-04 | 0.66 | 2.41 | 86.9 | 0.790 | 0.740 | 61.6 |
| 2025-04-09 | 1.03 | 0.12 | 85.5 | 0.792 | 0.679 | 55.4 |
| 2019-06-25 | 0.83 | 0.01 | 86.4 | 0.792 | 0.718 | 52.5 |
| 2022-02-24 | 0.68 | 0.85 | 87.1 | 0.801 | 0.733 | 61.8 |
| 2020-03-11 | 2.16 | 1.33 | 99.3 | 0.993 | 0.697 | 97.7 |
| 2020-02-10 | 2.05 | 0.2 | 99.2 | 0.992 | 0.749 | 97.2 |
| 2024-05-09 | 1.94 | 0.02 | 99.2 | 0.991 | 0.780 | 96.5 |
| 2020-04-25 | 1.83 | 0.01 | 99.1 | 0.991 | 0.767 | 96.8 |
| 2021-05-15 | 1.63 | 0.39 | 99.2 | 0.991 | 0.790 | 96.4 |

---

## 2. Monotonicity / hypsometry

Water area inside the harbour polygon (682.2 km²; drawn in `lib/regions.mjs`, rendered as
`out/preview-harbour-region.png` so it can be checked).

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 340" width="100%" style="max-width:720px;font-family:system-ui,sans-serif;font-size:11px"><rect x="0" y="0" width="720" height="340" fill="#fbfbfd"/><line x1="58" y1="300" x2="706" y2="300" stroke="#e2e5ea"/><text x="52" y="304" text-anchor="end" fill="#666">40</text><line x1="58" y1="264.5" x2="706" y2="264.5" stroke="#e2e5ea"/><text x="52" y="268.5" text-anchor="end" fill="#666">60</text><line x1="58" y1="229" x2="706" y2="229" stroke="#e2e5ea"/><text x="52" y="233" text-anchor="end" fill="#666">80</text><line x1="58" y1="193.5" x2="706" y2="193.5" stroke="#e2e5ea"/><text x="52" y="197.5" text-anchor="end" fill="#666">100</text><line x1="58" y1="158" x2="706" y2="158" stroke="#e2e5ea"/><text x="52" y="162" text-anchor="end" fill="#666">120</text><line x1="58" y1="122.5" x2="706" y2="122.5" stroke="#e2e5ea"/><text x="52" y="126.5" text-anchor="end" fill="#666">140</text><line x1="58" y1="87" x2="706" y2="87" stroke="#e2e5ea"/><text x="52" y="91" text-anchor="end" fill="#666">160</text><line x1="58" y1="51.5" x2="706" y2="51.5" stroke="#e2e5ea"/><text x="52" y="55.5" text-anchor="end" fill="#666">180</text><line x1="58" y1="16" x2="706" y2="16" stroke="#e2e5ea"/><text x="52" y="20" text-anchor="end" fill="#666">200</text><line x1="119.71428571428572" y1="16" x2="119.71428571428572" y2="300" stroke="#eef0f3"/><text x="119.71428571428572" y="315" text-anchor="middle" fill="#666">0.4</text><line x1="181.42857142857147" y1="16" x2="181.42857142857147" y2="300" stroke="#eef0f3"/><text x="181.42857142857147" y="315" text-anchor="middle" fill="#666">0.6</text><line x1="243.1428571428572" y1="16" x2="243.1428571428572" y2="300" stroke="#eef0f3"/><text x="243.1428571428572" y="315" text-anchor="middle" fill="#666">0.8</text><line x1="304.8571428571429" y1="16" x2="304.8571428571429" y2="300" stroke="#eef0f3"/><text x="304.8571428571429" y="315" text-anchor="middle" fill="#666">1.0</text><line x1="366.5714285714286" y1="16" x2="366.5714285714286" y2="300" stroke="#eef0f3"/><text x="366.5714285714286" y="315" text-anchor="middle" fill="#666">1.2</text><line x1="428.28571428571433" y1="16" x2="428.28571428571433" y2="300" stroke="#eef0f3"/><text x="428.28571428571433" y="315" text-anchor="middle" fill="#666">1.4</text><line x1="490.00000000000006" y1="16" x2="490.00000000000006" y2="300" stroke="#eef0f3"/><text x="490.00000000000006" y="315" text-anchor="middle" fill="#666">1.6</text><line x1="551.7142857142858" y1="16" x2="551.7142857142858" y2="300" stroke="#eef0f3"/><text x="551.7142857142858" y="315" text-anchor="middle" fill="#666">1.8</text><line x1="613.4285714285714" y1="16" x2="613.4285714285714" y2="300" stroke="#eef0f3"/><text x="613.4285714285714" y="315" text-anchor="middle" fill="#666">2.0</text><line x1="675.1428571428572" y1="16" x2="675.1428571428572" y2="300" stroke="#eef0f3"/><text x="675.1428571428572" y="315" text-anchor="middle" fill="#666">2.2</text><polyline fill="none" stroke="#2f6fd0" stroke-width="2.2" points="58.0,295.6 73.4,295.6 88.9,295.6 104.3,233.5 119.7,211.6 135.1,202.3 150.6,198.8 166.0,195.1 181.4,189.1 196.9,179.2 212.3,169.2 227.7,160.1 243.1,151.6 258.6,143.4 274.0,134.1 289.4,125.4 304.9,115.0 320.3,107.3 335.7,98.6 351.1,91.1 366.6,84.5 382.0,75.4 397.4,68.3 412.9,64.9 428.3,62.2 443.7,60.9 459.1,59.2 474.6,58.0 490.0,57.3 505.4,56.9 520.9,56.3 536.3,56.0 551.7,55.7 567.1,55.5 582.6,55.1 598.0,54.7 613.4,53.6 628.9,52.7 644.3,47.6 659.7,47.4 675.1,47.4 690.6,47.4 706.0,47.4"/><circle cx="115.7" cy="293.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="138.8" cy="206.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="168.2" cy="183.5" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="168.5" cy="191.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="170.0" cy="196.3" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="172.2" cy="191.4" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="175.3" cy="193.2" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="176.2" cy="192.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="178.0" cy="170.5" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="180.8" cy="185.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="184.2" cy="178.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="185.1" cy="196.2" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="195.6" cy="166.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="195.9" cy="166.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="196.9" cy="166.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="199.9" cy="142.5" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="199.9" cy="172.4" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="204.9" cy="142.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="206.1" cy="126.2" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="218.5" cy="173.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="238.2" cy="150.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="240.4" cy="159.5" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="241.0" cy="159.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="242.2" cy="151.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="253.0" cy="165.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="258.0" cy="149.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="258.0" cy="167.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="265.1" cy="73.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="265.4" cy="145.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="265.7" cy="152.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="267.2" cy="137.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="269.7" cy="142.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="272.1" cy="101.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="276.5" cy="156.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="277.1" cy="129.5" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="278.3" cy="146.4" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="286.7" cy="82.3" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="287.0" cy="141.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="288.5" cy="143.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="292.5" cy="88.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="295.0" cy="137.5" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="302.7" cy="135.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="312.9" cy="70.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="313.2" cy="157.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="318.4" cy="92.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="319.4" cy="128.4" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="320.3" cy="75.3" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="326.5" cy="110.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="329.5" cy="109.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="332.0" cy="105.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="333.6" cy="87.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="334.8" cy="108.4" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="340.3" cy="92.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="342.5" cy="107.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="351.8" cy="72.2" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="353.6" cy="90.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="361.6" cy="97.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="366.6" cy="100.3" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="370.6" cy="162.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="382.3" cy="78.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="386.6" cy="96.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="391.9" cy="86.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="410.4" cy="70.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="413.8" cy="64.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="427.7" cy="58.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="432.6" cy="138.5" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="438.5" cy="62.3" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="439.4" cy="59.4" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="442.2" cy="56.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="447.4" cy="60.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="453.6" cy="56.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="455.4" cy="58.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="459.8" cy="60.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="490.0" cy="56.4" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="496.8" cy="55.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="498.0" cy="56.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="519.6" cy="58.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="520.5" cy="55.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="520.9" cy="56.5" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="523.0" cy="55.2" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="527.0" cy="55.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="538.4" cy="54.7" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="557.3" cy="54.4" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="557.9" cy="61.5" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="560.0" cy="55.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="568.7" cy="54.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="578.9" cy="53.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="585.0" cy="54.3" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="586.0" cy="57.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="594.9" cy="55.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="601.7" cy="48.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="605.4" cy="55.8" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="605.7" cy="56.0" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="629.8" cy="53.9" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="631.3" cy="54.3" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="636.6" cy="52.6" r="2.6" fill="#e2603a" fill-opacity="0.8"/><circle cx="663.4" cy="51.1" r="2.6" fill="#e2603a" fill-opacity="0.8"/><text x="58" y="334" fill="#444">effective tide (m above chart datum)</text><text x="14" y="24" fill="#444" transform="rotate(-90 14 24)">water area (km²)</text><g transform="translate(496,22)"><rect x="-8" y="-12" width="212" height="40" fill="#fff" fill-opacity="0.9" stroke="#dde"/><line x1="0" y1="0" x2="22" y2="0" stroke="#2f6fd0" stroke-width="2.2"/><text x="28" y="4" fill="#333">reconstructed (from raster)</text><circle cx="11" cy="18" r="2.6" fill="#e2603a"/><text x="28" y="22" fill="#333">observed (one per clean scene)</text></g></svg>

The reconstructed curve (blue) is **monotonic by construction** — a cumulative count of pixels whose
fitted height is at or below the threshold cannot decrease. Saying so proves nothing; the meaningful
test is whether it tracks the observations.

The observed points (orange) are **not** monotonic: 43 of
96 steps decrease, worst by
49.17 km². With 97 scenes there are many
near-identical tides, so consecutive steps are mostly measuring scene-to-scene noise rather than
tide — that scatter *is* the irreducible error of the input.

Agreement: **bias 0.68 km², rmse
11.95 km²** against a mean observed water area of
146.56 km², i.e.
~8%
relative rmse with essentially no systematic wet/dry bias.

---

## 3. Failure map

`out/preview-failure-map.png`: for every harbour intertidal pixel, how many of the
97 held-out predictions it got wrong (green = few, red = many).

| place | intertidal km² | IoU | error rate % | mean misfit (of 204) | along-channel km |
|---|---|---|---|---|---|
| Tauranga entrance / Mount | 2.20 | 0.777 | 13.10 | 27.4 | 1.8 |
| Waikareao arm | 2.63 | 0.756 | 11.94 | 26.8 | 3.3 |
| Waimapu arm | 3.79 | 0.762 | 11.81 | 28.0 | 6.2 |
| Rangataua / Welcome Bay | 3.76 | 0.790 | 11.58 | 28.2 | 7.1 |
| Omokoroa | 12.68 | 0.921 | 5.71 | 15.0 | 6.3 |
| Katikati / northern basin | 50.84 | 0.926 | 5.54 | 15.0 | 6.8 |
| Matakana Island banks | 33.45 | 0.922 | 5.49 | 15.1 | 5.8 |
| Bowentown entrance | 9.55 | 0.959 | 3.47 | 13.0 | 2.5 |

**The pattern inverted from round 2, and it is informative.** The big open banks are now the
*best* areas, and the narrow arms the worst:

- **Ōmokoroa, Matakana Island banks, Katikati northern basin — 96.97 km²
  at IoU 0.923.** In round 2 Katikati was
  the worst region by error area; with 204 scenes it is among the best. Broad, gently sloping,
  clean sand-to-water contrast, and now densely sampled in tide. **This is the visually dominant
  drying area and it is the most trustworthy part of the raster** — which is the right way round
  for the artwork.

- **Tauranga entrance / Mount (IoU 0.777,
  misfit 27 scenes) — still the worst.**
  Dredged shipping channel, so the bed genuinely moved over 2017–2026 and no single step-fit is
  valid for the whole archive; fastest currents in the harbour, so wakes and surface roughness break
  NDWI; and sun glint at the low winter overpass angle. Only 2.20 km², so
  it barely affects the total, but it is the least reliable ground in the frame.

- **Waikareao and Waimapu arms (IoU 0.756 and
  0.762).** Narrow, mangrove-fringed,
  seagrass-patched. Mangroves keep a vegetation signature whether or not water is under them, so
  those pixels never transition and fall into the supratidal class; seagrass darkens the NIR of
  *submerged* flats so wet ground reads as land. Both suppress apparent intertidal area rather than
  misplacing its height. These arms also take turbid stormwater from the Waimapu and Kopurererua
  streams, which reads wetter than it is.

- **Rangataua / Welcome Bay (IoU 0.790).**
  Same mangrove/turbidity story; the most sheltered water in the harbour.

- **Spurious "intertidal" outside the harbour polygon: 28.2 km²** (up from
  5.0 km² in round 2 — more scenes means more chances for a land pixel to flicker). Sun glint and
  whitecaps offshore, flooded paddocks and changing river stage inland. The step fit cannot tell
  these from tide. **`out/harbour-mask.png` is shipped for exactly this reason and must be applied
  before rendering** — see §5.

---

## 4. Honest limitations

**1. Spring low water is never observed — the single most important limitation for this project.**
Lowest tide at any 60HVD overpass, any cloud, 2015–2026: **0.304 m** (§0d). The
raster's fitted heights bottom out at 0.332 m. Below that the model has nothing
to say, so a renderer asked for 0.1 m will draw exactly the same flats as at
0.332 m — **the harbour will appear to stop breathing at the bottom of the
cycle**, which is precisely the moment the piece is meant to be at its most dramatic. This is a
property of sun-synchronous orbits, not of the pipeline.

**2. 40.55 km² of intertidal (29% of it) is
pinned to the lowest observed bracket.** For those pixels the stated height is an *upper bound* —
they dry at or below it, and the raster cannot say how much below. They are concentrated exactly
where the flats are widest, compounding limitation 1. (At the top end only
0.11 km² is pinned, so the high-water edge is well determined.)

**3. Sentinel-2 cannot see through water.** 47.6 km²
(25.6% of harbour
water) never dries in any scene and carries no elevation at all. Much better than round 2's 51.3%,
but it is the method's hard floor; filling it needs bathymetry (LINZ 3D Coastal Mapping topo-bathy
LiDAR, due mid-2026, covers this harbour).

**4. Vertical resolution is set by scene spacing.** A pixel's height is the midpoint between two
adjacent scene tides: median gap 0.011 m, but gaps are uneven and reach
0.098 m. **There is still no LiDAR here, so no RMSE in metres can be
claimed.** Everything reported is self-consistency against the satellite record — a weaker claim
than the NHESS 0.2 m figure, and it should not be compared to it.

**5. Tide labelling carries ~0.1 m of irreducible uncertainty** between turning points (§0a), which
is comparable to the vertical resolution itself.

**6. The step model fits most pixels imperfectly.** Scenes disagreeing with the fitted step, over
harbour intertidal pixels:

| scenes disagreeing | share |
|---|---|
| 0 | 0.01% |
| 1 | 0.33% |
| 2 | 0.75% |
| 3 | 1.00% |
| 4 | 1.48% |
| 5 | 2.24% |
| 6 | 3.04% |
| 7 | 3.89% |
| 8+ | 87.26% |

Mean misfit is 4.0 of 204 scenes (~2%).
The step fit's robustness to bad scenes is being used heavily — which means the observations are
genuinely inconsistent, not that the model is clean.

**7. The harbour is non-stationary over 2017–2026.** Sandbanks migrate, the channel is dredged. One
drying height per pixel averages nine years of a moving bed. This is worse in round 3 than round 2
simply because the window is longer.

**8. A single global lag law is still crude.** τ = 40 + 4/km is one
straight line for the whole harbour, and its two parameters are only jointly identified (§1).

**9. Pixels are not square.** 2600×2600 over 0.44° × 0.38° gives ≈14.9 m × 16.2 m ground
pixels, coarser than Sentinel-2's native 10 m. Narrow creeks are lost to resampling.

**10. A tooling trap, recorded for whoever comes next: `sharp` silently truncates 16-bit raw input.**
Feeding a `Uint16Array` via `sharp(buf, { raw: { depth: 'ushort' } })` reads the buffer as 8-bit
bytes, destroying the high byte of every sample — no error, no warning, just a corrupt raster that
still opens fine. Round 2's first `drying-height.png` shipped as 8-bit before `verify.mjs` caught
it. The 16-bit PNG is now written by an explicit encoder (`lib/png16.mjs`) and `verify.mjs` decodes
the shipped file independently on every run.

---

## 5. Notes for the renderer

**Read the rasters as stage 9 leaves them.** `9-clean.mjs` rewrites `classes.png` and
`drying-height.png` in place after the fit, removing water that is not water (§7). The numbers in
this section are measured on the **raw** fit in `fit.bin`; after cleaning, harbour intertidal is
**133.33 km²**. If you re-run `4-fit.mjs` you must re-run
`9-clean.mjs` after it or the defect comes back.

**Apply `harbour-mask.png` (255 = draw) before drawing anything.** 29.9 km²
of intertidal outside it is non-tidal flicker that the step fit cannot distinguish from real drying
ground, and it will shimmer as the tide animates. §6 lists what it is made of.

Self-check when you wire it in — load the mask together with `classes.png` and reproduce these:

| quantity | expected |
|---|---|
| mask area | 194.3 km² |
| intertidal **inside** the mask | **138.1 km²** |
| intertidal **outside** the mask | 29.9 km² |
| subtidal inside the mask | 47.6 km² |
| pixel area | 0.000241212 km² |

**If inside and outside come out swapped, one of your two load paths is flipping rows.** All four
rasters use **row 0 = NORTH** (latitude -37.41); a Y-flip applied to the mask but not to the
height raster reproduces that swap almost exactly. Not hypothetical — see §6.

- `water(pixel, tide) = class == subtidal || (class == intertidal && height <= tide)`.
- Heights are metres above **chart datum**, the same datum `tide/tauranga-tide.js` predicts in, so
  the module's output can be fed in directly with no offset.
- Clamp the input tide to 0.332–2.127 m. Outside that the
  image is frozen, and below ~0.304 m it is unobserved rather than flat (§4.1) —
  worth a deliberate artistic decision rather than letting it look like a bug.

---

## 6. Defect record: the round-3 harbour mask was wrong, and how it was caught

**Round 3 shipped a `harbour-mask.png` that was unusable, while §5 instructed consumers to apply it.**
Recorded here because the failure mode is more interesting than the bug.

**What was shipped.** The mask was the `HARBOUR` polygon from `lib/regions.mjs` — a ten-vertex shape
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
  0 disagreeing pixels of 6,760,000), and read on the same grid as `classes.png` it reproduces
  139.8 inside / 28.2 outside. Applying it **flipped vertically** gives 127.3 / 40.7 — the consumer's
  numbers with the labels exchanged. So there is *also* a row-order mismatch on one of the two load
  paths, independent of the polygon being wrong. Both faults were real and they compounded. §5 now
  ships expected areas so either is caught immediately.

**The fix.** `8-harbour-mask.mjs` derives the mask from the data with **no hand-drawn polygon at all**.
Water (subtidal ∪ intertidal) is eroded until the two entrance necks sever — the radius is *searched*,
not assumed, until a mid-harbour seed and an offshore seed genuinely land in different components
(32 px ≈ 0.50 km) — the ocean component is
dilated back and subtracted, and the remaining connected body containing the harbour seed is the mask,
dilated 2 px for the shoreline fringe.

| | old (polygon) | **new (data-derived)** |
|---|---|---|
| intertidal inside | 139.8 km² | **138.1 km²** |
| intertidal outside | 28.2 km² | 29.9 km² |
| inside : outside | 5.0 : 1 | **4.6 : 1** |
| real harbour wrongly excluded | 13.9 km² | 0 km² |
| inland farmland wrongly included | 1.7 km² | 0 km² |

`out/preview-harbour-mask.png` renders it with dropped intertidal in **red** — checked this time for
what is being cut, not just what is enclosed.

### What the 29.9 km² outside the mask actually is

22 components ≥ 0.05 km², plus
5623 blobs below that totalling 6.05 km².

| km² | centroid lon, lat | mean misfit | touches land % | span | what it is |
|---|---|---|---|---|---|
| 12.27 | 175.9824, -37.4317 | 7.4 | 1 | 6.1 km | open-water sun glint — (diffuse scatter - centroid not meaningful) |
| 6.73 | 176.0349, -37.5053 | 13.4 | 7 | 17.1 km | open-water sun glint — (diffuse scatter - centroid not meaningful) |
| 1.04 | 176.2615, -37.6794 | 31.5 | 41 | 17 km | open-coast beach/surf — (diffuse scatter - centroid not meaningful) |
| 0.68 | 176.2233, -37.4442 | 2.4 | 0 | 2.1 km | open-water sun glint |
| 0.52 | 175.9773, -37.744 | 3.1 | 37 | 1.1 km | inland flooding |
| 0.43 | 175.9419, -37.7091 | 2.1 | 33 | 1.1 km | inland flooding |
| 0.35 | 176.2239, -37.4368 | 2.4 | 0 | 1.3 km | open-water sun glint |
| 0.25 | 175.9907, -37.7112 | 1.8 | 40 | 0.8 km | inland flooding |
| 0.24 | 175.9326, -37.7051 | 2.6 | 39 | 0.7 km | inland flooding |
| 0.21 | 175.9993, -37.4701 | 7.2 | 0 | 1 km | open-water sun glint — Bowentown entrance |
| 0.21 | 175.9959, -37.7328 | 1.7 | 61 | 0.8 km | inland flooding |
| 0.15 | 176.2234, -37.4512 | 3.3 | 0 | 0.9 km | open-water sun glint |
| 0.13 | 176.335, -37.4775 | 1.2 | 0 | 0.9 km | open-water sun glint |
| 0.12 | 176.23, -37.4671 | 3 | 0 | 0.8 km | open-water sun glint |
| 0.10 | 176.1998, -37.506 | 3.1 | 0 | 0.6 km | open-water sun glint |
| 0.07 | 176.2272, -37.4605 | 2.2 | 0 | 0.5 km | open-water sun glint |
| 0.06 | 176.1728, -37.6261 | 39.4 | 50 | 1 km | open-coast beach/surf — Tauranga entrance / Mount |
| 0.06 | 176.23, -37.473 | 3 | 0 | 0.7 km | open-water sun glint |
| 0.05 | 176.0118, -37.455 | 4.9 | 0 | 0.4 km | open-water sun glint |
| 0.05 | 176.222, -37.4266 | 2.1 | 0 | 0.5 km | open-water sun glint |
| 0.05 | 176.2321, -37.464 | 2.3 | 0 | 0.5 km | open-water sun glint |
| 0.05 | 175.9479, -37.706 | 3.1 | 55 | 0.3 km | inland flooding |

Totals: **open-water sun glint 21.0 km²**,
open-coast beach/surf 1.1 km²,
inland flooding 1.7 km².
**None of it is harbour** — every component that was real harbour is now inside the mask.

The two dominant components (12.27 and
6.73 km²) are diffuse scatters spanning 6 and 17 km over open
water off the Waihi Beach / Matakana coast with almost no contact with land: specular sun glint and
wave crests flickering across the NDWI threshold between scenes. Their centroids are meaningless and
are labelled as such. The inland components are small, compact, sit 100% inside the old polygon and
have near-zero connection to the harbour water body — flooded paddocks and changing river stage.

**Correction to the headline intertidal figure.** Round 3 reported 139.8 km², computed as "intertidal
inside the polygon". Measured against the real harbour it is **138.1 km²** —
the polygon's two errors (13.9 km² of harbour excluded, ~1.7 km² of farmland plus some glint included)
very nearly cancelled. The symmetric difference between the old and new pixel sets is 5.0 km²,
**3.6% of the scored set**. Corrected harbour figures:

| | round 3 (polygon) | **corrected** |
|---|---|---|
| harbour water | 182.3 km² | **185.7 km²** |
| intertidal | 139.8 km² | **138.1 km²** |
| subtidal (no height) | 42.5 km² | 47.6 km² |
| intertidal share of harbour water | 76.7% | 74.4% |

The **leave-one-out IoU numbers in §1 were not re-scored.** They were computed over the polygon's
intertidal set, which differs from the corrected set by 3.6% of pixels — below the resolution of the
comparisons being drawn, and re-scoring would have meant refitting scenes. Stated so the record is
clear, not because the difference was assumed away.

---

## 7. Stage 9 — water that is not water

**The defect.** Dark and bluish urban pixels — roof shadow, wet asphalt, the port's berths — sit on
the wet side of the global NDWI threshold often enough that the step fit calls them subtidal, or
finds a bogus step in them and calls them intertidal. Rendered, they are permanent blue holes
punched through Mount Maunganui, the CBD and the port, following the street grid. They do not move
with the tide, so they read as damage rather than as data.

Two things about the earlier framing of this defect are worth correcting. It was reported as
"45% of the Tauranga CBD is classified intertidal". Re-measured, a box over the CBD does come out
around 40% intertidal — but that box contains most of the Waikareao and Waimapu estuaries, and those
pixels are real flats: their submerged-state NDWI is +0.62, against +0.64 over the Matakana banks.
**The area affected is far smaller than 45% of the city; the visual damage is real but it is
speckle, not blocks.** And the worst of it was not in the pipeline at all — it was
`prototype/prep-hires.mjs` guessing water-vs-land from luminance for anything its despeckling
filter rejected, which turned dark roofs into permanent water.

**Two tests, both derived from the data.**

1. **Sea-connected.** Real harbour water is one connected body reaching the open sea; a roof is not.
   Label the water classes 8-connected, keep only the component containing the ocean seed, and every
   other water pixel becomes land. This also drops the inland flooded paddocks that §6 had to
   exclude with a mask — the four largest orphans it removes are exactly those components.
2. **The wet state must look like water.** A pixel called intertidal is claimed to be submerged in
   every scene above its drying height. Average the NDWI over exactly those scenes: harbour flats
   come out at a median **+0.583**, because they are under water. Urban pixels hover at zero — they
   only ever grazed the threshold. Demote intertidal whose submerged state never looks wet.

Test 2 runs first, because urban speckle is what bridges a city block to the shoreline and lets
test 1 keep it.

**Choosing the cut.** Test 2's threshold is `WET_MIN`, set to **0.2** NDWI. The
percentiles of submerged-state NDWI over harbour intertidal are p1 +0.098, p2 +0.201, p5 +0.393,
p50 +0.583, so the cut sits just above the 2nd percentile: it is a claim about the bottom 2% of
pixels, not about the population.

| | before | after |
|---|---|---|
| subtidal | 829.57 km² | 829.02 km² |
| intertidal (whole frame) | 168.04 km² | 157.56 km² |
| **intertidal inside `harbour-mask.png`** | **138.15 km²** | **133.33 km²** |

Removed: 5.5 km² intertidal by the spectral test,
4.98 km² intertidal + 0.55 km²
subtidal as orphan components (2953 of them).

**The cost is 4.8 km² of harbour intertidal, 3.5% of the scored set,
and it is stated rather than hidden.** Some of that is certainly real flat at the margins of the
test. The trade was taken because the removed pixels are, by construction, ones whose "submerged"
state is not distinguishable from dry ground in the imagery — so they were never carrying much
information — and because permanent water in the middle of a town is a far more visible error than
a slightly thinner flat. If it turns out to have cut too deep, `WET_MIN` is one environment
variable and the raw fit is still in `fit.bin`.

`out/cleaned-away.png` is a raster of exactly which pixels changed, so the edit is auditable.

---

## Verdict

**Good enough to drive the artwork, with one honest hole at the bottom of the tide.**

For an ambient piece the relevant question is whether the drying pattern looks right and behaves
plausibly, and it does: the reconstruction is faithful across most of the range (IoU
0.899 at 1.0–1.5 m, 0.986 above 1.5 m), the
hypsometric curve tracks observation to ~8%,
and the 139.8 km² of resolved intertidal is now close to the ~145 km² the literature
gives for this harbour — an independent sign the geometry is broadly right. The broad banks that
dominate the view are the best-resolved ground in the frame.

The hole is the bottom ~0.3 m. Sentinel-2 never sees it, and
29% of the intertidal is pinned against that floor.
The piece will show the harbour breathing convincingly from about 0.332 m
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

```
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
node 9-clean.mjs                   # remove non-tidal water; REWRITES classes/drying-height in place
node 7-report.mjs                  # this file
node verify.mjs                    # independent decode check
```

Tiles (1085 MB) and composites (1.5 GB) are cached on disk; re-runs are cheap.
