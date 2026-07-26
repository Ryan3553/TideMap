# TideMap — imagery viability findings (2026-07-26)

**Verdict: viable.** Free, openly-licensed, tide-labelled imagery of Tauranga Harbour
exists in quantity, and the visual difference between high and low tide is dramatic.

## Why Tauranga Harbour is an unusually good subject

- 242 km², **~60% intertidal** — most of the harbour floor dries out.
- Spring tidal range 1.62 m, neap 1.24 m; LINZ predicted range ~0.2–2.1 m.
- So the map genuinely *transforms* between states rather than nudging a shoreline.

## Source 1 — Sentinel-2 (the tide-state stack) ✅ primary

Free (Copernicus open licence), 10 m/px true colour, public COGs on AWS,
no auth, no API key. Tile **60HVD** covers the whole harbour.

I queried the live archive (Earth Search STAC) and computed the actual tide height
at every overpass by interpolating LINZ's official Tauranga tide tables:

| cloud filter | usable passes (Jan 2024 → Jul 2026) | tide range sampled |
|---|---|---|
| < 5 % | 40 | 0.42 – 2.00 m |
| < 20 % | 57 | 0.39 – 2.00 m |

Every 0.25 m bin from 0.25 m to 2.00 m is populated. The archive runs back to **2015**,
so the real catalogue is roughly **4× these numbers (~200+ usable, tide-labelled scenes)**.

Why it works: Sentinel-2 has a fixed ~10:20 am local overpass, but the semidiurnal tide
drifts against the 5-day revisit — so the fixed morning slot sweeps the entire tide
cycle over a few weeks.

Reproduce with `research/tide-coverage-probe.mjs` (uses the LINZ CSVs in this folder).

**Proof samples** in `research/samples/`:
- `tauranga_lowtide_0.42m_2024-07-03.png` — mudflats and braided channels fully exposed
- `tauranga_hightide_2.00m_2026-06-18.png` — same frame, harbour brim-full

## Source 2 — LINZ LiDAR DEM (the geometry) ✅

- **Bay of Plenty – Tauranga LiDAR 1 m DEM (2025)**, captured 12 Feb – 2 Mar 2025,
  ±0.2 m vertical, NZVD2016, CC-BY on LINZ Data Service.
- Also BOP LiDAR 1 m DEM (2019–2022) and a 2015 coastal capture.
- **LINZ 3D Coastal Mapping** (topo-bathymetric LiDAR, Woolpert NZ) has flown
  **Maketū → Waihī Beach — i.e. the whole harbour** — point clouds due on LDS
  **mid-2026**. That dataset is seamless land + seabed, which is exactly what this app
  wants. Worth tracking; not required to start.

## Source 3 — LINZ aerial imagery (the pretty basemap) ✅

- **BOP 0.1 m urban aerial photos (2025)**, captured Oct–Dec 2025, CC-BY.
- **LINZ Basemaps XYZ tile API** — free, open licence, works in mobile apps, needs a
  free API key + attribution. Rate limits apply to standard access.
- Caveat: any single aerial capture is frozen at one unknown tide state, so aerials are
  the *look*, not the *tide signal*.

## Source 4 — tide predictions ✅

- LINZ publishes official Tauranga high/low predictions as free CSV + PDF, per year
  (already downloaded here for 2024–26). Tauranga is a **standard port**.
- MetService Tide API wraps LINZ harmonic constituents (commercial, in development).
- Best for shipping: bundle LINZ harmonic constituents and predict on-device — no
  network needed, works offline, matches official tables.

## Corroborating research

Peer-reviewed work (NHESS 2023) applied the **waterline method** to Sentinel-2 over
four NZ estuaries **including Tauranga Harbour**, recovering intertidal topography to
**0.2 m RMSE vs LiDAR**. That is a published precedent for exactly the data pipeline
this app needs.

## Implication for architecture

Don't cross-fade two photos. The stronger design:

1. One high-quality satellite/aerial basemap (dry land, fixed).
2. A **waterline stack**: ~15–20 Sentinel-2 scenes binned by tide height, each reduced
   to a water mask (NDWI). Each mask is a calibrated "sea level = X m" contour.
3. Live tide height from on-device LINZ harmonic prediction → pick/blend the two
   nearest masks → render the waterline, animating continuously through the day.

This gives smooth motion at any tide height, is tiny to ship (masks are vector/1-bit,
not photos), and upgrades cleanly to a true DEM flood-fill when the 3DCM
topo-bathy data lands mid-2026.

## Open questions

- Whole harbour vs a section (Ōmokoroa / Matakana / the city arm)? Whole harbour reads
  best at 10 m — the northern basin is where the drying is most spectacular.
- Does the 2025 LiDAR DEM actually contain intertidal elevations (flown at low tide) or
  clip at the waterline? Needs a download to confirm — not yet verified.
- Turbidity/sun-glint varies between scenes; masks will need per-scene thresholding.

## Sources

- https://earth-search.aws.element84.com/v1 (Sentinel-2 L2A STAC, AWS open data)
- https://data.linz.govt.nz/layer/122642-bay-of-plenty-tauranga-lidar-1m-dem-2025/
- https://data.linz.govt.nz/layer/123991-bay-of-plenty-01m-urban-aerial-photos-2025/
- https://www.linz.govt.nz/products-services/data/3d-coastal-mapping
- https://www.linz.govt.nz/news/2024-04/mapping-bay-plenty-coastline
- https://www.linz.govt.nz/products-services/tides-and-tidal-streams/tide-predictions
- https://basemaps.linz.govt.nz/docs/
- https://nhess.copernicus.org/articles/23/3125/2023/
