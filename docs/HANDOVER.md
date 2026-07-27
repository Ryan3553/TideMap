# TideMap — handover, 2026-07-28 (eighth pass: depth-honest day water)

Ryan flagged two defects in the seventh pass by screenshot: sharp colour bands between
depths, and a cyan line drawn around low-tide pools. Both were one root defect: **the day
depth formula still contained the clamped-tide-term trap the night glow was cured of a
round earlier** — `max(clamp((uTide-H)/depthCurve),(sea*bathy))` clamps to 1 across the
sentinel-climb band, painting every permanent pool full-deep with a hard edge; the
luminous shore stop + day shore-glow + wet-edge sheen then rimmed those false-black pools
in electric aqua. Fix (template + look.mjs, verified live):

- **Final form (after Ryan's follow-up "some soft areas, some hard"): day water is on ONE
  physical scale — metres of water.** A first cut blended the tide term with the 0..1
  bathy code directly, but those two normalizations disagree by a large constant, so the
  seam was soft on gentle slopes and hard on steep ones. Now the fitted side gives
  uTide-H metres and the sentinel side inverts the G-channel encode to real metres
  (b<0.5 → 15*(2b)^(1/0.6); above, the 15..40 smoothstep segment inverted with the
  cubic-root trig identity) plus tide stage over MSL (1.107 m CD) — the two MEET at the
  seam by construction. Colour stops are metres (shore→1 m→3.5 m→10 m; open-ocean navy
  8-25 m); the Depth-falloff slider scales dm so it keeps its meaning; clarity/caustic/
  gold gates run on depth01 = 1-exp(-dm/5). bathySmooth feeds the inversion, ironing the
  chart-contour terracing in the harbour deep.
- Ramp overlaps widened (chained smoothsteps plateaued at each stop = banding); shore stop
  de-electrified (it clipped G pre-tonemap); day shore-glow cut to 0.04; wet-edge calmed.
- The channel vein boost fades out past ~8 m (gate on dm), so it cannot lighten the
  dredged reach — down there uDeep by ramp IS the vein. Night formulas untouched.
- The `sea` sentinel-proximity gate is GONE from the day path (channel gate rides the same
  H-blend). If you reintroduce a `sea`-gated day term, you are re-adding the bug class.
- **Night joined the metres scale the same day** (Ryan: "still some weird stuff at night"
  — dark blobs inside pale glow; the night nd was still the clamped-tide-term x cubed-bathy
  blend). Now `nd = 0.18*(1-exp(-dm/1.5)) + 0.82*smoothstep(10,38,dm)`: a thin dimming
  skin over the first metre, luminous through channel depths, abyss only in genuinely deep
  ocean. Continuous in dm, cannot blob. The cubed-ndBathy formulation is fully retired —
  do not resurrect it from old commits; it and the day max() were the same disease.

---

# Earlier: seventh pass, 2026-07-27 night (Ryan's visual-hierarchy brief)

Ryan sent a written brief ("still too flat and boring") with explicit colour/behaviour
direction. This pass implements it end to end; the artifact is republished at the same URL
and the iPad bundle is rebuilt. What changed, and the reasoning that must not be re-litigated:

- **The surf placement complaint decoded**: the old swell window sat at bathy 0.50-0.88 =
  **15-35 m of real depth** — surf out by Karewa — because depth alone cannot separate the
  beach shoaling band from the harbour channels (both live at the same depths). The fix is a
  **baked open-coast mask in relief.png's B channel** (`bake-oceanmask.mjs`: seal-radius-20
  land dilation to close both entrance throats, edge-seeded flood fill, 24-step grow-back,
  sigma-2.5 feather). Surf now lives at bathy 0.03-0.40 (~0.5-9 m) × that mask, crest
  frequencies retuned (110/175/68 vs bathy), white foam by day, luminous by night.
  **relief.png is generated and gitignored — after any fetch-relief.mjs re-run you MUST
  re-run bake-oceanmask.mjs or the ocean goes flat and surf vanishes** (the shader reads
  reliefS.b everywhere: ocean-calm, channel gate, swell).
- **Day water is a continuous 4-stop ramp** (wShore luminous aqua → shallow → mid → deep),
  plus, gated to the open coast, a darker navy (wDeepO) — the Pacific reads as negative
  space (clarity ×0.15 there). Channels get a vein boost `chan` (harbour × bathy 0.20-0.72
  window) and a gaussian brightness lift at the entrance (MOUTH uv 0.563,0.592).
- **Exposed flats are graded to stone/gold/taupe** on the aerial's own luminance (sand ramp
  + 0.28·rel chroma + grain whisper), slider **Ground → Flats sand tone** (`flatsWarm`,
  default 0.90). Wet-edge sky reflection appears ONLY on the rising tide (uTideDir gate);
  the ebb keeps the damp band. Day waterline is a neutral sunTint sheen with noise-feathered
  gain — the cyan edging survives only into night.
- **Breathing**: caustic product-noise in genuinely shallow water (day), broad slow ocean
  luminance drift, dawn/dusk haze veil (uHaze window, peaks sunAlt 0-5°), golden-hour
  amber sky-mirror LERP on water (uGold window ~2-10°, shimmer-swept, faded over deep
  water so the channels stay blue — a warm MULTIPLY was tried first and cannot beat the
  water's green dominance; the lerp is the one that reads).
- **Night blockiness root-caused** (agent-diagnosed, evidence in data/review/nightflats/):
  LINZ capture-block tone steps in the aerial ride through raw `lum` into night pearl and
  nightWater brightness — compose-base's flattening pass is LAND-ONLY by design. Shader-side
  fix shipped: `lumSoft` (4-tap ±0.0023 uv average, 35% raw mixed back) feeds those two
  terms only; day path untouched. **Root fix queued in NEXT-SESSION: extend
  compose-base.mjs tone-flatten to intertidal classes and rebuild the basemaps.**
- **Defaults retuned to the brief** (Harbour water preset): shallow #8fd6ca, mid #2c8ca2,
  deep #0d4066, surfGain 0.16; judged from a 9-variant × 3-state sweep
  (data/review/sweep/, `sweep.mjs`). Night palette untouched — night formulas read none of
  shallow/mid/deep/clarity/flatsWarm (verified in the sweep: zero night pixel diff).
- **Tools**: `review.mjs` renders labeled contact sheets (states / crops) through look.mjs —
  use it before claiming anything about the look. look.mjs was found DRIFTED at session
  start (old ping-pong flow, old swell window) and re-synced; a formula-by-formula parity
  audit then found two more slips (bathySmooth round-vs-floor; dither y-flip) — both fixed.
  When you touch the shader, change look.mjs in the same commit or it lies.
- Page 21.92 MB (budget 22); artifact build 14.7 MB (cap 16); iPad bundle rebuilt.

---

# Earlier: sixth pass, 2026-07-27 evening (the artery flow)

The channel flow is no longer LIC braid — it is **artery streamlines on real bathymetry**,
per Ryan's markup (`research/overnight-2026-07-27/flow/Ryan-markup.png`): one continuous
spine per channel, mouth artery branching into the arms, thalweg bright, flats and open
ocean near-zero. What changed:

- **Real depth**: `prototype/build-depth-composite.py` merges 2 m coastal LiDAR (nz-coastal
  open S3 bucket, keyless, same HS79 campaign window), chart depth contours 50672 +
  soundings 50858 (WFS), and the NIWA 25 m DTM — datums reconciled to local MSL via the
  repo's own tide tables (MTL 1.107 m above CD). field-v3's G channel now comes from it.
- **The 2 m multibeam (LDS 122679) is still the endgame** and is blocked ONLY on the LDS
  key lacking the Exports scope — one checkbox on data.linz.govt.nz fixes it (see
  NEXT-SESSION.md). It slots in as priority 0 of the composite; nothing downstream changes.
- **`prototype/prep-flow.mjs` is a rewrite** (streamlines, not per-pixel LIC) but the
  flow.png CONTRACT is unchanged (R=A, G=B slid seaward, B=angle) — template-v2.html and
  look.mjs shader maths untouched. Default `flowGain` 0.45 → 0.85 (texture is sparse now;
  at 0.45 the arteries were a ~10 % modulation, invisible).
- Traps paid for in this rebuild, recorded in prep-flow.mjs comments: the ridge test needs
  THREE scales (a dredged channel's floor is flat — fine scale sees no ridge); harbour
  membership = proximity to size-filtered flats (harbour-mask.png is the intertidal FIT
  mask and excludes Town Reach; an island's beach ring fakes flats without the size
  filter); center-vs-saddle winding must be computed mod pi and only centers damped —
  damping saddles kills the mouth confluence, the strongest artery of all.

Same-day follow-ups, also in this pass: **the panel no longer scrolls the piece away**
(two-column sticky layout wide, sticky-shrink `.tune` narrow — see NEXT-SESSION), and
**land answers the raking light**: `fetch-relief.mjs` + a fourth texture (`uRelief`,
gradient map from the Basemaps elevation terrain-rgb) drive a gentle azimuth-aware
hillshade windowed to low sun. `sunPos` now returns real azimuth (verified: winter noon
due north). Sliders: *Land relief* (0.4), *Channel flow* (0.85). Page 21.87 MB — only
~130 kB of budget headroom left; the next texture must earn its bytes.

---

# Earlier: fifth pass, 2026-07-27 (the overnight beauty round)

**Read `docs/REPORT-2026-07-27.md` first** — it is the authoritative record of the
overnight round: real NIWA bathymetry in the G channel, OSM×VIIRS city lights, 16-bit
height (field-v3.png, R hi / A lo, NEAREST + manual bilinear — hardware LINEAR on split
bytes is wrong), the LIC flow texture (flow.png, third texture, ping-pong animation),
multi-frequency swell, fused default basemap, and the two rim bugs (sentinel-band bogus
tide-depth; pearl ∝ aerial-luminance) with their fixes. `docs/ROADMAP.md` has the job list
it executed. The LINZ-key shopping list (2 m multibeam, layer 122679) is in the report.

Everything below this line predates that round but the traps and rulings still stand.

---

# Earlier: fourth pass, 2026-07-26

## The night glow — Ryan's "make it spectacular" round

Ryan sent a reference image — the piece at dusk, bioluminescent: dark navy open ocean, a
luminous surf band along the beach, channels glowing cyan through pearlescent flats, warm
city lights. The night/dusk path of the shader was rebuilt to match, over four render-judged
iterations. What it took:

- **Night emission is a monotonic decay of a night depth `nd`.** The day `depth` cannot drive
  night glow: on always-wet sentinel water its tide-height term clamps to 1, which painted every
  permanent channel and the near-beach ocean abyss-black. `nd` blends tide-height depth over the
  intertidal with **bathy (distance from shore) over sentinel water** (`mix(..., bathy, sea)`),
  so channels sit mid-ramp and glow, the surf zone glows and fades offshore, and only true open
  ocean reaches the `abyss` colour. Falloff on the **Glow falloff** slider (`nightFall`, 4.2).
- **Never build a night-glow band out of bathy directly.** Two failed attempts are on record: a
  bathy-bell "channel highway" (dark gap between beach and glow) and a bathy-gaussian shore glow
  (the chamfer field's isolines facet into an **octagon** around the offshore island). The shore
  glow lives in tide-height space instead: `exp(-((tide-H)/glowM)^2)`, **Shore glow reach (m)**.
- **Pearlescent flats**: exposed intertidal is lit by the aerial's own luminance and chroma
  (`pearl ∝ lum`), so the real swirl detail shows and dark channels stay dark — a replacement
  blend, never a max-lift (a max-lift turned the whole harbour porcelain-white; also on record).
- **Offshore swell lines** (subtle, gated): 4-tap-softened bathy cosine, windowed to open ocean,
  with a world-space curvature gate so they exist only along the long straight beach — not the
  ringed island contours Ryan already rejected. **Offshore swell** slider, whisper by default.
- Also: two-part city lights (warm halo + near-white hot core), 2-octave animated water shimmer,
  filmic tonemap (`1-exp(-col·exposure)`), and slightly lifted night land.

New settings: `shoreGlow, surfGain, flatsGlow, shimmer, glowM, nightFall` (structural, in
`DEFAULTS`) and `abyss, pearlCol` (colours, per-preset). All on sliders; *Copy settings* still
round-trips everything, so the palette remains Ryan's to finish.

**A trap paid for in this round:** a backtick in a GLSL comment inside the `FS` template
literal ends the string early and the whole module dies with a silent SyntaxError — `look.mjs`
can never catch it (it doesn't contain the literal) and neither could `build-v2.mjs`'s size
check. `build-v2.mjs` now **parses the assembled module source** (AsyncFunction constructor)
and refuses to build if it doesn't parse. Do not write backticks inside the shader string.

---

# Earlier: the third pass

## The look, after Ryan's review

Ryan's note was: make it beautiful, make it detailed, show the real landscape by day, drive it
with sliders not an animation, and stop the shoreline glowing brighter than the water. All five
are done, and two of them changed the architecture rather than a setting.

**The waterline is no longer a class boundary.** The field texture used to carry a *class*
channel — water / intertidal / land — which the shader thresholded. A class raster has no
meaning between samples, so it had to be read with `NEAREST`, and every coastline came out as
15 m staircases. That was the pixelation. `prep-field.mjs` now bakes **one continuous surface**:
drying height, with always-wet water pushed below the tide range (−0.75 m) and always-dry land
above it (+3.25 m). Nothing is a category, so it filters, resamples and blurs like an elevation
model, and the waterline is an iso-contour the shader antialiases per screen pixel with
`fwidth`. A 3×3 median kills the step fit's isolated outliers before smoothing.

**Daylight shows the imagery.** The old shader pushed land through a two-colour palette ramp
whose endpoints are both very dark olive, so a 0.1 m aerial arrived on screen as flat sludge —
that is why "all the details are missing". Land is now the real RGB, lightly graded
(`realism` 0.85, `groundSat` 1.18), with the stylised palette kept for night and crossfaded by
`uRealism`. Buildings, streets, the port and the airport runway all read at zoom.

**More of the detail that was already on disk.** The archived LINZ z14 mosaic is 5376×5888 over
this bbox; it was being reprojected to 4096, throwing away a quarter of it. `reproject-linz.mjs`
redoes that from the archive at **5120 px (7.58 m/px)** with no network and no API key —
7.58 m/px is the z14 ceiling, and past 5120 there is nothing left to recover. Getting real
buildings would need z15/z16 and a `LINZ_KEY`, which this session did not have.

**The aerial's capture blocks are evened out.** The LINZ mosaic is flown on different days, so
land showed rectangular tone steps like a patchwork quilt. `compose-base.mjs` now divides each
land pixel by a land-only blurred reference and re-applies the mean — low-frequency tone
differences go, local detail stays. Land-only, because including the dark ocean in the blur puts
a bright halo along every coastline.

**Sliders drive by default.** The `-1 = live` sentinel is gone: `S.tide` and `S.light` are always
real values, and **Play the day** animates them from the clock so you watch the sliders move.
Touching either slider pauses. `Set to now` resets the virtual clock.

**The waterline sheen is measured in metres, not screen pixels.** It was
`1 - smoothstep(0, fwidth*2.2, |h - tide|)` at gain 0.38 — a hard white wire brighter than the
water, exactly as reported. It is now a gaussian in *tide height* (`edgeWidth` 0.035 m) at gain
**0.10**: a wide gentle band on a flat, nothing at all on a steep shore.

**Night is inverted the right way round.** Deep water is now the brightest, richest thing in the
frame — `nightDeep` is a rich blue, emission scales with the depth proxy, and the land goes
quiet under the moon with the town lights on it. The old deep colours were near-black, so the
channels read as holes; every preset's `deep` has been lifted off black.

### What is honest about the new depth

The G channel is a **depth proxy**: chamfer distance from the water's edge, saturating at
~3.4 km. Sentinel-2 cannot see under water at all (validation §4.3), so this is a *shape*, not a
measurement, and it is labelled as such in `prep-field.mjs`, in `field-v2.json` and here. It
exists so the channels read as channels and so night glow has something to follow. Do not let it
be quoted as bathymetry. LINZ topo-bathy LiDAR (due mid-2026) is the real answer.

## It is now an installable iPad app

`prototype/build-ipad.mjs` packages `prototype/ipad/` as a home-screen web app: manifest, icons
cut from the harbour entrance, and a cache-first service worker. **There is no second renderer** —
`ipad/index.html` *is* `tidemap-v2.html`, and the page detects it was launched standalone and
switches itself to kiosk: chrome hidden, canvas filling the slab at the screen's own aspect,
real-time playback, screen wake lock, and a dim `Controls` button to bring the studio panel back
on the device. Full instructions and the honest limits are in **[IPAD.md](IPAD.md)**.

Native iOS would be a `WKWebView` around the same file and **cannot be built on Windows** — Xcode
needs a Mac, and every cross-platform route still needs macOS to produce the build. The one thing
it genuinely buys is streamed imagery, which is the largest remaining visual gap.

**Copy settings no longer fails.** `navigator.clipboard` is unavailable in a cross-origin iframe
without `allow="clipboard-write"` — which is exactly where the published page runs. It now tries
the async API, falls back to `execCommand`, and if both are refused puts the JSON on screen
selected. Copying settings out is the whole point of the sliders; it must not be able to fail.

## Suggested next session (supersedes the list below)

1. **Colour, with Ryan driving.** Everything else is now in place for it. He sends back the JSON
   from *Copy settings* and it becomes the default. The land palette is still the original dark
   olive — the grading work made land *legible*, not *pretty*, and the palette is where that
   happens.
2. Default framing — city end, northern basin, or a travelling frame.
3. If `WET_MIN = 0.20` proves to have cut real flats, tune it; the sweep is in
   `pipeline-validation.md` §7 and the raw fit is intact in `fit.bin`.

---

# Earlier: the second pass

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
prototype/   renderer + build scripts   (data/ and ipad/ are generated, gitignored)
research/    feasibility studies, the 9-scene photo series, composition studies
```

Rebuild the published page, in order:

```bash
cd prototype && node --max-old-space-size=8192 reproject-linz.mjs data/base-linz.jpg 5120 && node --max-old-space-size=8192 compose-base.mjs 5120 && node --max-old-space-size=8192 prep-field.mjs 4096 && node build-v2.mjs
```

Verify it locally: `node prototype/serve.mjs` then open `localhost:5179/tidemap-v2.html`.
To *see* it without a browser, use `prototype/look.mjs` — see `NEXT-SESSION.md`.

## What is solid

- **Tide model** — 0.031 m height RMSE and 9.5 min timing error against a *held-out* year,
  spot-checked by hand against the LINZ table. Far more accuracy than an artwork needs.
- **Drying-height raster** — 204 scenes, tide 0.31–2.16 m, leave-one-out IoU 0.899.
  **133.3 km² of harbour intertidal** after the stage-9 clean below (138.1 before it).
  Validation in `docs/pipeline-validation.md`, including where it is weak and why.
- **Renderer** — WebGL, all colours on sliders, iOS device frames, manual/live tide and
  daylight, LINZ aerial or Sentinel basemap. Verified live by driving frames through the
  `window.__tick` hook (rAF is suspended in a hidden pane, so nothing self-reports there).

## The three defects from the first handover — all three fixed

### 1. Urban land classified as intertidal — fixed in the pipeline, `9-clean.mjs`

**The first handover overstated this one, and the correction matters.** It reported "45% of
the Tauranga CBD is drawn as tidal flat". A box over the CBD does measure ~40% intertidal —
but that box contains most of the Waikareao and Waimapu estuaries, and those pixels are real
flats: their submerged-state NDWI is +0.62, against +0.64 over the Matakana banks. The
affected area is far smaller than "half the CBD". What was real was **speckle** — individual
bright or dark roofs — and it was genuinely ugly on screen.

The worst of it also turned out not to be in the pipeline. `prep-hires.mjs` guessed
water-vs-land from luminance for anything its despeckling filter rejected, which turned dark
bluish roofs into **permanent blue holes punched through Mount Maunganui, the CBD and the
port**, following the street grid. That was the "holes".

Fixed with two data-derived tests in `pipeline/9-clean.mjs`, and by deleting the luminance
guess from `prep-hires.mjs`:

1. **Sea-connected.** Real harbour water is one connected body reaching the open sea; a roof
   is not. Keep only the water component containing the ocean seed. This also removes the
   inland flooded paddocks that §6 of the validation had to exclude with a mask.
2. **The wet state must look like water.** Average NDWI over exactly the scenes the fit says
   a pixel is submerged. Harbour flats median +0.583. Urban pixels hover at zero — they only
   grazed the global threshold. Cut at **+0.20**, just above the 2nd percentile.

Cost: **4.8 km² of harbour intertidal, 3.5%**, stated rather than hidden. Some of that is
certainly real flat at the margins. `WET_MIN` is one environment variable and the raw fit is
still in `out/fit.bin`; `out/cleaned-away.png` shows exactly which pixels changed.

**Trap:** `9-clean.mjs` rewrites `classes.png` and `drying-height.png` in place. Re-running
`4-fit.mjs` reverts it — run stage 9 after it. Same pattern as `8-harbour-mask.mjs`.

### 2. Land detail thrown away — fixed in the shader

The old `land = mix(landDark, landLight, smoothstep(0.03, 0.50, lum))` did two things wrong:
everything above luminance 0.50 clipped to one colour (so the whole town went flat), and
chroma was discarded entirely (so forest, paddock and bare earth all came out the same olive).

Now the imagery is **graded**: a tone curve that never saturates, with the source's own colour
put back on top of it relative to its luminance so it survives in shadow as well as highlight.
Two new sliders under Ground: **Land colour kept** (0.60) and **Land white point** (0.55).

Measured over a land-only crop at midday: **17 → 66 distinct colours** (5-bit quantised),
mean saturation 0.48 → 0.59. On the city crop the port's red containers, industrial roofs and
green reserves are all distinguishable where the old shader gave one olive block.

### 3. Widest landscape frame overflows the map — fixed

`zoomCap() = 0.995 / (aspect × 1.0866)`, applied on device change, on the slider, on scroll,
and defensively each frame. 0.995 rather than 1.0 because the slider quantises to 0.005 and an
exact cap rounds back up by one step.

Verified across all 12 device × orientation combinations: max required map width **0.9894**,
zero black pixels at eight sampled canvas edge points per frame.

The measurement from the first handover still stands: frame and canvas aspects are correct to
three decimals everywhere, so **if Ryan still sees a landscape framing problem it is not this
bug** — ask for a screenshot before changing anything.

## Open, and Ryan's to call

- **Colour.** The sliders exist so this stops being my guess. Send back the JSON from
  *Copy settings* and it becomes the default. The land palette in particular is still the
  original dark olive; the grading change made land *legible*, it did not make it *pretty*,
  and the palette is where that happens.
- Whether the default framing is the city end, the northern basin, or a travelling frame.
- Below **0.33 m** the satellites never see: Sentinel-2's fixed overpass is phase-locked
  with the spring–neap cycle here, so spring low is never observed. Not fixable with more
  data; LINZ's coastal topo-bathy LiDAR (flown, due mid-2026) is the real answer.

## Suggested next session

1. Colour, with Ryan driving.
2. If `WET_MIN = 0.20` proves to have cut real flats, tune it — the sweep is in
   `docs/pipeline-validation.md` §7 and the raw fit is intact.
3. Default framing.

Do **not** start by re-running the 204-scene fit; the raster is sound, and `pipeline/cache/`
makes a re-run cheap anyway if you must.
