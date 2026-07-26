# sources/ — the inputs, and how to get them back

Everything downstream is derived and regenerable. **This directory is the only place that
holds inputs**, and nothing here should ever be edited by a script.

Large rasters are gitignored: they are big, binary, and reproducible. What *is* committed
is the provenance — service, layer, zoom, tile range, bbox, checksum — so any file here can
be rebuilt byte-for-byte, or its absence detected.

| directory | what | licence |
|---|---|---|
| `tides/` | LINZ official tide tables for Tauranga (port 073), 2023–2027, CSV | LINZ, attribution required |
| `linz-aerial/` | LINZ 0.1 m aerial, LDS layer 123991 (BoP Urban 2025), raw Web-Mercator mosaic + manifest | CC BY 4.0, attribution to Toitū Te Whenua LINZ |
| `sentinel2/` | Copernicus Sentinel-2 L2A provenance: the 204 scene ids behind the drying-height raster, plus the basemap scene | Copernicus open licence |

## Why the aerial mosaic is stored raw

The renderer eats a *reprojected and composited* derivative (Mercator → equirectangular,
then blended over Sentinel-2 along the coastline). Both of those steps are lossy and
opinionated. The raw mosaic is the thing worth keeping, so a future change of mind about
projection or blending costs nothing.

## Regenerating

```bash
# LINZ aerial — raw mosaic archived, plus the reprojected derivative
cd prototype
ARCHIVE=1 LINZ_KEY=<your LDS key> node fetch-linz.mjs 14 data/base-linz.jpg 4096
node compose-base.mjs        # blends over Sentinel along the coastline
```

`LINZ_KEY` is a **LINZ Data Service** key (32 hex chars), NOT a LINZ Basemaps key (those are
ULID-format and a different service — Basemaps rejects an LDS key as "malformed"). The key
is used at build time only and is asserted absent from any published page.

Higher zoom is a straight parameter change, but cost grows fourfold per level: z14 is 483
tiles, z15 ≈ 1,900, z16 ≈ 7,600. Going past z14 is only worth it for a sub-region, not the
whole harbour.

## Sentinel-2

Not archived as bytes, deliberately: the COGs are permanently public on AWS with no auth,
and the scene ids in `sentinel2/scenes.json` pin the exact inputs. Re-fetching is a script
run, not a recovery operation.
