# ROADMAP — the "make it beautiful" round (started 2026-07-26 21:45, overnight run)

Ryan's verdict on the fourth pass: a relatively small change, still a long way from
beautiful. His notes, translated into jobs. This round runs overnight, autonomously, with
up to 20 Sonnet subagents. Questions accumulate at the bottom for the morning; nothing
blocks on him.

## The jobs

### J1 — Imagery quality (Ryan: "flat and washed out" / "richer colour but lacks detail")
The LINZ aerial has the detail but reads flat and washed out, worst over the city and
Matakana Island. Sentinel-2 has the colour but not the detail. Neither is good enough alone.
- **Fusion**: LINZ luminance detail + Sentinel-2 colour (pansharpen-style). The single most
  promising fix and needs no new data.
- **Regrade**: dehaze / vibrance / local-contrast variants of the LINZ aerial.
- **Fresh sources**: survey what is reachable *without* a LINZ key (the key is not in this
  environment — see Constraints): public Sentinel-2 COGs on AWS, NASA GIBS, EOX S2-cloudless,
  and anything else licensed for this use. Download, compare on the SAME crops (city,
  Matakana, forest corner), pick a winner, keep the rest as dropdown options.

### J2 — Night lights (Ryan: "countryside brighter than the city — this isn't right at all")
The current city channel comes from the pipeline's urban classification and it is wrong:
Tauranga CBD and Mount Maunganui are nearly dark while rural sheds glow. Rebuild the lights
layer from data that actually encodes where light is:
- OSM roads (class-weighted: motorway/arterial bright, residential mid, tracks nothing) +
  building density for the urban texture.
- VIIRS night-lights (NASA GIBS, keyless) as a coarse brightness prior so the *distribution*
  is real even though it is 500 m data.
- Output: a new lights layer on the field grid, hot in the city, warm along arterials, dark
  in the countryside. This is one of the most important features at night.

### J3 — Smooth tide motion (Ryan: "sudden distinct zones which appear and disappear")
Diagnose then fix. Known suspects, to be confirmed by rendering a tide sweep:
- The drying-height raster is 8-bit over 4 m → 15.7 mm steps; whole flats sit on one
  quantum and flip at once. Fix: 16-bit height (split across two texture channels) plus a
  small blue-noise dither in the shader.
- The edge sheen / shore glow bands outline each zone as it appears, amplifying the pop.
  Rebalance so the waterline leads and the outlines follow gently.

### J4 — Flowing, swirling channels (the reference image's signature)
The reference's braided, luminous flow lines through the channels are the look Ryan wants,
"even if they are not real". Plan: **line integral convolution (LIC)** over the channel
tangent field (perpendicular to the bathy/height gradient), precomputed offline into a flow
texture, animated in the shader by advecting the LIC phase along the flow direction.
Procedural first; AI-image restyling stays a fallback (hard to do consistently across
layers — noted for the morning report).

### J5 — Artistic swell + real movement
- Swell lines: multi-frequency, feathered, slowly drifting shoreward; they should read as
  water, not contours.
- Movement everywhere it is honest: shimmer that travels WITH the tide direction (flood =
  landward, ebb = seaward), breathing on a long period. The piece must feel alive at a
  glance without ever looking busy.

### J6 — Bathymetry (Chart NZ 5411)
Find and download usable bathymetry for Tauranga Harbour: LINZ hydrographic vectors
(soundings, depth contours), NIWA grids, or the raster chart. Without an LDS key this may
be research-only this round — document exactly what is available and what it costs to get.

### J7 — Everything else that serves "artwork, not infographic"
Grade, vignette, atmosphere, the plate typography — small things allowed if they clear the
bar.

## Constraints and facts for this round

- **No LINZ key in this environment.** `LINZ_KEY` was used in a previous session and never
  persisted. J1/J6 must work keyless or produce a precise shopping list for Ryan.
- The raw LINZ z14 mosaic IS archived (`sources/linz-aerial/mosaic-z14-mercator.png`), so
  fusion/regrade work needs no key.
- Sentinel-2 L2A COGs are public on AWS; scene ids pinned in `sources/sentinel2/`.
- All the traps in `docs/NEXT-SESSION.md` stand. Two new ones from the fourth pass: no
  backticks inside the FS shader string (build now asserts the module parses), and
  night-glow must never be built from raw bathy isolines (chamfer octagons).
- `prototype/look.mjs` must be kept in lockstep with any shader change, or the project's
  only eyes lie.

## Output layout for this round

- `research/overnight-2026-07-27/` — findings, comparisons, contact sheets, per job.
- `prototype/data/` — candidate and final rasters (basemaps, lights, flow, field-v3).
- `docs/REPORT-2026-07-27.md` — the morning report for Ryan.

## Questions for Ryan (answered next rev, nothing blocks)

- (accumulates during the run — see the morning report)
