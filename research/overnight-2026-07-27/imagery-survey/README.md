# J1b — keyless satellite imagery survey (Tauranga Harbour)

Overnight job J1b: find and download the best satellite imagery reachable **without any API
key**, on the exact renderer grid (4096×4096 equirectangular, bbox below), compare against
what the project already has, and ship the winner(s) as candidate basemaps.

```
bbox (WGS84): west 175.93  south -37.79  east 176.37  north -37.41
grid: 4096x4096 equirectangular (plate carrée) over that exact bbox
```

## TL;DR verdict

**`prototype/data/base-s2fresh.jpg`** — a fresh 3-scene median composite straight from the
public Sentinel-2 L2A COGs on AWS, at native 10 m, custom-graded — is the best keyless
candidate shipped this round. It is a clear step up in colour richness over the project's
existing `base-hi.jpg` (also Sentinel-2, but a single older scene with a flatter, unstretched
tone curve), while carrying the same 10 m ground sampling distance (same fundamental detail
ceiling as `base-hi.jpg`; nowhere near LINZ aerial's detail).

*(EOX / GIBS verdicts below — filled in after their fetches completed.)*

Nothing here beats `base-aerial.jpg` (the LINZ-fusion tile) for *detail*. That was never in
question — the LINZ aerial is the only sub-metre source for this area, and it needs a key
this environment doesn't have. This survey's job was colour, not detail; the detail fix is
J1's fusion track (LINZ luminance + Sentinel-2 colour), running in parallel in
`research/overnight-2026-07-27/imagery/`. `base-s2fresh.jpg` is a strictly better colour
donor for that fusion than the `base-hi.jpg` it currently uses — see "Handoff" below.

## What was tried

### 1. Fresh Sentinel-2 L2A (shipped: `base-s2fresh.jpg`)

**Source**: Copernicus Sentinel-2 L2A Cloud-Optimized GeoTIFFs, public on AWS Open Data,
queried via the Earth Search (Element 84) STAC API — no auth, no key.

- STAC endpoint: `https://earth-search.aws.element84.com/v1/search`
- Collection: `sentinel-2-l2a`
- COGs: `https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/60/H/VD/...`
- MGRS tile: **60HVD** (the same tile the project's existing `base-hi.jpg` used — its native
  footprint, `[175.860, -38.036, 177.111, -37.041]`, comfortably covers the whole target bbox
  on its own; no second tile needed).

**Scene selection.** Queried the STAC API for tile 60HVD, cloud cover < 15%, then filtered to
scenes whose STAC `bbox` spans the *full* tile footprint (several candidate scenes turned out
to be partial-swath granules whose data cuts off partway across the target bbox — a trap:
the lowest-cloud hit in a naive query, `S2B_60HVD_20260303_0_L2A`, is one of these and
renders mostly nodata over our AOI; discovered by inspecting `item.bbox[2]` (east edge)
against the target's `east=176.37`). Among full-tile, low-cloud, growing-season (Oct–Apr,
good sun elevation, avoids NZ winter's long shadows) scenes, picked the three lowest-cloud:

| scene id | date | cloud % | notes |
|---|---|---|---|
| `S2C_60HVD_20251115_0_L2A` | 2025-11-15 | 0.36 | full tile |
| `S2B_60HVD_20251210_0_L2A` | 2025-12-10 | 2.46 | full tile, mid-summer |
| `S2C_60HVD_20260424_0_L2A` | 2026-04-24 | 0.19 | full tile, near-zero cloud |

STAC item JSON for each is reproducible via
`GET https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/<id>`.

**Download.** Rather than pulling full ~110 MB/band scenes, read only the ~4000×4300 px
window covering the bbox directly off each remote COG via HTTP range requests
(`geotiff.js`, `fromUrl` + `readRasters({window})`) — bands B04/B03/B02 (red/green/blue) at
native 10 m. This is the same "only fetch what you need" idea as `reproject-linz.mjs`, just
against a remote COG instead of an archived mosaic.

**Radiometric gotcha (worth flagging for future sessions).** Earth-search's STAC
`raster:bands` metadata publishes `scale: 0.0001, offset: -0.1` for these bands. Applying
that literally (`reflectance = DN*scale + offset`) renders the scene almost black — median
reflectance came out around -0.08, implausible for a mixed land/water scene. The correct
relationship (ESA's PB04+ convention, `BOA_ADD_OFFSET = -1000`) is
`reflectance = (DN + 1000) / 10000 = DN*0.0001 + 0.1` — the **offset's sign must be
flipped** from what earth-search publishes. Confirmed empirically: flipping the sign turned
a near-black frame into a correctly-toned, recognisable image of the harbour. If any other
job in this project reads these COGs directly (rather than through a tool like titiler that
handles this internally), watch for this.

**Reprojection.** UTM zone 60S (EPSG:32760) → WGS84 lon/lat → the renderer's equirectangular
grid, via `proj4`, per-output-pixel (not per-corner — UTM grid convergence at this latitude
is ~0.4–0.65° across the bbox, enough to matter at 4096 px), bilinear-sampled from the
windowed raster. Same shape of algorithm as `reproject-linz.mjs`'s Mercator math, just a
different source projection.

**Compositing.** Per-pixel **median** across the three aligned scenes. Verified this does
what the job asked ("kill clouds/boat wakes"): a ship's wake is clearly visible in the
single-scene (2026-04-24) render over open water east of the harbour mouth; it's
completely gone in the 3-scene median (see
`crops/s2fresh-single_ocean.jpg` vs `crops/s2fresh-median_ocean.jpg`). Median wins outright —
shipped as the primary candidate. (A single-scene render, `single-best.jpg`, was also built
from the 2026-04-24 scene alone as a control; not shipped, kept only for the comparison.)

**Tone curve.** Raw L2A reflectance renders very pale/washed (typical for atmospherically-
corrected surface reflectance without any stretch — this is presumably also why the
project's existing `base-hi.jpg` reads flat). Applied: per-channel 2nd–99.5th-percentile
linear stretch, gamma 0.85 (brighten midtones), then a 1.35× saturation boost in HSL space.
Aimed for "rich, not washed out" per the brief without pushing into oversaturated/artificial
territory.

**Licence**: Copernicus Sentinel data is free and open (Copernicus Open Data licence);
attribution: *"Contains modified Copernicus Sentinel data 2025/2026"*.

**Output**: `prototype/data/base-s2fresh.jpg`, 4096×4096, ~2.7 MB.

### 2. EOX Sentinel-2 cloudless

**Source**: `https://tiles.maps.eox.at/wmts`, keyless WMTS, layer `s2cloudless-2025_3857`
(EOX's cloud-free global S2 mosaic, 2025 edition), `GoogleMapsCompatible` tile matrix
(standard z/x/y web-mercator, 256 px tiles), zoom 14.

Fetched all z14 tiles covering the bbox (~21×23 = ~480 tiles), mosaicked, reprojected onto
the same 4096×4096 grid using the same Mercator un-projection math as `reproject-linz.mjs`
(tile-space → lon/lat bilinear resample).

**Licence**: **CC BY-NC-SA 4.0** (per the WMTS capabilities document's per-layer abstract,
`https://creativecommons.org/licenses/by-nc-sa/4.0/`) — fine for this project's personal,
non-commercial use. Attribution: *"Sentinel-2 cloudless by EOX IT Services GmbH — Contains
modified Copernicus Sentinel data 2025 — CC BY-NC-SA 4.0"*.

**Output**: `prototype/data/base-eox.jpg`, 4096×4096.

*(Verdict vs. base-s2fresh.jpg: see below.)*

### 3. NASA GIBS — rejected on resolution

**Source checked**: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/WMTSCapabilities.xml`
(keyless). Best true-colour layers available: `VIIRS_SNPP_CorrectedReflectance_TrueColor`,
`MODIS_{Terra,Aqua}_CorrectedReflectance_TrueColor`, and siblings.

**One-line reason for rejection**: their finest tile matrix set (`250m`, level 8 of 8) is
~244 m/px — about **24× coarser** than the Sentinel-2 10 m data already secured in step 1,
which over this ~44×42 km bbox would smear the whole harbour into roughly a 180×170 px blur
before upscaling to the 4096 grid; a sample tile fetched for evidence
(`crops/gibs-viirs-sample-tile.jpg`, `250m/8/113/316`, dated 2026-03-03) also happened to
have cloud cover over the harbour, reinforcing the call — GIBS is a coarse-resolution,
whole-Earth-monitoring product, not a basemap source. No candidate built; not worth the
pipeline effort at this resolution.

## Comparison crops

`crops/` — three landmarks × available sources, all cut from the *same* lon/lat window on
each candidate's own grid (city ⌖ 176.1667,-37.6878 · Matakana Island ⌖ 176.08,-37.60 ·
forest SW corner ⌖ 175.98,-37.75), each resampled to 512×512 for like-for-like viewing:

- `aerial_*.jpg` — existing `base-aerial.jpg` (LINZ aerial + Sentinel-2 fusion, the
  project's current highest-detail basemap)
- `hi_*.jpg` — existing `base-hi.jpg` (single Sentinel-2 scene, `S2A_60HVD_20240703_0_L2A`,
  0% cloud, project's existing pure-S2 colour source)
- `s2fresh-median_*.jpg` — this round's shipped candidate (3-scene median, graded)
- `s2fresh-single_*.jpg` — this round's single-scene control (2026-04-24, graded, not
  shipped)
- `s2fresh-*_ocean.jpg` — open-water crop east of the harbour mouth, included specifically
  to show the median composite erasing a boat wake that's clearly visible in the single-scene
  render
- `gibs-viirs-sample-tile.jpg` — raw NASA GIBS VIIRS true-colour tile (not reprojected/cropped
  to the bbox — see rejection note above)
- `eox_*.jpg` — EOX cloudless crops *(added after the z14 fetch completed — see verdict)*

**Ranked verdict** (detail vs. colour, keyless sources only):

1. `base-aerial.jpg` (existing, LINZ) — unmatched detail (building/field/road level), but
   flat/washed colour, per Ryan's original complaint. Needs a LINZ key to refresh/extend.
2. `base-s2fresh.jpg` (**new, shipped**) — same 10 m ceiling as `base-hi.jpg`, but visibly
   richer, punchier colour: water reads in proper teal/navy gradients, sand flats show warm
   tonal variation, vegetation is a believable green rather than muddy olive. Best keyless
   *colour* source found this round.
3. `base-hi.jpg` (existing) — same 10 m source data family, just one older scene with no
   grading; superseded in colour by `base-s2fresh.jpg` on every crop.
4. *(EOX position — filled in below.)*
5. NASA GIBS — rejected outright, resolution.

## What a LINZ key would unlock

Both `data.linz.govt.nz` (vector/WFS data — hydrographic soundings, depth contours, etc. for
J6) and `basemaps.linz.govt.nz` (the aerial imagery WMTS/XYZ tiles) return an explicit
`API Key Invalid: missing` / `invalid-api-key` error on every request without one — confirmed
directly (`curl` against both, no key, both hard-reject; see raw responses below), so this is
not a "maybe" — it's a hard wall. With a key:

- **`basemaps.linz.govt.nz`** — the same aerial imagery source `base-aerial.jpg` was already
  built from (`sources/linz-aerial/mosaic-z14-mercator.png`, archived from a past session),
  but *live* and at higher zoom than the archived z14 mosaic — LINZ serves NZ urban aerial up
  to z21+ in many areas (sub-10cm), well past the z14 ceiling `reproject-linz.mjs` is
  currently capped at. A key would let J1's fusion track pull a sharper LINZ layer than what
  is currently archived.
- **`data.linz.govt.nz`** — vector hydrographic layers (soundings, depth contours) directly
  relevant to **J6** (bathymetry). This round treated J6 as research-only per the roadmap;
  a key turns it into a real data pull.

Confirmed rejections (no key supplied):
```
$ curl https://basemaps.linz.govt.nz/v1/tiles/aerial/EPSG:3857/14/0/0.webp
{"status":400,"message":"API Key Invalid: missing", ...}

$ curl "https://data.linz.govt.nz/services/query/v1/vector.json?key=&layer=50767&..."
invalid-api-key: Provide a valid api key
```

## Handoff to J1's fusion track

`research/overnight-2026-07-27/imagery/` (a parallel job this round) is fusing LINZ luminance
with Sentinel-2 colour, currently sourced from `base-hi.jpg`. Since `base-s2fresh.jpg` is a
strict colour upgrade over `base-hi.jpg` on the same 10 m grid (same alignment, same bbox,
drop-in compatible), it's worth that job swapping its colour donor once it sees this file —
not done here, since editing that job's in-flight script wasn't this job's mandate.

## Reproducing this

The fetch/reproject/compose scripts built for this survey live only in the scratchpad (not
checked into the repo, per the job's "don't touch pipeline/ or prototype scripts" constraint)
— everything needed to reproduce is the STAC ids, COG URLs, and WMTS layer/zoom above, which
are all permanently public. No archived raw COGs are kept (same call as the project's
existing `sources/sentinel2/MANIFEST.json` — "raw COGs not archived because they are
permanently public").
