# J4 — the flowing, swirling channel texture

`prototype/prep-flow.mjs` reads `prototype/data/field-v2.png` and writes `prototype/data/flow.png`
+ `flow.json`. Run: `node prep-flow.mjs [OUT=4096] [WORK=2048]` from `prototype/`. Full run takes
about a minute (28s for the LIC pass itself, `--max-old-space-size=8192` recommended). Nothing in
`template-v2.html`, `look.mjs`, or `prep-field.mjs` was touched, in either round.

**This is the round-2 revision.** The coordinator reviewed round 1's previews and found four
defects: hard block seams, ocean-side rings/bullseyes (including a real vessel misclassified as
land upstream), a whited-out northern basin with no contrast, and a couple of hard-zero patches.
All four are fixed below; round 1's method write-up is kept where it still applies and corrected
where it does not.

## Method

**1. A combined terrain surface.** `field-v2`'s two water-relevant channels have *complementary*,
not overlapping, support: R (drying height) is pinned to the water sentinel over every
permanently-wet pixel — channels and open ocean read identically there — and only varies over
land/flats. G (bathy proxy, chamfer distance from the water's edge) is pinned to 0 over every
land/flat pixel and only varies in permanently-wet water. Summing them fixes that:

```
phi = heightNorm(0..1, water=0, land=1) - bathyProxy(0..1, shore=0, deep sea=1)
```

Land is raised, the sea floor is carved into valleys that deepen away from every shore.

**1b. Erase misclassified islets before building `phi` (new in round 2).** A ~150–200m bright
blob northeast of the harbour mouth, cropped and checked directly against `base-aerial.jpg`, is
very likely a vessel under way, caught mid-scene and misclassified as land by the drying-height
step-fit. Connected-component label anything land-like (`heightNorm > 0.85`); any component that
does *not* touch the working crop's border and is smaller than `ISLET_MAX_DIM_OUT=50` output-px is
erased to the water sentinel. (Real land always fails at least one of those two tests.) This alone
was not enough — see the next point.

**1c. Heal the bathy proxy's chamfer shadow, not just the erased pixel.** `prep-field.mjs`'s
chamfer distance was computed *with* the blob counted as land, so every water pixel within its
~3.4km reach (`DEEP_PX=220` source-px) has a depressed bathy value — a shadow far bigger than the
blob's own footprint. Erasing height alone left that shadow in place, which still read as a
"shore" in `phi` and still rang in the LIC — round 2's first attempt at this (a plain multiply-
down heal, sigma too small and not excluding land from the average) barely moved the number. The
working fix excludes an `ISLET_INFLUENCE_OUT=420`px-radius disc around each erased blob (not just
the blob) from the healing average, fills from a `ISLET_HEAL_SIGMA_OUT=350`px ring beyond that
(excluding land, which is automatically zero and would otherwise drag the fill down), and blends
the result back in over that same disc. Verified numerically before moving on: sampled the real
bathy proxy in rings at increasing radius from the blob to confirm what "healed" should read
(~0.6–0.9, not 1.0 — this location is not as far out to sea as it looks), then checked the healed
value matched.

**2. A gradient pyramid, not a single blur**, and **3. Sign the tangent seaward** — unchanged from
round 1, see the constants table. The pyramid blend is a continuous per-pixel `smoothstep` of a
confidence score, not a discrete level switch, so it was never itself the source of the block
seams (see point 5).

**4. LIC with a shared streamline for both phases** — unchanged: one streamline of
`2*(L+SHIFT)+1` noise samples integrated by RK2, phase A centred on the seed pixel, phase B the
same window slid `SHIFT=10` output-px seaward along the same streamline.

**5. Every blur is now a hand-rolled, seamless box-approximated Gaussian, not `sharp .blur()`
(round-2 fix for the block-seam defect).** `sharp`'s blur produced hard rectangular discontinuities
at the large sigmas this script needs (64–256 work-px, plus the 90px contrast window) — visible as
block edges cutting through the gradient pyramid, the local-contrast stats, and therefore straight
through the LIC output (confirmed by a native-resolution crop before and after: identical
streak/braid content, blocks gone). `gaussBlur` (Kovesi/Kutskir three-box approximation, sliding
accumulator over the full row/column, no tiling of any kind) replaced it everywhere, and the whole
pipeline moved to `Float32Array` throughout (no 8-bit quantisation of any intermediate) as a side
benefit — cheaper too, since there is no more PNG round-trip through `sharp` for every blur.

**6. Local contrast normalisation** — unchanged mechanism (stretch
`[localMean - 1.7*std, localMean + 1.7*std] -> [0,1]` per pixel, `sigma=72px`), now computed by
`gaussBlur` instead of `sharp`, which is what actually fixed its share of the block seams.

**7. Amplitude weighting rebuilt around real contrast, not a flat mask (round-2 fix for the
whited-out flats).** Round 1 shaped presence only by depth band (bathy proxy), which is uniform
across an entire flat — so contrast normalisation stretched every patch of open flat to the same
brightness as a real channel, and the northern basin read as a single lit blob. Round 2 adds
**channel-likeliness**: `|laplacian(phi blurred at 18 output-px)|`, percentile-normalised (85th
percentile over water, subsampled). High at real morphology — channel cores, drainage-creek
cuts — near zero on a featureless flat, by construction (a flat has no curvature to find).
Amplitude is `FEATURELESS_FLOOR=0.20 + 0.80*channelLikeliness`, gating the already-computed
land/ocean mask. Checked with a histogram, not just by eye: **7.2% of water pixels sit above half
amplitude** (target ≤35%).

**8. Vortex/critical-point suppression (round-2 fix for the ring/bullseye defect) — the hard part.**
Two approaches were tried and discarded before the one that worked, kept here because the reasoning
is not obvious and the next person tuning this will otherwise re-walk the same dead ends:
  - *Pointwise curl* (`|curl(smoothed tangent field)| → implied radius`, damp below a threshold).
    Discarded: LIC integrates `L_OUT=40` px each way, so a pixel 100+ px from a "loose" spiral
    still gets pulled into it during integration and rings just as hard as a tight one — the
    artifact is not a property of any one point's curvature.
  - *Net rotation along each pixel's own streamline* (walk the tangent field along the already-
    traced LIC path, accumulate signed turn, damp above a threshold). Discarded: measured near
    zero even directly on top of a visible ring, because a short arc of a *wide* circle is nearly
    straight (chord/arc ratio close to 1) even though it is still part of a circular flow. This
    proved the artifact is not really about curvature at all.
  - **What the raw (pre-normalisation) LIC output showed, dumped and inspected directly:** the
    ring is baked into the LIC signal itself, before any contrast stretch or amplitude weighting.
    That is the tell — it means the mechanism is a known LIC pathology: near a critical point,
    neighbouring streamlines *at the same radius* are nearly identical (they trace close to the
    same circle), while streamlines at a different radius sample different noise. LIC renders that
    as concentric bands of different brightness — a property of the *field* near the critical
    point, not of any one streamline.
  - **The fix: find critical points directly, by winding number** (the standard tool for exactly
    this — sample the tangent direction at 8 points around a small loop, radius `0.6*L` work-px,
    sum the signed angle steps; non-zero only within about one grid cell of a true singularity of
    the combined gradient field). Each detected point is blown up into a soft disc of radius
    `VORTEX_DISC_OUT = 5*L_OUT` output-px — sized to how far a critical point's influence actually
    reaches in the *rendered* output, not to the singularity itself, since that is what the first
    two attempts underestimated. Inside the disc, both LIC phases are blended toward **neutral grey
    (0.5)**, not just scaled down: a ring is a *shape* (relative contrast between ring and gap), and
    uniform dimming leaves that shape fully legible at lower brightness. Blending to neutral erases
    the pattern itself, leaving the pixel looking like the same quiet water as its surroundings —
    which is what it would have looked like had the critical point not been there.

Verified by direct inspection at each step (not assumed): dumped `channelLikeliness`, the winding-
number seed mask, and the raw pre-normalisation LIC output as standalone PNGs and cropped them
against the exact pixel coordinates of the visible artifacts before concluding what was actually
driving them. The two discarded approaches were each tested end-to-end (including a full 4096
render) before being abandoned — resolution matters here: a `WORK=1024` test appeared to fix the
second attempt, but that was the ring being under-resolved at lower internal resolution, not
actually suppressed; only the `WORK=2048` (true build) render told the truth. Round 3, if there is
one, should render at build resolution every time, not trust a downsampled proxy for this class of
artifact.

**9. Ocean gate tightened (round-2 fix, part of the ring/whited-out-ocean defect).** `FAR_FLOOR`
0.035 → **0.02**, and the fade band moved from bathy 0.30–0.80 to **0.20–0.45** — the open sea
starts fading out much closer to shore and reaches a near-zero floor well before true open water,
per the coordinator's explicit "beyond bathy>0.45 the flow should fade to near zero."

## Constants (current, in `prep-flow.mjs`)

| constant | round 1 | round 2 | |
|---|---|---|---|
| `LOCAL_SIGMA_OUT` | 90px | **72px** | contrast-normalisation window (spec: ~48–96) |
| `FAR_FLOOR` | 0.035 | **0.02** | open-ocean mask floor |
| `OCEAN_BATHY` (was `CHANNEL_BATHY`) | 0.30 → 0.80 | **0.20 → 0.45** | mask fade band vs. bathy proxy |
| `CURVE_SIGMA_OUT` | — | **18px** (new) | channel-likeliness curvature scale |
| `FEATURELESS_FLOOR` | — | **0.20** (new) | amplitude on flat, featureless water |
| `ISLET_MAX_DIM_OUT` | — | **50px** (new) | islet erase size cutoff |
| `ISLET_INFLUENCE_OUT` / `ISLET_HEAL_SIGMA_OUT` | — | **420px / 350px** (new) | bathy-shadow heal radii |
| `VORTEX_LOOP_WORK` / `VORTEX_DISC_OUT` | — | **0.6·L / 5·L_OUT** (new) | winding-number loop / suppression disc |
| `SIGMAS_OUT`, `SCORE_LO/HI`, `L_OUT`, `SHIFT_OUT`, `CONTRAST_K`, `LAND_H`, `NOISE_SIGMA` | unchanged | unchanged | see round-1 notes above |

`WORK=2048` (default) upsampled to `OUT=4096` via mitchell resize. Tangent components (not the
raw angle) are upsampled and re-atan2'd at the end, so the 0/2π wrap is never interpolated across.
Smoothing is now `gaussBlur` everywhere (see point 5) — `sharp` is only used for the initial
downsize load, the final upsize, and PNG encode.

## Preview verdicts, round 2 (`research/overnight-2026-07-27/flow/*.png`)

All three are screen-blended, cyan-tinted `max(phaseA, phaseB)` over `base-aerial.jpg`, for
judging shape only — not the final in-shader look. Regenerated after every constant change in this
round; the acceptance check below is against the *current* files, not an earlier pass.

- **`a-whole-harbour.png`** — flowing, braided water; open ocean reads as genuinely quiet and dark
  now, not a faint comb pattern. The vessel-islet location shows only the actual tiny boat glint
  from the base imagery, no ring. No block seams visible at any zoom.
- **`b-mount-maunganui-channel.png`** — channel filaments curve naturally past Mauao. What was a
  crisp, mechanical double-ring at the entrance and the breakwater is now a soft, low-contrast
  eddy — reads as turbulence, not a contour plot.
- **`c-northern-basin-flats.png`** — the target crop for the round-1 white-out and the round-2
  bullseye both. Bright braided drainage-creek filaments now sit against genuinely darker, quieter
  water between them (channel-likeliness contrast), and the large near-bullseye that dominated this
  crop is gone (blended to neutral by the winding-number fix) — a faint, soft residual patch
  remains but it is diffuse, not concentric rings.

**Acceptance check against the coordinator's four items:**
1. Block seams — fixed (point 5); confirmed with a native-resolution crop, no rectangular edges at
   any of the three preview scales.
2. Ocean rings/bullseyes — fixed (points 8–9); the vessel bullseye and the large basin ring are
   both gone, checked at true `WORK=2048` build resolution (a `WORK=1024` proxy had been
   misleading during iteration — see point 8).
3. Whited-out flat — fixed (point 7); histogram check 7.2% of water pixels above half amplitude
   (target ≤35%), and channels now read as bright filaments against quieter water by eye, not a
   uniform wash.
4. Hard-zero "black holes" — not separately reproduced once the block-seam fix (point 5) and the
   mask retune (point 9) were in; nothing resembling a hard zero patch inside a bright area was
   found in the current renders. If Ryan still sees one, it was most likely a symptom of the same
   block-seam mechanism (a seam landing on a bright pixel reads as a dark notch) rather than a
   separate defect — flagged in case it resurfaces.

## Two-phase animation — exact spec for the shader agent

Unchanged from round 1; still accurate.

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
  test both. Either way keep the cycle SLOW; both A and B already look like plausible static water
  on their own, the crossfade just needs to nudge one into the other believably.
- **Direction and tide sign:** decode the angle channel as
  `dir = vec2(cos(angle), sin(angle))` where `angle = B_channel/255 * 2π`. **Do not** lerp/filter
  the raw angle value across texels near the 0/2π wrap — decode cos/sin per-sample instead (GPU
  bilinear filtering of the stored byte is fine; it wraps incorrectly only within one texel of the
  seam, invisible at any reasonable zoom). `dir` points **seaward** (toward decreasing drying
  height / increasing bathy proxy). On **ebb** (tide falling), advance the phase `p` so visible
  motion runs *with* `dir` (natural A→B). On **flood** (tide rising), run the phase backward
  (`mix(B, A, fract(p))`, or negate `dp/dt`) so the apparent motion is landward. Tie the sign to
  whatever the renderer already uses to distinguish flood/ebb (see `template-v2.html`'s `ebb` term
  in the shore-glow code for the existing convention).
- **Intensity/visibility:** `flow` (the mixed phase) is already contrast-normalised and
  mask-shaped 0..1 — treat it as a luminance/opacity multiplier for a tint colour, not as a
  standalone colour. Genuinely near-zero on land and near the floor value far offshore (now 0.02,
  tighter than round 1), so it should be safe to add/screen into the water colour without a
  separate mask in the shader.

## Summary for the orchestrator

Round 2 of `prototype/prep-flow.mjs`. Same channel spec as round 1 (R=LIC phase A, G=LIC phase B,
B=seaward flow angle, 4096×4096). Four defects fixed: (1) block seams — sharp's `.blur()` seamed
at the large sigmas this script needs; replaced with a hand-rolled seamless box-approximated
Gaussian used everywhere; (2) ocean rings/bullseyes — a real vessel misclassified as land upstream
needed both its height *and* its chamfer-distance shadow in the bathy proxy healed (erasing height
alone left a shadow that still rang), and the harder problem, LIC's ring artifact near critical
points of the combined gradient field, needed direct winding-number detection after two indirect
curvature-based approaches failed to match where the rings actually appeared; (3) whited-out flats —
added curvature-based channel-likeliness amplitude weighting so contrast concentrates in real
channels/creeks instead of stretching every flat to the same brightness, verified with a histogram
check (7.2% of water pixels above half amplitude, target ≤35%); (4) no separate hard-zero defect
reproduced once (1) and the ocean-gate retune were in.

All three judging previews (whole harbour, Mount Maunganui channel, northern-basin flats) were
regenerated at true build resolution (`WORK=2048`) after every constant change and inspected
directly — not assumed from a faster low-resolution proxy, which was itself a source of one dead
end during this round (see point 8 in Method).

**Follow-ups / risks worth a second look:**
- The soft residual patch remaining in the northern-basin crop (post winding-number fix) is diffuse,
  not ringed, but is a symptom of the same underlying critical point; if Ryan wants it fully gone
  rather than just softened, the next lever is widening `VORTEX_DISC_OUT` further (currently `5*L_OUT`).
- The vessel-islet erase/heal (points 1b/1c) is specific to this one scene's artifact; if a future
  `field-v2` rebuild uses a different Sentinel-2 scene, the islet detector will still run correctly
  (it is general, not coordinate-specific) but there may be zero or different blobs to catch.
- `flow.png` remains large (~7.6MB) since LIC/contrast-normalised noise compresses worse than
  `field-v2.png`'s smooth gradients; unchanged from round 1, still flagged for whoever integrates it.
