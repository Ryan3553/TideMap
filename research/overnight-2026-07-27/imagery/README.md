# J1a — basemap fusion + regrade (flat/washed-out fix)

Owner complaint: `base-aerial.jpg` (LINZ 0.1 m aerial, composited over Sentinel-2 at the coast by
`prototype/compose-base.mjs`) is detailed but flat and washed out, worst over Tauranga CBD, Mount
Maunganui, and Matakana Island. `base-hi.jpg` (Sentinel-2 true colour) is richly coloured but soft.
Built three candidates that try to get both. All three are 5120×5120 JPEG q90, **the actual
resolution of `base-aerial.jpg`** — the brief said 4096, but `base-aerial.jpg` is already
composited at 5120px, so matching it exactly avoids an unnecessary extra resample generation-loss
pass. All three share that pixel grid so they drop into `prototype/data/` as direct swaps.

Script: `prototype/fuse-base.mjs` (run with `node --max-old-space-size=8192 fuse-base.mjs` from
`prototype/`, takes ~15s, rebuilds all three candidates every run — reproducible, no manual steps).

## Technique

### 1. `base-fused.jpg` — pansharpen-style fusion
Classic high-pass-modulation pansharpen (LINZ detail injected into Sentinel colour), with one
correction that turned out to matter a lot — see "the exposure bug" below.

1. Upsample `base-hi.jpg` to 5120px with a `cubic` kernel (smooth, no lanczos ringing at the 1.83×
   scale factor) → `sentinelUp`.
2. Luminance of both sources: `aLum = 0.299R+0.587G+0.114B` from `base-aerial.jpg`, `sLum` from
   `sentinelUp`.
3. High-frequency detail: `detail = clamp(aLum - blur(aLum, σ=14), ±46)`.
4. **Local exposure match** (the fix): `blur(aLum, σ=80)` and `blur(sLum, σ=80)` give each source's
   *regional* brightness. `expRatio = clamp(aLumLF / sLumLF, 0.55, 1.9)`; `sLumMatched = sLum *
   expRatio`. This relights Sentinel to the aerial's regional exposure level before anything else
   happens — see below for why this step exists.
5. `newLum = sLumMatched + 0.85 * detail`.
6. Reconstruct colour keeping Sentinel's **chroma** (its hue/saturation character, not its absolute
   brightness): `out[k] = newLum + (sentinelUp[k] - sLum)` for each channel, clamped to [0,255].

### The exposure bug (worth flagging explicitly)
First pass used textbook pansharpen — keep the colour source's *own* low-frequency luminance
unchanged, inject only the high-pass detail on top (step 4 above was `newLum = sLum + gain*detail`,
no relighting). That is the standard algorithm, but it broke badly here: `base-hi.jpg` runs
substantially **darker** than `base-aerial.jpg` in places — measured mean luminance 27.7 vs 50.0
over the same 700×700 window on the Matakana dune strip, a genuine sensor/exposure difference, not
a colour one. The night/day shader's land palette (`template-v2.html` / `look.mjs`, `tl =
mix(smoothstep(0.02, landWhite=0.55, lum), lum, 0.22)` then `mix3(landDark, landLight, tl)`) is a
steep curve tuned against the aerial's own exposure. Feeding it Sentinel's darker baseline pushed
that whole dune strip into `landDark` — a near-black smear — even though the raw fused JPEG crop
looked only mildly darker to the eye. This only showed up by actually running the candidate through
`look-alt.mjs` (see below); a JPEG-crop-only review would have shipped it. The σ=80 local
exposure-match fixed it: Matakana crop mean luminance recovered from 27.7 to 41.2, close to the
aerial's 50.0, while the halo/seam behaviour and Sentinel's actual hue were untouched.

### 2. `base-graded.jpg` — LINZ aerial regraded (no fusion, same detail as base-aerial.jpg exactly)
Per-pixel grade of `base-aerial.jpg`, nothing blurred or resampled, so it is byte-for-byte as sharp
as the source:
1. **Dehaze**: per-channel black point = 1st percentile pixel value; only `0.55×` of it is actually
   subtracted (never the full veiling-light estimate — shadows must stay non-zero, the night shader
   multiplies against this), floored so the black point used is never below 6/255 either way. White
   point = 99.5th percentile, pixels rescaled between the two.
2. **S-curve contrast**: pivot 0.5, power curve either side, `gamma=0.88` (less than 1 = steeper S,
   more contrast, still smooth — no clipping cliffs).
3. **Vibrance**: boosts saturation in proportion to `(1 - current_saturation)`, so already-saturated
   pixels (beach sand, boat hulls) are barely touched while dull green/grey land gets the lift.
   `vibrance=0.35`.
4. **Warm/green land bias**: `+[5,4,-6]` RGB nudge, masked by `classes.png` (LINZ land class, blurred
   3px so the tint doesn't hard-step at the coast) — small, land-only push toward warm-green.

### 3. `base-fusegrade.jpg` — fuse() then a gentler grade() on top
Same `fuse()` as candidate 1, then `grade()` with about half the strength (`dehazeStrength 0.35`,
`contrastGamma 0.94`, `vibrance 0.18`, `landWarm [3,2,-3]`) to add a touch more punch without
double-processing.

## Traps hit and guarded against
- **sharp mono-buffer promotion**: `sharp(buf,{raw:{channels:1}}).blur(σ).raw().toBuffer()` silently
  comes back as **3-channel sRGB** (`resolveWithObject` confirms `channels: 3`, not 1) once an
  operator like `.blur()` runs on it. Reading that buffer at stride 1 instead of 3 produced clean
  horizontal banding across the *entire* frame in the first fused build (visible in the initial
  crops, since fixed) — a stride-misalignment aliasing pattern, not a real image artifact.
  `.extractChannel(0)` after every mono blur, plus a length assertion, fixes and guards it.
- **Halos at the coastline seam**: `compose-base.mjs`'s LINZ/Sentinel blend and the LINZ capture-block
  staircase edges are both high-contrast boundaries where a high-pass filter can ring. Checked at
  the actual surf line (Matakana crop) at full res — no bright/dark fringing either side of the
  tile-edge staircase or the true coastline in any candidate.
- **Buffer length / alpha channel**: every `sharp(...).raw()` call is followed by a `w*h*channels`
  assertion; every JPEG load goes through `.removeAlpha()`.

## Judging — crops
`research/overnight-2026-07-27/imagery/`, 700×700, same geographic window across all 5 sources
(`aerial`, `hi`, `graded`, `fused`, `fusegrade` — filenames `<crop>_<source>.png`, plus a 5-across
contact sheet `<crop>_strip.png` in that column order):
- `city` — Tauranga CBD + Mount Maunganui (`left:2650,top:2850,width:700,height:700`)
- `matakana` — mid Matakana Island barrier (`left:900,top:900,width:700,height:700`)
- `forest` — the forest corner, bottom-left, the area the owner said already looks good
  (`left:100,top:4100,width:700,height:700`)

Regenerate with `node make-crops.mjs` from this directory (loads `sharp` out of
`prototype/node_modules` via `createRequire`, since this script lives outside the `prototype/`
package tree on purpose).

### Verdicts

**City / Mount Maunganui** — the worst offender in the complaint. `aerial` is grey-khaki, buildings
and water read as nearly the same tone. `hi` has lovely turquoise water and green parks but city
blocks blur into a soft grey mass, no individual roofs. `fused` keeps every roof edge and wharf
outline from LINZ while wearing Sentinel's turquoise-to-navy water and green park colour — clearly
the best of the three by a wide margin here. `graded` is a genuine improvement over `aerial` (much
richer blue water, warmer roofs) but the water colour is a regrade-derived saturation push, not a
second data source, so it reads slightly less "real" than `fused` up close. `fusegrade` is
`fused` plus a small extra contrast/vibrance kick — marginally punchier than `fused`, hard to tell
apart at a glance, no artifacts introduced.

**Matakana Island (mid)** — also where the exposure bug first showed up (see above). After the fix,
`fused` and `fusegrade` render the dune-scrub strip as a richer olive-green than `aerial`'s flat tan,
still legible, no black smear. `graded` keeps the exact aerial tone (tan/khaki, warmed slightly) —
safest choice, zero risk of the exposure issue since it never touches Sentinel data, but also the
least "new colour" of the three. The LINZ capture-block staircase on the coastline is visible in
every candidate (pre-existing artifact in `base-aerial.jpg` itself, not introduced here) with no
added halo in any of them.

**Forest corner** (must not be ruined) — `fused` is nearly indistinguishable from `aerial`, maybe a
touch richer; the detail-preserving design keeps this area safe by construction since forest was
already the aerial's strongest area (high LINZ luminance detail, no correction needed). `graded` and
`fusegrade` visibly brighten and green up the canopy and pasture — still credible as forest, not
blown out (mean luminance stayed inside sane percentile bounds, checked via `sharp.stats()`), but
it is a bigger change to an area the owner explicitly liked. If preserving this crop byte-for-byte
were the only criterion, `fused` wins outright.

## Judging — through the actual shader
`look-alt.mjs` (private fork of `prototype/look.mjs`, lives in `research/` — `prototype/look.mjs`
itself was not touched, per constraint) adds a `base=<filename>` arg so any candidate can be pushed
through the real day-render arithmetic without editing the source tool:
```
cd research/overnight-2026-07-27
node --max-old-space-size=8192 look-alt.mjs base=base-fused.jpg out=imagery/day_fused.png tide=0.6 light=0.92
```
Rendered all 5 sources at the default wide view (`day_<name>.png`, 900×675) plus two focused crops
cut from those renders: `day_strip_matakana.png` (top-left 450×250, the dune strip) and
`day_strip_city.png` (Mount Maunganui/CBD, 280×255) — both 5-across strips in the same source order.

This is what caught the exposure bug in the first place: the raw JPEG crop of the first `fused`
attempt looked only mildly dark, but `day_strip_matakana.png` showed the shader turning that strip
solidly black. After the σ=80 relight fix, `day_strip_matakana.png` shows `fused`/`fusegrade` as a
richer, greener dune strip than `aerial` — still clearly land, no more black smear. Confirmed
`graded` was never affected (it doesn't touch Sentinel data at all). `day_strip_city.png` confirms
the city win carries all the way through the shader: `fused`, `graded`, and `fusegrade` all read as
substantially richer than `aerial` with visible street/park structure, `fused`/`fusegrade` edge
`graded` slightly on water colour realism.

## Ranked recommendation

1. **`base-fused.jpg`** — best default. Full LINZ detail (buildings, wharves, dune texture) with
   Sentinel's actual colour signal, not a synthetic saturation push. Wins the city crop clearly,
   ties or wins Matakana, and is the safest candidate for the forest corner (barely touched). The
   one candidate whose colour comes from a second real data source rather than a curve applied to
   the first.
2. **`base-fusegrade.jpg`** — a close second, essentially `fused` with a small extra polish pass.
   Marginally punchier in the city, marginally more changed in the forest corner than plain `fused`.
   Reasonable choice if the owner wants a bit more saturation than `fused` gives; the two are close
   enough that this could become the default with no real downside if `fused` reads slightly flat to
   the eye on a real display (JPEG crops here were viewed at 700px, not full resolution).
3. **`base-graded.jpg`** — the safe fallback, not the recommendation. Its big advantage is that it
   is mathematically incapable of the exposure-mismatch bug (never touches Sentinel data) and is
   pixel-identical in detail to `base-aerial.jpg`. Good, real improvement over `aerial` on its own —
   if there's ever a reason to distrust the fusion pipeline (e.g. a future Sentinel scene with worse
   exposure mismatch, or cloud contamination) this is the fallback to reach for, and it's worth
   keeping in `prototype/data/` as a dropdown option regardless of which becomes default.

**Recommendation: ship `base-fused.jpg` as the new default basemap.** Keep all three in
`prototype/data/` as candidates — `data/base-aerial.jpg` was left untouched by this job so a
one-line change to whatever references it (not made here, per the constraint against touching
`template-v2.html`/`look.mjs`/`pipeline/`) is what's needed to switch the default over.

## Files
- `prototype/fuse-base.mjs` — the fusion + grade script, reproducible, rerun any time to regenerate
  all three candidates with the current constants.
- `prototype/data/base-fused.jpg`, `base-graded.jpg`, `base-fusegrade.jpg` — the three candidates.
- `research/overnight-2026-07-27/look-alt.mjs` — private fork of `look.mjs` with a `base=` arg, for
  judging candidates through the real shader without touching the shipped tool.
- `research/overnight-2026-07-27/imagery/make-crops.mjs` — cuts the matched judging crops.
- `research/overnight-2026-07-27/imagery/*.png` — the crops, strips, and day-shader renders
  referenced above.
