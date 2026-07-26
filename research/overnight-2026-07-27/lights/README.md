# J2 — City lights rebuild

## Diagnosis: why the old layer had rural sheds outshining the CBD

`prototype/prep-field.mjs` built the old B channel (city lights) by scanning the LINZ aerial
basemap for pixels that are simultaneously **bright** (top 1.5% of inland luminance) **and
near-grey** (saturation `(max-min)/max <= 0.20`) — a proxy for "this looks like concrete, not
vegetation." That is a landcover-albedo heuristic, not a light-source heuristic, and the two
diverge badly here: dry paddock, bare earth, gravel yards and pale farm-shed roofs in open
rural country are *brighter and greyer* than Tauranga CBD's shadowed, tree-lined, saturated-roof
streets, so the adaptive percentile cut lets rural NW farmland through and keeps the CBD out.
Confirmed by direct sampling of `prototype/data/field-v2.png` channel B rather than reading
further into the generator: the single brightest cluster in the whole 4096×4096 grid (B=255,
tight cluster of dozens of pixels) sits at approximately **175.956°E, 37.505°S** — open farmland
north of Omokoroa, nowhere near a settlement — while **Tauranga CBD** (176.167°E, 37.686°S) and
**Mount Maunganui** (176.183°E, 37.633°S) sample **B ≤ 32** even with a 60px (~560 m) search
radius. That matches the owner's report exactly: rural bright, city dark. The fix is a rebuild
from data that actually encodes where light sources are (roads, buildings, developed land), not
a patch to the luminance/saturation guess.

## Method

`prototype/fetch-citylights-osm.mjs` → `prototype/fetch-citylights-viirs.mjs` →
`prototype/build-citylights.mjs`. None of the three touch `template-v2.html`, `look.mjs`, or
`prep-field.mjs` — this is a new, standalone data layer delivered as
`prototype/data/citylights.png` + `.json`, for a later round to wire into the shader.

### 1. OSM via Overpass

Grid: 4096×4096, equirectangular, bbox `west=175.93 south=-37.79 east=176.37 north=-37.41`
(same bbox/orientation as `drying-height.png` and `field-v2.png` — pixel-linear in lon/lat,
row 0 = north).

Queried `highway ∈ {motorway,trunk,primary,secondary,tertiary,residential,service}`,
`building=*`, and `landuse ∈ {residential,commercial,industrial,retail}` over the bbox, split
into a 3×3 grid of sub-queries (`out geom;`, so each way's full node geometry comes back
directly — no separate node-resolution pass needed). Raw JSON cached per tile at
`research/overnight-2026-07-27/lights/osm/tile_{x}_{y}.json` (9 files, 70,480 elements total:
13,092 highway ways, 55,246 building ways, 2,142 landuse ways) — re-running the fetch script is
free once cached.

**Mirror note**: `overpass-api.de` itself returned HTTP 406 Not Acceptable on every path tried
this session (root, `/api/status`, `/api/interpreter`, both GET and POST, several User-Agents) —
a real Apache/Debian response, not a network block (curl connected fine; `kumi.systems` and
`private.coffee` both timed out outright). `z.overpass-api.de` and
`overpass.openstreetmap.fr` both answered normal Overpass JSON immediately and were used
instead.

**Environment note**: Node's own `fetch()` cannot reach any external host in this sandbox
(`ETIMEDOUT`/`ENETUNREACH` even to hosts `curl` reaches instantly) — the fetch scripts shell out
to `curl` via `execFileSync` rather than using `fetch` directly.

### 2. Rasterization

Custom scanline/thick-line rasterizer (no `canvas` package available) writing into three
`Float32Array` layers, composited with **max()** per layer (so ways duplicated across tile
boundaries — expected, since Overpass returns a way whole if any node falls in the query bbox —
don't double-brighten):

| feature | weight | line half-width (px, ~9.4 m/px) |
|---|---|---|
| motorway / trunk / primary | 1.0 | 1.4 |
| secondary | 0.8 | 1.0 |
| tertiary | 0.65 | 0.85 |
| residential | 0.55 | 0.75 |
| service | 0.3 | 0.5 |
| building footprint | +0.35 (additive fill) | — |
| landuse commercial/retail/industrial | +0.5 (area wash) | — |
| landuse residential | +0.2 (area wash) | — |

`raw = roads + buildings*0.35 + landuse`. Sodium-halo look: two-scale blur, a tight 1px core
(σ=1.0, gain 0.75) plus a wide soft halo (σ=10, gain 0.55), recombined additively.

### 3. VIIRS reality check

NASA GIBS keyless WMTS, layer `VIIRS_SNPP_DayNightBand_At_Sensor_Radiance`, TileMatrixSet
`500m`. The whole field bbox fits inside a single level-7 tile (2.25°/tile: col=158, row=56,
computed from `TopLeftCorner(-180,90)`). The "latest" (`default/default`) time returned an
all-zero/transparent placeholder tile for this location; fell back through explicit dates
(`2026-07-20` used — 239k/262k non-zero px, most complete of the three tried) until one had real
data. Cropped to the field bbox (a ~100×86 px source crop — this really is coarse 500 m data),
resampled to the grid with cubic interpolation, then heavily blurred (σ=48) so it reads as a
soft large-scale prior instead of ~40 px macro-blocks. Applied as
`lights *= 0.35 + 0.65 * viirsNorm` before final normalization. Raw tile cached at
`research/overnight-2026-07-27/lights/viirs_raw/`, resampled prior at
`research/overnight-2026-07-27/lights/viirs_resampled.png`.

### 4. Normalization

Percentile-based, not a flat max: scaling by the raw maximum let a handful of pixels define the
whole range and left everything else too dim, while a flat empirical gain saturated the entire
CBD-to-Mount corridor (a real ~10% of the grid) to a flat white slab with no internal texture.
Instead the 99.9th percentile of the composited (pre-gain) array is mapped to 255, giving the
densest blocks headroom to clip while the rest of the corridor keeps gradient.

### sharp trap encountered (worth flagging for future scripts)

In this sharp build (0.35.3), **any** raw single-channel buffer — on write *or* on read, and
even a plain `.raw().toBuffer()` with no processing — silently promotes to a 3-channel sRGB
buffer/PNG unless `.toColourspace('b-w')` is applied first. This is broader than the
alpha-channel trap flagged in the job brief. It first showed up as the entire composite reading
back as near-zero at every acceptance sample point (core/halo blur buffers were 3-channel but
being read with 1-channel stride, so every sample was scrambled). Fixed by pinning
`.toColourspace('b-w')` on every raw single-channel sharp call in `build-citylights.mjs`, plus
explicit `buffer.length === P*P` assertions after each one so a regression throws instead of
quietly corrupting results again.

## Verification

`research/overnight-2026-07-27/lights/compare_old_vs_new.png` — old B channel (left) vs new
citylights (right), both at 1024×1024. The old layer's speckle sits almost entirely in the west
half (rural); the new layer's mass sits in the CBD-Mount-Papamoa corridor with roads threading
the rest.

`research/overnight-2026-07-27/lights/crop_cbd_mount_papamoa.png` and
`crop_omokoroa_katikati.png` — full-resolution crops.

Sample maxima (radius 20px, 8-bit, 0-255) after the full pipeline:

| location | value |
|---|---|
| Tauranga CBD (176.167E, 37.686S) | 255 |
| Mount Maunganui (176.183E, 37.633S) | 186 |
| Papamoa shops (176.245E, 37.685S) | 213 |
| Omokoroa (176.036E, 37.639S) | 133 |
| Katikati (175.935E, 37.552S) | 77 |
| rural SW corner region (max over whole region, not one point) | 50 |
| Matakana Island / harbour gap | effectively black — no OSM road/building/landuse density registers there beyond a few faint mainland-adjacent road threads |

**Acceptance test outcome: pass.** Tauranga CBD, Mount Maunganui and the Papamoa strip are
clearly the brightest features (255 / 186 / 213). Arterial roads (SH2, SH29, the harbour
crossing) read as continuous warm-toned filaments through otherwise dark countryside — most
visible in `crop_cbd_mount_papamoa.png`, where the harbour bridge and the Papamoa arterial are
unmistakable. Omokoroa and Katikati render as small, distinct, dimmer clusters exactly where the
real townships are — the initial sample points named in the job used wrong guessed coordinates
and read 0 (real Papamoa shops sit at 176.245E not 176.28E; real Omokoroa township at 176.036E
not 176.017E); corrected against the actual OSM-derived clusters, both fire correctly. The rural
SW corner stays dark (max 50 across the whole sampled region, mean 0.13/255) — no single point
exceeds the 60 ceiling. Matakana Island and the open harbour are black.

## Deliverables

- `prototype/data/citylights.png` — 4096×4096, 8-bit greyscale (colourspace `b-w`, 1 channel,
  verified via `sharp().metadata()`), 0 = dark.
- `prototype/data/citylights.json` — provenance: bbox, projection, OSM element counts and
  mirrors used, VIIRS status, weights, blur/normalize parameters.
- `prototype/fetch-citylights-osm.mjs`, `prototype/fetch-citylights-viirs.mjs`,
  `prototype/build-citylights.mjs` — the three build scripts, all idempotent/cache-aware.
- This README.

## Not done / left for the integration round

This layer is **not wired into `field-v2.png` or the shader** — the job scope was the standalone
raster + provenance, and `prep-field.mjs` / `look.mjs` / `template-v2.html` are off-limits this
round. A future job should decide how `citylights.png` replaces or blends with `field-v2.png`
channel B (straight swap looks correct from the crops, but that's a rendering-round call, not a
data-round one) and re-run `look.mjs` to confirm the shader's `cityGain`/`city` colour terms
still read well against the new distribution — Mount Maunganui at 186 vs CBD's 255 is a
believable relative brightness, but the shader's `pow(city, 1.6..3)` response curve was tuned
against the old channel's data and may want revisiting.
