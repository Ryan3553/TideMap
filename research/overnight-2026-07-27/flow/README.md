# J4 — the flowing, swirling channel texture

`prototype/prep-flow.mjs` (new) reads `prototype/data/field-v2.png` and writes
`prototype/data/flow.png` + `flow.json`. Run: `node prep-flow.mjs [OUT=4096] [WORK=2048]` from
`prototype/`. Full 4096 run takes about a minute (28.5s for the LIC pass itself, `--max-old-space-size=8192`
recommended). Nothing in `template-v2.html`, `look.mjs`, or `prep-field.mjs` was touched.

## Method

**1. A combined terrain surface.** `field-v2`'s two water-relevant channels have *complementary*,
not overlapping, support: R (drying height) is pinned to the water sentinel over every
permanently-wet pixel — channels and open ocean read identically there — and only varies over
land/flats. G (bathy proxy, chamfer distance from the water's edge) is pinned to 0 over every
land/flat pixel and only varies in permanently-wet water. So neither channel alone has a usable
gradient everywhere. Summing them fixes that:

```
phi = heightNorm(0..1, water=0, land=1) - bathyProxy(0..1, shore=0, deep sea=1)
```

Land is raised, the sea floor is carved into valleys that deepen away from every shore — a real
combined terrain surface, and exactly "the height/bathy surface" the job spec asks the gradient
of. Its gradient is meaningful everywhere water or land actually has shape.

**2. A gradient pyramid, not a single blur.** `phi` is blurred at six scales (8/16/32/64/128/256
output-px ≈ 3 scales spanning ~80m to ~2.5km) and gradient-Sobel'd at each. A real edge's gradient
magnitude falls off as `~1/sigma` after Gaussian blur, so `score = |grad| * sigma` is roughly
scale-invariant for genuine structure but keeps falling for blur-smoothed quantisation noise
(which decays faster, `~1/sigma^2`). Levels are alpha-composited fine-to-coarse using
`smoothstep(score, 4, 14)` as the confidence weight at each level, coarsest level absorbing
whatever confidence budget is left — so narrow drainage creeks get fine detail, wide open water
falls back smoothly to the regional trend instead of amplifying noise.

**3. Sign the tangent seaward.** The blended gradient's perpendicular gives the channel *axis*,
but an axis has two possible directions and there is no local way to pick one (a vector is exactly
orthogonal to its own perpendicular by construction). The coarsest pyramid level
(`sigma=256px ≈ 2.5km`) stands in for the regional "which way is the sea" trend — `phi` decreases
toward deeper/more oceanic water at that scale too — so the fine tangent is flipped to align with
`-grad(coarsest level)` wherever the two disagree. This is what makes the encoded direction usable
for flood/ebb animation (see below) and also keeps neighbouring pixels' tangents from randomly
flipping 180°, which matters for stable LIC integration.

**4. LIC with a shared streamline for both phases.** For each pixel, one streamline of
`2*(L+SHIFT)+1` noise samples is integrated by RK2 (midpoint), `L=40` output-px each direction,
noise pre-blurred `sigma=1.3` work-px (a cheap stand-in for "slightly blue" — kills the 1-px
correlation length that would otherwise alias on upsampling). Phase A is the mean over the
`2L+1`-sample window centred on the seed pixel; phase B is the *same* window slid `SHIFT=10px`
further along the streamline (seaward, since the streamline direction is the signed tangent from
step 3). One integration pass produces both phases, so they are phase-coherent by construction —
B is literally A's noise pattern advected downstream, not an independent LIC run.

**5. Local contrast normalisation.** Raw LIC output has very different mean/variance in a narrow
dredged channel vs. a wide flat, so a global stretch would either blow out the channels or leave
the flats flat. Each phase is stretched to `[localMean - 1.7*std, localMean + 1.7*std] -> [0,1]`
using a `sigma=90px` local window (computed via `blur(x)` and `blur(x^2)`), independently per
phase, before masking.

**6. Water mask.** Discovered mid-job: drying height *cannot* distinguish a real channel from the
open ocean — both are the same water sentinel value, by construction of `field-v2`. Only the bathy
proxy carries that distinction (0 at every shoreline, rising with distance from it). So the mask
is `landFactor(H) * mix(0.035, 1.0, 1 - smoothstep(0.30, 0.80, bathy))`: full strength through
shallow-to-mid water (which includes every drainage creek on the flats, since bathy is pinned to 0
there), fading to a low floor by the time bathy proxy nears open-ocean saturation, gated to 0 as
height crosses into dry land (2.0–2.4m). An earlier version tried to also boost "near-sentinel"
height — wrong, since that's true of the entire ocean too, and it made the whole sea as bright as
the harbour. Caught by the first whole-harbour preview, not by inspecting the mask formula in
isolation — render early.

## Constants (current, in `prep-flow.mjs`)

| constant | value | |
|---|---|---|
| `SIGMAS_OUT` | 8, 16, 32, 64, 128, 256 px | gradient pyramid |
| `SCORE_LO/HI` | 4 / 14 | confidence band for level blend |
| `L_OUT` | 40 px | LIC half-length |
| `SHIFT_OUT` | 10 px | phase-B downstream offset |
| `LOCAL_SIGMA_OUT` | 90 px | contrast-normalisation window |
| `CONTRAST_K` | 1.7 | stretch aggressiveness |
| `FAR_FLOOR` | 0.035 | open-ocean mask floor |
| `LAND_H` | 2.0 → 2.4 m | mask fade-to-zero on dry land |
| `CHANNEL_BATHY` | 0.30 → 0.80 | mask fade band (full → floor) vs. bathy proxy |
| `NOISE_SIGMA` | 1.3 work-px | seed-noise pre-blur (streak-width / anti-alias) |
| `WORK` | 2048 (default) | internal compute grid; upsampled (mitchell) to `OUT=4096` |

`WORK=2048` was chosen for speed (full run ≈ 60s incl. I/O) without visibly losing detail —
channels and creeks are hundreds of metres wide, `WORK` resolution is ~19m/px. Tangent components
(not the raw angle) are upsampled and re-atan2'd at the end, so the 0/2π wrap is never
interpolated across.

## Preview verdicts (`research/overnight-2026-07-27/flow/*.png`)

All three are screen-blended, cyan-tinted `max(phaseA, phaseB)` over `base-aerial.jpg`, for
judging shape only — not the final in-shader look.

- **`a-whole-harbour.png`** — reads as flowing, braided water immediately, not noise and not
  contour lines. The northern flats (top-left) and the harbour-mouth channel both look like the
  reference's bioluminescent-flow aesthetic. Open ocean is now nearly black with only a faint
  texture, as intended — J5 owns the sea's own movement.
- **`b-mount-maunganui-channel.png`** — the main shipping channel streaks curve naturally past
  Mauao and into the city. A tight, fairly regular ring pattern shows up right against the
  peninsula and again near the port breakwater tip — LIC's classic signature at a flow
  singularity, and physically defensible (headlands really do generate eddies) — but it reads a
  little too crisp/mechanical rather than turbulent. Acceptable, flagged as a tuning target if
  Ryan calls it out.
- **`c-northern-basin-flats.png`** — the best of the three. Dense, organic, braided drainage-creek
  filaments across the whole basin; this crop is the closest match to the reference image's
  signature look.

**Known artifact, not fixed here (out of scope for J4):** a ~150–200m bright blob sits in open
water northeast of the harbour mouth (visible as a second, more isolated ring in the
whole-harbour preview, roughly output-px (1800,1200) at 4096). Cropped and inspected directly
against `base-aerial.jpg` — it's very likely a vessel under way, caught mid-scene and
misclassified as land by the drying-height step-fit (its footprint reads as a real "islet" in
`field-v2`'s R channel, chamfer-carved into the bathy proxy too). LIC correctly produces a swirl
around any isolated land-like bump sitting in open water — that's not a bug in this script, the
input told it there's a small island there. Worth a look from whoever owns the drying-height
pipeline; not touched here since `prep-field.mjs` is off-limits for this job and the mask's low
open-ocean floor already keeps it from dominating.

## Two-phase animation — exact spec for the shader agent

`flow.png` is RGB: **R = phase A**, **G = phase B**, **B = flow angle** (`angle/2π * 255`,
`0..255`), all 4096×4096, matching `field-v2.png`'s grid so it samples with the same UVs.

- **A and B are the same LIC pattern, B slid `SHIFT_OUT=10` output-px seaward along the flow.**
  They are correlated, not independent noise — crossfading between them reads as the pattern
  *sliding* along the channel, not dissolving.
- **Recommended combination:** maintain a phase scalar `p` that increases over time (e.g. one
  full cycle every 8–15s for a lively-but-not-busy feel, per J5's "breathing on a long period").
  `flow = mix(A, B, triangle(p))` where `triangle` ping-pongs 0→1→0 (e.g.
  `triangle(p) = abs(fract(p) * 2 - 1)`), OR simpler and probably better-looking: don't ping-pong,
  just use `flow = mix(A, B, fract(p))` and accept the 1-frame pop back from B to A each cycle —
  test both, the ping-pong is smoother but the fract wrap wastes less of A vs. B's *relative*
  displacement per cycle since it doesn't reverse. Either way keep the cycle SLOW; both A and B
  already look like plausible static water on their own, the crossfade just needs to nudge one
  into the other believably.
- **Direction and tide sign:** decode the angle channel as
  `dir = vec2(cos(angle), sin(angle))` where `angle = B_channel/255 * 2π`. **Do not** lerp/filter
  the raw angle value across texels near the 0/2π wrap (bilinear-filtering the texture itself is
  fine — GPU texture filtering interpolates the stored byte, which does wrap incorrectly right at
  the seam, but that seam is one texel wide and will not be visible at any reasonable zoom;
  decoding cos/sin per-sample is still the correct approach and avoids relying on that). `dir`
  points **seaward** (the sign convention baked into this texture: toward decreasing drying
  height / increasing bathy proxy). For animation direction: on **ebb** (tide falling, water
  actually leaving), advance the phase `p` so the visible motion runs *with* `dir` — i.e. the
  natural A→B direction, since B is A shifted seaward. On **flood** (tide rising), run the phase
  backward (`mix(B, A, fract(p))`, or just negate `dp/dt`) so the apparent motion is landward. A
  simple, cheap way to pick the sign without a branch: multiply the phase's rate of change by
  `sign(uTidePast - uTide)` or whatever the renderer already uses to distinguish flood/ebb (see
  `template-v2.html`'s `ebb` term in the shore-glow code for the existing convention).
- **Intensity/visibility:** `flow` (the mixed phase) is already contrast-normalised and
  mask-shaped 0..1 — treat it as a luminance/opacity multiplier for a tint colour, not as a
  standalone colour. It is genuinely near-zero on land and near the floor value (~0.035×its local
  contrast) far offshore, so it should be safe to add/screen into the water colour without a
  separate mask in the shader.

## Summary for the orchestrator

`prototype/prep-flow.mjs` generates `prototype/data/flow.png` (4096×4096, R=LIC phase A, G=LIC
phase B, B=seaward flow angle) + `flow.json` (method + constants) from `field-v2.png` only.
Method: combined height/bathy terrain surface → multi-scale gradient pyramid → seaward-signed
tangent field → RK2 line-integral-convolution of noise (one streamline, two overlapping sample
windows for phase-coherent A/B) → local contrast normalisation → bathy-driven channel/open-ocean
mask. Full 4096 build runs in about a minute at `WORK=2048` internal resolution.

Previews in this folder (whole harbour, Mount Maunganui channel, northern-basin flats) all read as
flowing, braided water, closest to the reference in the northern basin. Two-phase animation scheme
is phase-coherent by construction (B = A's own streamline slid downstream) and documented above
precisely enough to implement without re-deriving it — the wave-2 shader agent should be able to
work directly from the "Two-phase animation" section.

**Known issue, not fixed (own job's scope only):** a small bright blob in open water near the
harbour mouth (likely a vessel misclassified as land upstream in drying-height) produces a visible
LIC swirl. Kept small by the low open-ocean mask floor; flagged for whoever owns the drying-height
pipeline. **Assumption flagged:** the spec's "tangent pointing seaward" was read as "sign the axis
using a coarse-scale reference field", since a vector's own local gradient cannot disambiguate its
perpendicular's sign (they are exactly orthogonal) — documented in the method section above in
case a different interpretation was intended.
