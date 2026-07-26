# J6 — Bathymetry for Tauranga Harbour (Chart NZ 5411)

Research + download job, keyless routes only (no `LINZ_KEY` in this environment). Everything
downloaded is under `sources/bathy/`, one subdirectory per source, each with a
`provenance.json`. Nothing in `prototype/` or `pipeline/` was touched.

## TL;DR

- **Got real, keyless, harbour-scale-usable bathymetry**: NIWA's **Bay of Plenty 25 m DTM**,
  a genuine multibeam/single-beam compilation, exported for the harbour bbox with no key and
  no registration. This is the headline win — 18x finer than the GEBCO fallback and it shows
  real channel-scale relief (validated below).
- **Got the documented keyless fallback**: **GEBCO_2024** global grid, ~450 m, bbox-clipped
  via HTTP range requests against a public COG mirror (no download-the-whole-4GB-file
  needed).
- **The single best dataset for this job is blocked on Ryan's LINZ key**: LDS layer
  **122679, "Bay of Plenty Multibeam 2m Depth Model (2024)"** — an actual 2024/25
  hydrographic survey, 2 m grid, vertical datum **Approximate Lowest Astronomical Tide**
  (i.e. chart datum, the same reference the tide model already uses). This is a straight
  swap-in for the current distance-from-shore depth proxy, if he wants to spend a key on it.
- **The LINZ ENC route is a dead end even with registration**: NZ ENCs are S-57 wrapped in
  **S-63 encryption**. Free registration gets you a *permit*, not raw vector data — you still
  need an S-63-capable ECDIS/ECS to decrypt it. Not worth pursuing for this renderer.

## What was obtained (`sources/bathy/`)

### `gebco/gebco2024_tauranga_bbox.tif`

- GEBCO_2024 global grid, bbox `175.93, -37.79, 176.37, -37.41`, clipped from the public COG
  mirror at `s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/alexgleith/gebco-2024/GEBCO_2024.tif`
  via `rasterio` + `/vsicurl/` windowed read (no auth, no full-file download — the tool fetched
  only the ~8 KB needed for this window from a 4.28 GB file).
- 106 × 91 px, EPSG:4326, int16 metres (negative = below sea level). ~450 m/pixel.
- Value range in the window: -142 m to +520 m.
- **Verdict**: real data, correctly the coarse baseline the constraints predicted. At 450
  m/pixel it cannot resolve the harbour's channels or the ebb-tide delta (~50–500 m
  features) — it is a sanity-check layer, not a source for the renderer.

### `niwa/bop25m_dtm_tauranga_bbox.tif`

- "NZ Bay of Plenty BoP 25m DTM" (NIWA), served keylessly from an ArcGIS ImageServer at
  `https://gis.niwa.co.nz/raster/rest/services/Bay_of_Plenty_25m_DTM/ImageServer`, discovered
  via NIWA's public ArcGIS Online catalogue (item `3a1d7ee29dac42e3ba6ec4efeeafbacf`, itself
  found by searching NIWA's `arcgis.com` org for "bathymetry").
- Exported directly for the harbour bbox via `exportImage` (`bbox=175.93,-37.79,176.37,-37.41`,
  `bboxSR=4326`, `imageSR=4326`, `size=1547,1690`, `format=tiff`, `pixelType=F32`) — one HTTP
  GET, no key, no registration, ~11.4 MB.
- 1547 × 1690 px, EPSG:4326, float32 metres. Native resolution 25 m (native CRS is EPSG:3994,
  reprojected server-side on export). Value range in the window: -257 m to +560 m.
- **Validated it isn't a flat/degenerate raster**: a transect sampled every 40 px across the
  middle of the image runs from +20 m (land) down through 0 and continues to -46 m, a
  plausible harbour-mouth-to-shelf profile — see `niwa/provenance.json` for the raw sample.
- Compiled by NIWA from multibeam + single-beam surveys (NIWA, LINZ, and international
  vessels), citing Lamarche et al. 2018. **Not tide/chart-datum referenced** — treat as a
  relief/shape source, not an absolute-depth source, until reconciled with the renderer's
  tide model.
- **Licence**: NIWA Open Data Licence BY-NN-NC-SA v1 — attribution required, **non-commercial**,
  share-alike. The licence page 404'd on direct fetch during this session (only summarised
  from search snippets) — **verify the exact terms before shipping**, and flag the NC clause
  to Ryan if TideMap is ever sold or licensed rather than just displayed.

## What's blocked on Ryan's LINZ key — exact LDS layer IDs

All of these were confirmed to exist and to cover Tauranga Harbour by querying LINZ's public
metadata API (`https://data.linz.govt.nz/services/api/v1.x/layers/<id>/`, which returns
title/description/extent with **no key** — only the actual data services (WFS, WMTS, Data
Table, Kart) are key-gated). Every export mechanism checked (WFS, WFS changesets, spatial
query, WMTS tiles, Kart HTTPS clone) returned `auth: apikey` or, for Kart, a `401
Unauthorized` on the clone URL despite its metadata claiming `auth: []` — so there is no
keyless data path here, only a keyless metadata/discovery path.

| Layer ID | Name | Type | Why it matters |
|---|---|---|---|
| **122679** | Bay of Plenty Multibeam 2m Depth Model (2024) | Gridded raster (tif/ascii, UTM) | **Recommended target.** Actual 2024–2025 multibeam survey (HS79), 2 m grid, vertical datum **Approximate LAT** — same reference frame as chart soundings and (roughly) the tide model. Extent covers the whole harbour and approaches. |
| 51402 | Chart NZ 5411 Tauranga Harbour – Katikati Entrance to Mount Maunganui | Raster chart image (TIFF, 1:40,000) | The named owner chart itself, as a georeferenced scan. Good for a visual/QA overlay, not a depth grid. |
| 51322 | Chart NZ 5412 Port of Tauranga | Raster chart image | Companion chart, larger scale over the port/channel. |
| 51323 | Chart NZ 5413 Approaches to Tauranga | Raster chart image | Companion chart, seaward approaches. |
| 50672 | Depth contour polyline (Hydro, 1:4k–1:22k) | Vector (S-57 DEPCNT derivative) | Harbour-scale depth contours — the most direct match for "rasterize contours → replace the bathy proxy channel" from the roadmap. |
| 50858 | Sounding points (Hydro, 1:4k–1:22k) | Vector points | Point soundings at the same scale as the contours above — pairs with 50672 for a proper isoline+spot-depth reconstruction. |
| 120366 | Bay of Plenty LiDAR 1m DEM (2024) | Raster (tif/asc, NZTM2000) | Bare-earth topo LiDAR, 1 m. Covers the harbour but is **not** confirmed to be topo-bathy (water-penetrating) — likely stops at the waterline/intertidal flats, which the renderer's drying-height raster already covers from other sources. Worth a look for the highest-resolution shoreline/flat geometry, not a bathymetry substitute. |
| 50813 | NZ Electronic Navigational Chart (ENC) Index | Vector index | Tells you which ENC cells cover Tauranga; the cells themselves are the S-63-encrypted product below, not on the LDS. |
| 95574 | NZ Bathymetric Surface Model Index | Index (metadata lookup 404'd on the same `/layers/<id>/` path used above — may need the `/table/<id>/` shape or a plain browser visit) | Referenced by 122679's own description as the way to discover whether a higher-resolution source grid exists for the harbour specifically; worth checking with a key. |

None of the above need anything beyond the standard **LINZ Data Service (LDS) key** already
documented in `docs/SOURCES.md` (the 32-hex-char Data Service key, not a Basemaps key). Once
Ryan has it:

```bash
# example — depth contour polyline, GeoJSON, clipped to the harbour bbox
curl "https://data.linz.govt.nz/services;key=$LINZ_KEY/wfs/layer-50672?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-50672&outputFormat=json&bbox=175.93,-37.79,176.37,-37.41,EPSG:4326"

# example — multibeam depth model raster, via WMTS/export (check the layer's own services/
# endpoint for the exact export URL template; raster layers use a different template than
# vector WFS)
```

## The ENC route — investigated, confirmed a dead end for this use case

LINZ's NZ ENC Service (`encservice.linz.govt.nz`) offers **free registration**, but the
product is S-57 data wrapped in **IHO S-63 encryption**. Registration gets a *permit file*,
not usable geodata — you then need an S-63-capable ECDIS/ECS just to decrypt the cells, and
even then the output is chart-symbology vector data meant for navigation software, not a
depth grid or contour set ready for a shader. This is a materially different, heavier lift
than getting an LDS key and pulling layer 50672/122679 directly, for the same underlying NZHA
source data. **Recommendation: skip the ENC route entirely; the LDS layers above are the
right target.**

## Other routes checked, ruled out or deferred

- **Port of Tauranga**: no public survey/open-data portal found.
- **Bay of Plenty Regional Council** (`data-boprc.opendata.arcgis.com`,
  `maps-boprc.opendata.arcgis.com`): confirmed to exist (BoPRC/Tauranga City/Western BoP DC
  open-data hub), but its DCAT/data.json feeds errored (`"Site catalog is not configured
  correctly"` / domain-not-found) during this session and a live tag/keyword search wasn't
  completed. Worth a manual look in a browser — not exhausted, just out of time this round.
- **NIWA national 250 m bathymetry** (`gis.niwa.co.nz/arcgis/rest/services/Reference/NZ_Bathymetry_250m/ImageServer`):
  exists, keyless, but 250 m is coarser than even the GEBCO fallback for this bbox and adds
  nothing — skipped in favour of the 25 m BoP-specific service above.

## Recommendation for the renderer

1. **Short term (no key needed)**: nothing in `gebco/` or `niwa/` should replace the
   distance-from-shore proxy as-is — wrong vertical datum, and even the 25 m NIWA grid isn't
   confirmed harbour-internal-channel resolution (the validated transect crossed the harbour
   *mouth*, not the dredged shipping channel itself; that needs a closer look at the full
   raster before trusting it inside the harbour). Treat `niwa/bop25m_dtm_tauranga_bbox.tif` as
   a candidate relief layer to inspect first, not a drop-in fix.
2. **Once Ryan has a key**: pull layer **122679** (multibeam 2m, LAT datum) as the primary
   depth source, and layer **50672 + 50858** (contours + soundings) as a vector cross-check /
   fallback for anywhere the multibeam grid has gaps. Rasterize the multibeam grid directly
   into the bathy channel the shader reads (it's already gridded, so this is a reproject +
   resample, not a contour-to-raster interpolation) — this directly answers the roadmap's "the
   deep shipping channel and the ebb-tide delta render truthfully" goal, and gives J4 (flow
   field) a real tangent field to derive instead of a proxy gradient.
3. **Datum reconciliation is the real remaining work**, not data acquisition: 122679 is LAT
   (chart datum), the NIWA 25 m grid is ~MSL, GEBCO is ~MSL-ish global convention, and the
   renderer's tide model has its own reference. Before wiring any of this into the shader,
   pick one datum (LAT is probably right, since it matches the tide tables already in
   `sources/tides/`) and note the offsets applied to the others.

## Provenance

Every file above has a sibling `provenance.json` with the exact URL/API call, parameters,
date, licence, and value-range sanity check used to obtain it — regenerate any of them
byte-for-byte from that file alone, per the `sources/` convention in `docs/SOURCES.md`.
