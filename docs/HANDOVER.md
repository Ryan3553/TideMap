# TideMap — handover, 2026-07-26

Read `CONCEPT.md` (same folder) first (what the piece is and why), then this (where it stands).

## What the thing is

An always-on iPad artwork of Tauranga Harbour, showing the real tide, real sun and real
moon. Land is a fixed satellite/aerial basemap; **every waterline is computed** from a
per-pixel drying-height raster plus a predicted tide.

## Layout

```
sources/     inputs only, never written by a script — see docs/SOURCES.md
pipeline/    drying-height raster derivation (204 Sentinel-2 scenes -> waterline stack)
tide/        offline harmonic tide model, zero deps, 8.9 kB
prototype/   renderer + build scripts   (prototype/data/ is derived, gitignored)
research/    feasibility studies, the 9-scene photo series, composition studies
```

Rebuild the published page: `cd prototype && node build-v2.mjs` → `tidemap-v2.html`.
Verify it locally: `node prototype/serve.mjs` then open `localhost:5179/tidemap-v2.html`.

## What is solid

- **Tide model** — 0.031 m height RMSE and 9.5 min timing error against a *held-out* year,
  spot-checked by hand against the LINZ table. Far more accuracy than an artwork needs.
- **Drying-height raster** — 204 scenes, tide 0.31–2.16 m, leave-one-out IoU 0.899;
  138.1 km² intertidal against ~145 km² in the literature. Validation in
  `docs/pipeline-validation.md`, including where it is weak and why.
- **Renderer** — WebGL, all colours on sliders, iOS device frames, manual/live tide and
  daylight, LINZ aerial or Sentinel basemap. Verified live by driving frames through the
  `window.__tick` hook (rAF is suspended in a hidden pane, so nothing self-reports there).

## Three known defects — diagnosed, not yet fixed

### 1. Urban land is classified as intertidal — this is the "holes" ★ worst
Measured on the drying-height raster:

| area | land | **intertidal** | water |
|---|---|---|---|
| Tauranga CBD | 35.7% | **45.0%** | 19.3% |
| Mount Maunganui township | 59.3% | **7.7%** | 33.0% |
| Pāpāmoa | 88.3% | 1.9% | 9.8% |

Nearly half the CBD is drawn as tidal flat that floods and drains. Cause: bright roofs and
concrete flicker across the NDWI threshold between scenes, so the step-fit finds a bogus
"transition". The harbour mask does not catch it because the CBD is genuinely inside the
harbour outline.

Fix candidates, cheapest first: reject intertidal pixels that coincide with the built-up
mask already computed in `prep-hires.mjs`; or threshold on `pipeline/out/misfit.png`
(scenes disagreeing with the fitted step should be high in exactly these pixels); or add a
spectral built-up test in the pipeline. Worth doing **in the pipeline**, not the renderer,
so every consumer benefits.

### 2. Land detail is being thrown away
`land = mix(landDark, landLight, smoothstep(0.03, 0.50, lum))` collapses the imagery to a
two-stop ramp on luminance. Ryan's reference (Google Earth) keeps land rich and varied;
ours goes flat olive. The 0.1 m aerial detail we now have is being discarded by the very
last step.

Fix: keep the real RGB and *grade* it — desaturate, darken, tint toward the palette — rather
than remapping to two colours. Two-stop ramps are fine for the flats, wrong for land.

### 3. Widest landscape frame overflows the map
Measured across all six devices in both orientations: **frame and canvas aspects are
correct to three decimals everywhere** — the geometry is not distorted. The one real defect
is iPhone 19.5:9 **landscape**, where the required map width
(`zoom × aspect × 1.0866 = 1.18`) exceeds the texture, producing a black band.

Fix: clamp `zoom ≤ 1/(aspect × 1.0866)` when the aspect changes.

I could not reproduce a general "all landscape ratios wrong" — worth Ryan pointing at a
specific frame with a screenshot, because my measurement says they are right and his eye
says otherwise, and one of us is wrong about which thing is being compared.

## Open, and Ryan's to call

- **Colour.** The sliders exist so this stops being my guess. Send back the JSON from
  *Copy settings* and it becomes the default.
- Whether the default framing is the city end, the northern basin, or a travelling frame.
- Below **0.33 m** the satellites never see: Sentinel-2's fixed overpass is phase-locked
  with the spring–neap cycle here, so spring low is never observed. Not fixable with more
  data; LINZ's coastal topo-bathy LiDAR (flown, due mid-2026) is the real answer.

## Suggested next session

1. Fix (1) in the pipeline and rebuild the field — biggest visual win, and it is a
   correctness bug, not taste.
2. Rework land rendering (2) to preserve texture.
3. Clamp zoom (3).
4. Then colour, with Ryan driving.

Do **not** start by re-running the 204-scene fit; the raster is fine apart from the urban
misclassification, and `pipeline/cache/` makes a re-run cheap anyway.
