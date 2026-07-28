# Bathymetry audit — is the Tauranga Harbour composite the highest-detail data obtainable?

Date: 2026-07-28. Scope: `prototype/data/depth-composite.json` / `depth-composite-raw.f32`, built by
`prototype/build-depth-composite.py`, bbox lon 175.93..176.37 / lat -37.79..-37.41 (P=4096).
Report-only — no data was downloaded, no composite files were touched.

## Verdict up front

**No — for two identifiable slices of the harbour, better data exists and is not yet in the
composite; for everything else, what we hold is very likely the best obtainable without a paid
commercial commission.** Specifically:

- There is real Port-of-Tauranga-owned interior-harbour survey data **sitting at LINZ right now**,
  indexed in the *NZ Bathymetric Surface Model Index — Third Party* (LDS 122711), that we have
  never requested. It is not open data (owner consent required) but it is a known, named,
  citable asset — a one-email acquisition, not a fishing expedition.
- The HS79 2024/25 offshore multibeam we already hold as 2 m may have a native **1 m** product
  sitting behind the same "request via hydro@linz.govt.nz" door (LINZ's own layer description
  says so explicitly).
- Everything actually inside the dredged shipping channels (Stella Passage, Cutter Channel,
  Maunganui Roads) — the water Port of Tauranga actively resurveys every time it dredges — is
  **not** in either LINZ index. It exists (DML Surveys does routine pre/post-dredge MBES for
  Port of Tauranga) but has apparently never been deposited with LINZ. This is closed,
  operational survey data; the only path is asking the Port directly.
- Katikati entrance and the far northern/western reaches have **no** multibeam/singlebeam survey
  of any vintage indexed at LINZ at all, public or third-party. Our chart-vector interpolation
  (LDS 50672/50858) is genuinely the best available there short of commissioning new work.

## How this was checked

LINZ publishes a machine-readable, keyless discovery API (`data.linz.govt.nz/services/api/v1.x/`)
separate from the JS-rendered catalogue website (which doesn't render via a text fetch — every
attempt to browse the LDS website itself came back empty; the API was the only way in). Two
non-obvious index layers turned out to hold the real answer:

- **LDS 122710 — "NZ Bathymetric Surface Model Index"** (publicly-funded surveys since 1998)
- **LDS 122711 — "NZ Bathymetric Surface Model Index – Third Party"** (privately-commissioned
  surveys LINZ has been given a copy of, since 2009, release subject to the owner's consent)

Both were queried by WFS with the project's own `LINZ_KEY` (memory: `linz-api-keys.md`),
bbox-filtered to the exact composite bbox — this is the authoritative list of *every* gridded
bathymetric survey model LINZ holds (or knows about) intersecting our harbour, regardless of
whether it is published on the LDS as a downloadable layer. 9 public + 4 third-party features
intersect our bbox; every one is itemised below. This is a stronger method than searching the
catalogue website by keyword, which under-reports (it only surfaces *published* layers, and the
Port's own survey is not one).

## (a) Every candidate dataset found

### Already in our composite

| # | Dataset | Custodian | Resolution | Datum | Coverage vs bbox | Access | Layer/URL |
|---|---|---|---|---|---|---|---|
| — | Bay of Plenty Multibeam 2m Depth Model (2024), HS79 | LINZ/NZ Hydrographic Authority | 2 m | Approx. LAT | Offshore shelf band only, ~5–46 m below LAT, **15.8% of bbox valid, never enters the harbour** | Open, CC BY 4.0, Exports API (used) | [LDS 122679](https://data.linz.govt.nz/layer/122679-bay-of-plenty-multibeam-2m-depth-model-2024/) |
| — | Bay of Plenty – Waihi Beach and Tauranga Coastal LiDAR 2m DEM (2025) | LINZ 3D Coastal Mapping / nz-coastal | 2 m | NZVD2016 (topo+bathy) | Flats, shallows, "a surprising amount of channel floor" per build script; **deep permanently-wet channels are nodata** | Open, CC BY 4.0, keyless S3 COG | nz-coastal S3 bucket, `bay-of-plenty/waihi-beach-and-tauranga_2025/` |
| — | LDS 50672 + 50858 (chart depth contours + soundings) | LINZ NZ Hydrographic Authority | Vector, chart-derived | Chart datum (≈LAT) | Whole harbour; this is what fills the deep channels | Open, CC BY 4.0, WFS | [50672](https://data.linz.govt.nz/layer/50672/) / [50858](https://data.linz.govt.nz/layer/50858/) |
| — | NIWA Bay of Plenty 25 m DTM | NIWA / Earth Sciences NZ | 25 m | ≈MSL | Whole bbox, background only | Open, NIWA licence (non-commercial, share-alike — flagged in our own provenance as unverified for a sold/licensed piece) | [ArcGIS ImageServer](https://gis.niwa.co.nz/raster/rest/services/Bay_of_Plenty_25m_DTM/ImageServer) |

### Confirmed to exist, not yet in our composite

| # | Dataset | Custodian | Resolution | Datum | Coverage vs bbox | Access | Layer/URL |
|---|---|---|---|---|---|---|---|
| 1 | **Upper Tauranga Harbour Survey by DML** | Port of Tauranga (survey by Discovery Marine Ltd), held by LINZ | Unstated in index; singlebeam ("found by echo-sounder"), 200 m line spacing, scale 1:40,000 | WGS84 horiz.; vertical datum not recorded in index | **Interior harbour**, bbox lon 176.045–176.132 / lat -37.662..-37.617 (western/central reaches, inside our "natural channels" zone) | **Third-party, owner consent required.** Request from `hydro@linz.govt.nz`, cite Id `20230925 001934.828`, surf_name `3P_AQ31_UpperTaurangaHarbour_PC_5411-149` | [LDS 122711 index](https://data.linz.govt.nz/layer/122711-nz-bathymetric-surface-model-index-third-party/) |
| 2 | **Tauranga Passing Lane No 1 Reach 2020** | Port of Tauranga, held by LINZ | Not stated (MBES); sound accuracy 0.3 m, horiz. accuracy 0.5 m | Local datum (horizontal); vertical not recorded | **Interior harbour**, bbox lon 176.164–176.187 / lat -37.626..-37.601, near the entrance/port reach (chart tile ref NZ5412-414) | **Third-party, owner consent required.** Request from `hydro@linz.govt.nz`, cite Id `20210317 222601.991`, surf_name `3P_AQ31_PassingLane_5m_5412-414` | Same index as above |
| 3 | **HS79 Bay of Plenty Areas – Tauranga, 1 m source tiles** | LINZ | **1 m** (native — finer than the 2 m product we integrated) | Not recorded in index (same survey as 122679, so Approx. LAT) | Same offshore-shelf tile sheets as 122679 (tile bboxes span 175.96–176.51 lon; does **not** prove interior coverage — same survey, just full native resolution) | Not published as an LDS layer. 122679's own description states: *"source data used to create the depth model may be of a higher resolution/density than the model... supplied on request"*. Request via `hydro@linz.govt.nz`, cite Ids `20250716 010447.902` (surf_name `AQ31_Tauranga_1m_541-54`) and `20250716 010414.231` (`AP31_Tauranga_1m_541-54`) | [LDS 122710 index](https://data.linz.govt.nz/layer/122710-nz-bathymetric-surface-model-index/) |
| 4 | **3DCM pilot – Tauranga (April 2024)** | LINZ 3D Coastal Mapping | 1 m, "found by laser" (topo-bathy LiDAR pilot flight, a year before the March 2025 production flight) | Not recorded | Large tile-sheet bbox, coastal strip | Unpublished (`lds_name: 0`). Low priority — superseded in currency by the 2025 production capture we already hold | Same index as #3 |
| 5 | Port of Tauranga's own routine dredge-monitoring MBES (Stella Passage, Cutter Channel, Maunganui Roads, Town Reach) | Port of Tauranga, surveyed by Discovery Marine Ltd (DML Surveys) | Almost certainly sub-metre MBES, current (surveyed on every dredge cycle) | Unknown — proprietary | **The actual working shipping channels** — confirmed by DML's own site copy ("undertakes pre and post dredge surveys on behalf of POTL") and by the 2015–2017 capital-dredging subseafloor investigation papers, which describe MBES + diver + CPT work through Stella Passage/Cutter Channel/Maunganui Roads/entrance | **Fully closed.** Not in either LINZ bathymetric index (checked directly — neither 122710 nor 122711 has an entry for Stella Passage/Cutter Channel/Maunganui Roads itself within our bbox). No public portal. Contact DML Surveys (0800 365 787 / 0800 DMLSURVEY) or Port of Tauranga directly | [DML dredging surveys page](https://www.dmlsurveys.co.nz/page/tauranga-port-dredging-surveys/) |
| 6 | Stella Passage Wharves & dredging consent technical appendices | Port of Tauranga / regulator | Report-grade, likely includes bathymetric figures from a recent (2020s) survey | Unknown | Stella Passage / Sulphur Point / Mt Maunganui berths | Project was **declined** fast-track referral (2025) and pushed to standard RMA consenting at Bay of Plenty Regional Council — technical appendices (incl. any bathymetric survey) would be lodged with **BOPRC's public consent register**, not yet checked | [MfE fast-track page](https://environment.govt.nz/what-government-is-doing/areas-of-work/fast-track-consenting/port-of-tauranga-project/) (declined); follow to BOPRC consents register |
| 7 | Academic single/multibeam series, University of Waikato Coastal Marine Field Station | University of Waikato | Mixed; singlebeam series 1998–2011 used for Matakana Banks ebb-delta studies; more recent survey work referenced but not located as an open grid | Unknown | Matakana Banks ebb-tide delta (harbour entrance/offshore), plus historical harbour-wide echo-sounder work feeding hydrodynamic model papers | Not published as open GIS; would need to contact the Coastal Marine Field Station or the named researchers (e.g. de Lange, McKenzie) directly | [researchcommons.waikato.ac.nz](https://researchcommons.waikato.ac.nz/) |
| 8 | BOPRC "Contours & Bathymetry" service | Bay of Plenty Regional Council | Unknown (ArcGIS image service) | Unknown | At least "Bathymetry Maketu and Kaituna River Mouths" is confirmed in the service; **Tauranga Harbour coverage not confirmed either way** — the service is token-gated so its layer list couldn't be enumerated remotely | Closed (requires an authentication token even to list layers) — would need a direct request to BOPRC's GIS team | `gis.boprc.govt.nz/image/rest/services/elevation/ContoursAndBathymetry/MapServer` |
| 9 | MetOcean Solutions SCHISM bathymetry compilation ("detailed bathymetry near the Port of Tauranga") | MetOcean Solutions | Unknown | Unknown | Referenced in a 2024 MetOcean article on "bathymetric data wrangling" as an input to a SCHISM model; the article's actual content could not be retrieved this session (fetch failed twice) — **unresolved lead, worth a manual re-check** | Unknown, likely a commercial/consulting compilation | https://www.metocean.co.nz/news/2024-08-07/mappingtheseafloor |
| 10 | LDS 122642 — "Bay of Plenty – Tauranga LiDAR 1m DEM (2025)" | LINZ | 1 m | NZVD2016 | Same March 2025 capture window as our 2 m coastal DEM, but a smaller "Tauranga City" tile: lon 176.01–176.43 / lat -37.84..-37.62. **This misses the whole western arm (Omokoroa) and the Katikati entrance** — those lie north/west of this tile. For the sub-area it does cover, it is the same underlying survey at 2x our current resolution | Open, CC BY 4.0 | [LDS 122642](https://data.linz.govt.nz/layer/122642-bay-of-plenty-tauranga-lidar-1m-dem-2025/) |

### Checked and ruled out

| Dataset | Why it doesn't beat what we hold |
|---|---|
| GEBCO_2024 (already in `sources/bathy/gebco/`) | ~450 m/pixel, far coarser than everything above; correctly not used in the composite itself |
| Waikato Region Bathymetry and Sediment Habitat Mapping (Waikato Regional Council, TR2017/34) | Confirmed **out of area** — Waikato region coastline (Hauraki Gulf + west coast) does not include Tauranga Harbour / Bay of Plenty |
| NIWA Hauraki Gulf 20 m DTM | Different embayment entirely, not applicable |
| NIWA national 250 m bathymetry | Coarser than even GEBCO for this bbox |
| LDS Chart NZ 5411 / 5412 / 5413 (raster chart images) | Same underlying survey vintage as our vector contours/soundings (50672/50858); chart NZ 5411 original edition Oct 1993, most recent new edition Jul 2004 — a scanned picture of the same data we already hold as vectors, not an upgrade |
| LINZ ENC (S-57/S-63 encrypted) | Confirmed dead end for this use case — same NZHA source data as the LDS vector layers, but wrapped in navigation-software DRM; not worth pursuing |
| HS6 Shipping Lane 1 surveys (1999–2001, 2004) | Superseded by HS79 (2024) for the same offshore/approaches footprint; older and coarser (5–20 m vs HS79's 2 m/1 m) |
| HYD2012/13-04 Bay of Plenty (HS39, 2012–13) | Covers Motiti Island / Okaparu Reef — offshore islands, not the harbour |

## (b) Verdict per region of the composite

**Offshore shelf (HS79 band, ~5–46 m below LAT).** Best obtainable already in hand at 2 m grid.
A genuinely finer 1 m native product for this exact area is indexed (item #3 above) and could
sharpen it further, but this is a marginal, not urgent, upgrade — the 2 m product is already
hydrographic-survey grade (±0.31 m vertical) and 2 m already exceeds this project's rendering
needs by a wide margin.

**Harbour entrance / Matakana Banks ebb-tide delta.** Currently on LiDAR (2 m, penetrates
shallows well here) blended with chart vectors in deeper spots. No newer indexed multibeam
found specific to this zone beyond HS79's shelf band, which stops short of the entrance
throat itself per our own provenance. University of Waikato has repeatedly resurveyed this
delta (singlebeam series 1998–2011, cited in entrance-geomorphology research) but nothing
located as an open, requestable grid — worth one direct email to the Coastal Marine Field
Station, but not a blocking gap.

**Dredged shipping channels (Stella Passage, Cutter Channel, Maunganui Roads, Town Reach).**
**Not the best obtainable.** Current-generation MBES of these exact channels is surveyed
routinely by DML Surveys for Port of Tauranga (confirmed by DML's own site and by the
2015–2017 capital-dredging investigation literature) but is not deposited with LINZ and has
no public portal. Our composite is running on ~1990s/2004-vintage chart contours here — this
is the weakest link in the entire composite, exactly as flagged in `build-depth-composite.py`'s
own comments, and it is weak because the better data is closed, not because it doesn't exist.

**Natural channels west of the entrance (toward Omokoroa) / Katikati entrance.** Mixed.
A real Port-of-Tauranga-commissioned survey ("Upper Tauranga Harbour Survey by DML", item #1)
sits inside this zone's own footprint (lon 176.05–176.13) and is a plausible, licensable
upgrade over chart-vector interpolation there. But its northern/western reaches and the
Katikati entrance itself have **zero** indexed survey coverage of any kind, public or
third-party — for that stretch, the chart vectors genuinely are the best data that exists
anywhere, short of commissioning new work.

**Flats and shallows.** The 2 m LiDAR (and its unfetched 1 m sibling, item #10, over a
sub-area) is real, recent (2025), high-resolution measurement. This is already at or near
best-obtainable; a 1 m re-pull would sharpen the central Tauranga City portion only.

## (c) Prioritized acquisition list

1. **Email `hydro@linz.govt.nz`, subject "Hydro Bathy Data", requesting the two third-party
   Port of Tauranga surveys.** Cite both by Id/surf_name exactly as listed above:
   - `20230925 001934.828` / `3P_AQ31_UpperTaurangaHarbour_PC_5411-149` ("Upper Tauranga
     Harbour Survey by DML")
   - `20210317 222601.991` / `3P_AQ31_PassingLane_5m_5412-414` ("Tauranga Passing Lane No 1
     Reach 2020")
   Release is subject to Port of Tauranga's consent as data owner (per LDS 122711's own
   description) — expect a delay while LINZ checks with them, and expect the reply may be a
   partial "no" if the Port doesn't want internal survey data public. Ask what format/datum
   it would come in so it can be reconciled against our chart-datum pipeline.

2. **Same email, same request, add the two HS79 1 m source tiles** already in hand at 2 m:
   `20250716 010447.902` / `AQ31_Tauranga_1m_541-54` and `20250716 010414.231` /
   `AP31_Tauranga_1m_541-54`. This one is publicly-funded (LDS 122710, not the third-party
   index), so there's no ownership hurdle — it's purely "the LDS export only ships the 2 m
   product, please send the 1 m source." Lower priority than #1 (marginal gain, offshore only)
   but a single email covers both asks.

3. **Contact DML Surveys directly** (0800 365 787 / 0800 DMLSURVEY, or via
   dmlsurveys.co.nz) and separately **Port of Tauranga**, asking whether any de-identified or
   archival MBES from routine Stella Passage / Cutter Channel / Maunganui Roads dredge
   monitoring can be shared or licensed for a non-navigational visualisation project. This is
   the only path to the actual working-channel data (item #5); treat as a longer-shot,
   relationship-based ask rather than a data-portal pull.

4. **Check the Bay of Plenty Regional Council public consent register** for the Port of
   Tauranga Stella Passage Wharves & dredging application (pushed to standard RMA consenting
   after its fast-track referral was declined in 2025). Technical appendices on public consent
   files are often the easiest legally-public route to a recent bathymetric survey figure or
   dataset for exactly the channel this project needs most.

5. **Pull LDS 122642 ("Bay of Plenty – Tauranga LiDAR 1m DEM (2025)")** as a straightforward,
   no-permission, CC BY 4.0 swap-in for the central Tauranga City sub-area (lon 176.01–176.43,
   lat -37.84..-37.62) — doubles resolution over the current 2 m coastal DEM there. Cheapest
   item on this list to execute; smallest impact (flats/shallows only, and only in the
   sub-area, not the western arm or Katikati).

6. **Re-fetch the MetOcean Solutions article** (https://www.metocean.co.nz/news/2024-08-07/
   mappingtheseafloor) by other means (it failed to fetch twice this session) — it explicitly
   claims a "detailed bathymetry near the Port of Tauranga" compilation and may name a source
   worth chasing.

7. **Email the University of Waikato Coastal Marine Field Station** asking whether any of
   their harbour singlebeam/multibeam survey series (used across multiple Tauranga Harbour
   hydrodynamic-model theses since the 1990s) exists as a shareable grid. Lowest-confidence
   lead on this list — the theses reviewed never named a downloadable dataset, only "data
   collected by the University of Waikato."

8. **Ask BOPRC's GIS team directly** whether `elevation/ContoursAndBathymetry` (currently
   token-gated) includes Tauranga Harbour or only Maketu/Kaituna, and whether the token can be
   issued for this use.

## Notes on method / things NOT done

- No large files were downloaded; every check above was a metadata/index/WFS query returning at
  most a few hundred KB.
- The LDS website itself (`data.linz.govt.nz`, the human catalogue) is a JS single-page app and
  returned only its page shell to every fetch attempt this session — all LDS findings came from
  its keyless JSON discovery API instead (`services/api/v1.x/layers/<id>/`, and
  `services/api/v1.x/data/?q=...` for search), which is worth remembering for future sessions
  rather than fighting the website again.
- The two bathymetric-surface-model index layers (122710/122711) were queried with the
  project's own `LINZ_KEY` (WFS `wxs` scope, no Exports scope needed) — this key is not
  reproduced here; see the `linz-api-keys` memory file.
