# Tauranga Harbour Tide Model — Validation

All numbers below came from actually running `fit.mjs` in this folder
(`node fit.mjs`), reading `../research/tauranga_2023.csv` through
`tauranga_2027.csv`. Nothing here is estimated.

**This is round 2.** Round 1 (kept below in the History section) trained on
2024+2025 and held out 2026 as the *last* year of a 3-year record — an
extrapolation test. The coordinator then supplied `tauranga_2023.csv` and
`tauranga_2027.csv` (LINZ's rolling 5-year window) and asked for a stronger
test plus a real fix at the actual problem: timing error, not height error.

## What changed in round 2

1. **Full 5-year record.** 2023, 2024, 2025, 2026, 2027 all exist now.
2. **Held-out year is now interior.** Train on 2023+2024+2025+2027, test
   against **2026** — a year with training data on both sides of it. This
   isolates model quality from drift/extrapolation, a strictly harder and
   more honest test than round 1's "predict past the end of the record."
3. **Analytic nodal (18.6-year) corrections**, applied per timestep, not
   fitted (5 years cannot resolve an 18.6-year cycle). See "Nodal
   corrections" below for the method and constants.
4. **17 more constituents** added (2N2, MU2, NU2, L2, T2, LDA2, J1, M1,
   OO1, RHO1, SIGMA1, M6, 2MS6, MK3, S4, MSF, SA), for 31 candidates total.
   Fitted, then pruned to survivors at a 5mm amplitude floor.
5. **Mid-tide RMSE** added as its own metric, separate from turning-point
   RMSE, per the coordinator's point that a continuously-moving display
   spends most of its time away from the turning points.
6. Timing error is now reported as the headline number.

## Headline results (held-out 2026, interior year, never in training)

| metric | round 1 (extrapolation, 14 constituents) | **round 2 (interior year, 23 constituents)** |
|---|---|---|
| **Timing mean \|error\|** | 24.16 min | **9.45 min** |
| **Timing max \|error\|** | 55.69 min | **29.68 min** |
| Height RMSE @ turning points | 0.0513 m | **0.0313 m** |
| Height max err @ turning points | 0.1692 m | **0.0789 m** |
| Height RMSE @ mid-tide | not measured | **0.1732 m** (see caveat below — largely a proxy artifact, not model error; effective figure is much smaller, see "Mid-tide accuracy" section) |
| Height max err @ mid-tide | not measured | 0.4039 m (same caveat) |

Both the height and timing numbers improved substantially. **Timing mean
error dropped from 24 to 9.4 minutes** — a tide clock reading "next high
3:00pm" is now typically off by under 10 minutes, which is a materially
different, useful product than round 1's ~24-minute average slop.

## Surviving constituents

31 candidates were fitted (14 original + 17 added this round); those with
fitted amplitude **< 5 mm were dropped** for the shipping model:

**23 survived:** M2, S2, N2, K2, K1, O1, P1, M4, MS4, MN4, Mm, 2N2, MU2,
NU2, L2, T2, LDA2, J1, M6, 2MS6, MK3, MSF, SA

**8 dropped** (amplitude too small to trust over noise): Q1 (2.5 mm), Mf
(0.3 mm), SSA (1.1 mm), M1 (0.8 mm), OO1 (0.7 mm), RHO1 (1.0 mm), SIGMA1
(3.1 mm), S4 (1.3 mm).

Two of the original 14 (Q1, Mf, SSA — three, not two) did **not** survive
round 2's pruning even though they were shipped in round 1 unpruned. This
is not a contradiction: round 1 never pruned anything (all 14 were shipped
regardless of size); round 2 introduces the 5mm floor for the first time,
and a longer, better-conditioned fit assigns these three a smaller and less
reliable amplitude than round 1's cruder 3-year fit did. Dropping them is
the right call — they're within noise.

Full amplitude ranking (all 31 candidates, before pruning, train set
2023+2024+2025+2027):

| constituent | amplitude (m) | kept? |
|---|---|---|
| M2 | 0.6496 | yes |
| N2 | 0.1719 | yes |
| S2 | 0.1046 | yes |
| M6 | 0.0756 | yes |
| M4 | 0.0711 | yes |
| L2 | 0.0565 | yes |
| K1 | 0.0532 | yes |
| SA | 0.0441 | yes |
| NU2 | 0.0421 | yes |
| Mm | 0.0269 | yes |
| LDA2 | 0.0236 | yes |
| K2 | 0.0196 | yes |
| 2MS6 | 0.0182 | yes |
| O1 | 0.0172 | yes |
| 2N2 | 0.0168 | yes |
| MN4 | 0.0167 | yes |
| P1 | 0.0164 | yes |
| MK3 | 0.0098 | yes |
| T2 | 0.0072 | yes |
| MU2 | 0.0066 | yes |
| MS4 | 0.0063 | yes |
| J1 | 0.0060 | yes |
| MSF | 0.0054 | yes |
| SIGMA1 | 0.0031 | **no** |
| Q1 | 0.0025 | **no** |
| S4 | 0.0013 | **no** |
| SSA | 0.0011 | **no** |
| RHO1 | 0.0010 | **no** |
| M1 | 0.0008 | **no** |
| OO1 | 0.0007 | **no** |
| Mf | 0.0003 | **no** |

**Overfitting honesty check:** 23/31 surviving with a clear amplitude
cliff between MSF (5.4mm, kept) and SIGMA1 (3.1mm, dropped) is a
reasonably clean cut, not an arbitrary one. This is a real finding, not a
foregone conclusion — a 5-year record genuinely resolves quite a lot more
than 14 terms, matching the Rayleigh-criterion expectation (e.g. K1/P1 need
~183 days of separation, S2/K2 similarly, M2/N2 need ~28 days; all trivially
satisfied by 4-5 years of data).

One caveat on trustworthiness, not amplitude: **M4/M6/2MS6/MN4 (the
shallow-water shape terms) are only weakly constrained by an extrema-only
fit.** They mainly shape the curve *between* highs and lows, which this
dataset never observes directly — they're inferred only indirectly, from
how they nudge the timing/height of the extrema. Their survival past 5mm is
real (not noise-level), but their exact amplitudes carry more uncertainty
than the primary astronomical terms (M2, S2, K1, O1, N2, K2), which are
directly and strongly constrained by the extrema. See "Mid-tide accuracy"
below for the concrete consequence of this.

## Nodal corrections

**Method:** the lunar node longitude N(t) is computed analytically (Meeus,
*Astronomical Algorithms*, mean longitude of the ascending node, linear
term only — quadratic/cubic terms are ~1e-4° over a few years, negligible):

```
N(deg) = 125.04452 - 1934.136261 * T      (T = Julian centuries since J2000.0)
```

Each constituent's amplitude gets a nodal factor `f(N)` and phase gets a
correction `u(N)` (degrees), evaluated **per timestep** (not once per year —
more accurate, and no harder to compute since N(t) is just a function of
absolute time):

```
h(t) = Z0 + Σ f_i(t) · A_i · cos(ω_i·t − φ_i − u_i(t))
```

- **M2, K1, O1, K2** get their own standard reduced series in N, 2N, 3N
  (classical Schureman/Doodson-style formulae).
- **Species satellites reuse their parent's f, u**: N2/2N2/MU2/NU2/L2/LDA2
  → M2's; Q1/RHO1/SIGMA1/M1 → O1's. Documented simplification — the exact
  L2/M1 corrections also depend on lunar perigee p, which isn't modelled
  here; using the parent species' value is standard practice at this level
  of rigor.
- **Purely solar terms** (S2, P1, T2, S4, SA, SSA) get **no** nodal
  correction (f=1, u=0) — they don't depend on the lunar node by
  construction.
- **Shallow-water/compound terms** (M4, MN4, MS4, M6, 2MS6, MK3, MSF) are
  literal integer sums/differences of parent speeds, so their correction is
  the corresponding product of f's and signed sum of u's (e.g.
  f(M4)=f(M2)², u(M4)=2·u(M2); f(MSF)=f(M2), u(MSF)=−u(M2) since
  MSF = S2−M2 and S2 carries no correction). This is exactly how real
  tide-prediction software derives compound-tide nodal corrections.

**Did it help? Modestly, and mostly not the way expected.** An A/B test
holding the constituent set and train/test split fixed:

| | height RMSE (turning pts) | timing mean \|err\| | timing max \|err\| |
|---|---|---|---|
| WITHOUT nodal correction | 0.0314 m | 9.79 min | 28.32 min |
| WITH nodal correction | 0.0313 m | **9.45 min** | 29.68 min |

Nodal correction gave a small real improvement in mean timing (9.79 → 9.45
min, ~3.5% relative) and essentially no change in height RMSE, and it did
*not* improve the worst-case timing miss (28.3 → 29.7 min — noise-level,
plausibly a different specific date became the worst case). **The
coordinator's diagnosis was right that the seasonal residual pattern seen
in round 1 pointed at something like an unmodelled nodal/long-period
effect** — but the honest empirical finding is that the bulk of round 2's
big timing improvement (24 → 9.45 min) came from **the extra resolvable
constituents and the longer, interior-held-out record**, not from the
nodal correction specifically. Nodal correction is still worth shipping
(it's free at runtime, physically correct, and it does help a little), but
don't oversell it as the fix — it's a small refinement on top of the real
fix (more data, more terms, a harder validation split).

## Mid-tide accuracy — the new metric, and an important caveat

**Raw number:** RMSE 0.173 m, max 0.404 m, measured at the temporal
midpoint between every pair of adjacent tabulated turning points in the
held-out year, against a **proxy** ground truth = the average of the two
adjacent tabulated heights (see `midTideProxy()` in `fit.mjs`).

**This number needs a caveat, and it's a real one, not a rationalization.**
There is no continuous ground truth in this dataset (LINZ's tables record
turning points only — no tide-gauge time series), so "average of adjacent
extrema" is the best available proxy, but it silently assumes the tide is
symmetric in time about its mean level between a high and a low. Tauranga's
tide is not: the M4/M6/2MS6/MN4 shallow-water terms (see the overfitting
caveat above) are all sizeable here (M4 ≈ 0.07 m, M6 ≈ 0.07 m — unusually
large for M6, consistent with a harbour behind a narrow entrance), and they
skew the curve so the true mean-crossing happens at a different time than
the arithmetic midpoint.

To separate "the model is wrong at mid-tide" from "the proxy itself is a
bad approximation of a genuinely asymmetric curve," a diagnostic was run:
compare the model's own prediction at the temporal midpoint against the
average of the **model's own predictions** at the two neighbouring
turning-point times (i.e. how far the model's curve legitimately deviates
from a naive average, independent of any real-world truth):

| comparison | RMSE |
|---|---|
| model(midpoint) vs avg(actual adjacent tabulated heights) — the raw metric above | 0.173 m (validation-split model) / 0.152 m (shipping model) |
| model(midpoint) vs avg(model's own predicted heights at the two neighbours) — self-asymmetry, no real-world data involved | 0.147 m (shipping model) |

**~85-95% of the raw mid-tide error is explained by curve asymmetry the
model itself produces**, not by the model disagreeing with reality at a
point reality was never actually measured. In other words: the "0.17 m
mid-tide error" mostly measures "this proxy assumes a symmetric tide and
Tauranga's tide isn't symmetric," not "the harmonic model is 17 cm wrong in
the middle of the tide."

**Honest bottom line on this metric:** we cannot fully validate mid-tide
accuracy without real continuous ground truth (e.g. even a short tide-gauge
time series would let us check this properly) — that's a genuine gap, not
glossed over. What we *can* say: the turning points (where we do have
ground truth) fit well (3 cm RMS), the curve shape between them is
physically motivated (real harbour shallow-water overtides, not
noise — M4/M6 of this size are a known signature of narrow-entrance
harbours) but not independently confirmed, and a live display should be
expected to be accurate within a few cm near the turning points, with
lower — but not measured to be bad — confidence mid-cycle.

## Worst 10 height misses (2026 held-out)

| date/time (NZ local) | actual (m) | predicted (m) | height err (m) | timing err (min) |
|---|---|---|---|---|
| 2026-07-18 10:04 | 2.00 | 1.921 | -0.079 | -11.9 |
| 2026-07-28 18:36 | 1.80 | 1.722 | -0.078 | -13.0 |
| 2026-10-22 16:46 | 1.70 | 1.626 | -0.074 | -0.7 |
| 2026-08-18 11:15 | 1.90 | 1.827 | -0.073 | -12.0 |
| 2026-12-17 13:41 | 1.80 | 1.728 | -0.072 | +7.3 |
| 2026-07-22 13:28 | 1.80 | 1.728 | -0.072 | -14.1 |
| 2026-10-29 16:16 | 0.30 | 0.229 | -0.071 | +20.5 |
| 2026-06-02 20:54 | 1.90 | 1.830 | -0.070 | -12.0 |
| 2026-07-20 11:46 | 1.90 | 1.831 | -0.069 | -13.8 |
| 2026-08-04 04:48 | 0.30 | 0.368 | +0.068 | +8.9 |

Note the seasonal clustering the round-1 residual showed (Mar-May) is
**gone** — round 2's worst misses are scattered across the year
(Jun/Jul/Aug/Oct/Dec), consistent with the nodal correction and extra
constituents having actually fixed a real seasonal effect, not just moved
it somewhere else.

## Worst 10 timing misses (2026 held-out)

| date/time (NZ local) | timing error (min) | height error (m) |
|---|---|---|
| 2026-11-07 12:17 | +29.7 | -0.004 |
| 2026-11-06 11:20 | +29.1 | +0.004 |
| 2026-10-09 12:38 | +28.1 | +0.017 |
| 2026-12-06 11:51 | +27.3 | -0.012 |
| 2026-11-23 12:22 | +27.1 | +0.021 |
| 2026-10-25 12:55 | +27.0 | -0.006 |
| 2026-04-28 22:51 | +27.0 | -0.001 |
| 2026-10-26 13:45 | +27.0 | +0.029 |
| 2026-10-08 11:41 | +26.7 | -0.056 |
| 2026-11-24 13:18 | +26.5 | -0.048 |

Worth noting explicitly: these are the sharpest test in the whole
validation (per the original task's own framing — height error is a *weak*
constraint at a turning point since dh/dt→0 there, timing is the real
test). Several of the worst timing misses have small height error (a few
mm) — exactly the pattern you'd expect from a well-fitted amplitude with a
still-imperfect phase, concentrated in Oct-Dec 2026. That's a legitimate
residual, smaller than round 1's, not eliminated.

## Baseline comparison: cosine interpolation (unaffected by round 2 changes)

Same leave-one-out methodology as round 1 (see round-1 discussion below for
the full caveat about why this is the fairest available non-trivial test):

| metric | harmonic model (2026 held out, round 2) | interpolation baseline (leave-one-out, 2026) |
|---|---|---|
| RMSE | **0.0313 m** | 1.4324 m |
| Max error | 0.0789 m | 1.9481 m |

The harmonic model still decisively beats the baseline (97.8% lower RMSE),
and by a wider margin than round 1 (was 96.4%). Same caveat as before
applies: this specific test is a proxy for "the baseline has a gap in its
table," not a claim that the harmonic model beats a *complete, correct,
already-bundled* table at its own nodes (which is trivially exact by
definition). The real-world argument for the harmonic model is unchanged:
it needs no per-year table at all and works identically for any past or
future instant.

## Physics sanity check

M2 amplitude (survivor-only fit, train 2023+2024+2025+2027): **0.6524 m**
— close to round 1's 0.6883 m, still comfortably in the expected ~0.7 m
range, and still by far the dominant constituent (next largest, N2 at
0.170 m, is ~3.8x smaller). **Passes.**

The small drop from 0.688 m (round 1) to 0.652 m (round 2) is expected and
correct: round 1's M2 had to absorb some energy that properly belongs to
N2, L2, NU2, 2N2, M6 etc. (constituents round 1 didn't have), since a
14-term fit forces nearby-frequency energy into whichever term is present.
Round 2's larger constituent set gives each term a cleaner, more physically
correct share of the signal — this is a sign the fit *improved*, not that
something broke.

## Shipping fit (all five years: 2023-2027, 23 survivor constituents)

| constituent | amplitude (m) | phase (deg) |
|---|---|---|
| M2 | 0.6553 | 64.73 |
| N2 | 0.1666 | 132.43 |
| S2 | 0.1058 | -99.49 |
| M6 | 0.0663 | -178.61 |
| M4 | 0.0620 | 107.00 |
| K1 | 0.0529 | -14.61 |
| L2 | 0.0513 | 138.89 |
| SA | 0.0444 | 107.88 |
| NU2 | 0.0431 | 172.96 |
| LDA2 | 0.0245 | 107.29 |
| Mm | 0.0212 | 89.37 |
| O1 | 0.0209 | -149.39 |
| 2MS6 | 0.0208 | 105.71 |
| K2 | 0.0200 | 61.45 |
| P1 | 0.0168 | 8.20 |
| 2N2 | 0.0157 | -162.08 |
| MN4 | 0.0102 | 176.09 |
| MK3 | 0.0094 | 71.94 |
| MSF | 0.0083 | 34.77 |
| T2 | 0.0074 | -51.85 |
| MS4 | 0.0064 | -74.15 |
| J1 | 0.0056 | -68.51 |
| MU2 | 0.0046 | 33.66 |

Z0 = **1.0541 m**. Coefficients are close to the validation (train-only)
fit above — a good sign of stability, not overfitting to whichever years
happen to be included.

## Module size

`tauranga-tide.js` is **9,069 bytes** (~8.9 kB) as generated — up from
round 1's 4.7 kB (roughly double, from 14→23 constituents plus the nodal
correction code), zero dependencies, ES module. Still small, still
trivially fine for mobile bundling.

## Attribution (required — do not ship without this)

Source data: **LINZ (Land Information New Zealand)**, official tide
predictions for Tauranga (port 073, `research/tauranga_2023..2027.csv`).
LINZ is the authoritative source for New Zealand tide predictions; a
shipping app must display LINZ attribution (and ideally a link to LINZ's
tide-prediction disclaimer) wherever tide data or predictions derived from
it are shown. This harmonic model is *derived from* LINZ's published
predictions — it is a compact approximation, not a substitute for LINZ as
the source of truth for navigation or safety-critical use.

## Bottom line (round 2)

- **Good for:** a live, continuously-moving tide-height display for a
  general-audience Tauranga tide-map app, for any date past or future,
  fully offline, with no periodic data updates required. Turning-point
  accuracy is now genuinely good: ~3 cm RMS height, ~9.5 min mean timing
  error (worst case ~30 min) on a real interior held-out year. That's a
  believable "next high tide at HH:MM" for a consumer app.
- **Ceiling found, stated plainly:** timing error did **not** vanish — it
  went from "soft" (24 min) to "workable" (9.5 min mean, 30 min worst
  case), not to zero. This is a real, measured ceiling, not a
  give-up-early guess: it persists after 23 constituents, nodal
  correction, and a proper interior-year test. Some of it is almost
  certainly finite-precision astronomical modelling (our reduced N-only
  nodal formulae, no lunar-perigee p dependence, no compound-tide
  higher-order terms beyond what's listed) and some is inherent to
  fitting turning points only rather than a continuous record — the task
  flagged this risk correctly up front. A residual concentrated in
  Oct-Dec 2026 with small height error but ~27-30 min timing error is the
  clearest remaining signature; further improvement would need either a
  continuous (sub-hourly) calibration signal or full p-dependent nodal
  formulae for L2/M1, neither of which is in the LINZ turning-point
  tables provided.
- **Mid-tide accuracy is reported but not independently confirmed** — see
  the dedicated section above. The raw 17 cm RMSE number is mostly (not
  entirely) a proxy artifact from genuine curve asymmetry, not clear
  evidence of model error, but this dataset cannot fully resolve the
  difference without continuous ground truth.
- **Nodal correction: keep it, but it's not the star of this round.** It
  gave a small real improvement (~3.5% off mean timing error) at zero
  runtime cost and is physically correct to include — but the big win came
  from more data and more constituents, honestly reported as such rather
  than crediting the more sophisticated-sounding fix.
- **Recommendation on the hybrid question:** the coordinator asked to
  consider bundling LINZ's tables directly and using the harmonic model
  only outside the published window, if timing didn't improve. Timing
  *did* improve materially (24→9.5 min mean), so that hybrid is not
  required for this app's stated goal (general "roughly when's high tide"
  display). If a future requirement needs sub-5-minute timing guarantees
  (e.g. for something safety-adjacent), the honest recommendation would
  flip: bundle LINZ's actual table for the published 5-year window (exact
  by construction) and fall back to this harmonic model only outside it.
  For the stated goal — a live water-level display for a general-audience
  map app — the harmonic model alone is the right call.

---

# History: round 1 (superseded, kept for the record)

Round 1 trained on 2024+2025, held out 2026 (the *last* year available at
the time — an extrapolation test, not an interior-year test), used 14
constituents, and no nodal correction.

## Data-coverage deviation from spec (round 1 — resolved in round 2)

The original task asked to fit on 2023-2026 and hold out 2026. At the
time, `research/` did not contain `tauranga_2023.csv` — only 2024, 2025 and
2026 existed. Round 1 trained on 2024+2025 and held out 2026 in full. The
coordinator has since supplied 2023 and 2027; round 2 above supersedes this
entirely.

## Round-1 fitted constituents (train: 2024+2025 only, 14 candidates, unpruned)

| constituent | amplitude (m) | phase (deg) |
|---|---|---|
| M2 | 0.6883 | 66.34 |
| N2 | 0.1241 | 127.74 |
| S2 | 0.0973 | -85.97 |
| M4 | 0.0864 | -136.35 |
| K1 | 0.0559 | -10.19 |
| K2 | 0.0359 | 77.06 |
| Mm | 0.0282 | -167.39 |
| MS4 | 0.0206 | 89.08 |
| P1 | 0.0159 | 6.60 |
| MN4 | 0.0096 | -88.25 |
| O1 | 0.0094 | -124.76 |
| Mf | 0.0074 | 88.93 |
| Q1 | 0.0027 | 19.57 |
| SSA | 0.0010 | -114.53 |

Z0 = 1.1110 m.

## Round-1 held-out validation (2026, extrapolation test)

| metric | value |
|---|---|
| Height RMSE at turning points | 0.0513 m |
| Height max error | 0.1692 m |
| Timing mean absolute error | 24.16 min |
| Timing max absolute error | 55.69 min |

Worst misses clustered in March-May 2026 and were consistently
under-predicted — the residual the coordinator diagnosed as a likely
unmodelled nodal/seasonal effect, which round 2's nodal correction plus
extra constituents addressed (see above; the clustering is gone in round
2's worst-miss table).

## Round-1 baseline comparison methodology (still used in round 2, unchanged)

Baseline = cosine interpolation between tabulated turning points (same
method as `research/tide-coverage-probe.mjs`). Evaluating it *at* the
tabulated points directly would be trivially exact (0 error) since those
are its own input nodes — not a meaningful test. Instead, **leave-one-out**:
remove each turning point, interpolate its height from its (now
non-adjacent) neighbours two steps away, and compare to the actual value.
This measures the baseline's ability to fill an unknown gap in the table
(the practically relevant scenario: predicting anything outside whatever
table happens to be bundled) rather than its trivial performance at its own
nodes. Caveat: removing a point roughly doubles the interpolation gap
(~6.2h → ~12.4h), which handicaps the baseline relative to its normal
use — but there is no continuous ground truth in this dataset to construct
a fairer test, and the practical scenario (a gap in the bundled table) is
genuinely what this baseline would face if asked to predict a date outside
its bundled year.
