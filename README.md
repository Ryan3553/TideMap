# TideMap

An always-on iPad artwork of **Tauranga Harbour**, showing the real tide, sun and moon.
Land is a fixed basemap; every waterline is computed from a per-pixel drying-height raster
and a predicted tide. Real information, displayed beautifully.

**All documentation lives in [`docs/`](docs/) — point a new session at that folder.**
Start with [docs/HANDOVER.md](docs/HANDOVER.md), then [docs/CONCEPT.md](docs/CONCEPT.md).
[docs/README.md](docs/README.md) is the index and says what to read when.

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
