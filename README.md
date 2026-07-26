# TideMap

An always-on iPad artwork of **Tauranga Harbour**, showing the real tide, sun and moon.
Land is a fixed basemap; every waterline is computed from a per-pixel drying-height raster
and a predicted tide. Real information, displayed beautifully.

- `HANDOVER.md` — **start here**: current state, the three known defects, what not to touch
- `NEXT-SESSION.md` — kickoff prompt, reading list, acceptance criteria, environment traps
- `CONCEPT.md` — what it is, why, and the design rulings behind it
- `sources/MANIFEST.md` — the inputs and how to regenerate them
- `pipeline/VALIDATION.md`, `tide/VALIDATION.md` — how far each component can be trusted

## Quick start

```bash
cd prototype && npm install          # sharp only
node build-v2.mjs                    # -> tidemap-v2.html (self-contained)
node serve.mjs                       # then open localhost:5179/tidemap-v2.html
```

## Attribution required

- Tide predictions and aerial imagery: **Toitū Te Whenua Land Information New Zealand**
  (LINZ tide tables; LDS layer 123991, CC BY 4.0)
- Satellite imagery: **Copernicus Sentinel-2**

Tide predictions here are for an artwork. They are not for navigation.
