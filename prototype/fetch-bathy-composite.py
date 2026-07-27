#!/usr/bin/env python3
"""
Fetch the composite-bathymetry inputs that the LDS key's current scopes allow.

The true target for the artery-flow rebuild is LDS layer 122679 (Bay of Plenty
Multibeam 2m Depth Model, 2024, LAT datum). That layer needs the Koordinates
EXPORT API, and Ryan's LDS key has only the tiles/web-services scope — every
export/datasources request returns {"detail": "Invalid API key scope"} (verified
2026-07-27). Until the key gets the Exports scope, the best real bathymetry the
keys reach is this composite, all fetched here:

  1. LDS 50672  hydro depth-contour polylines (WFS, works with the wxs scope).
     Chart-scale (NZ 5411/5412, 1:4k-1:22k). Depth attribute: valdco, metres
     below chart datum (LAT), positive down.
  2. LDS 50858  hydro sounding points (WFS). Depth attribute: depth, metres
     below chart datum, positive down.
  3. nz-coastal (LINZ open S3 bucket, keyless): Bay of Plenty - Waihi Beach and
     Tauranga Coastal LiDAR 2m DEM (2025), sheets BC36/BD36/BD37, EPSG:2193,
     float32 elevation (NZVD2016, positive up), nodata -9999. Topo-bathy LiDAR:
     valid over land margins, flats and shallow water; nodata over the deep
     channels (beyond laser reach) — exactly complementary to the soundings.

Windowed-clips the COGs to the project bbox and stores everything under
sources/bathy/, one directory per source, each with provenance.json, per
docs/SOURCES.md. Idempotent: skips files that already exist.

Usage:  LINZ_KEY=<lds key>  python fetch-bathy-composite.py
"""
import json
import os
import sys
import time
import urllib.request

import numpy as np
import rasterio
from rasterio.warp import transform as rtransform
from rasterio.windows import Window, from_bounds

WEST, SOUTH, EAST, NORTH = 175.93, -37.79, 176.37, -37.41
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BATHY = os.path.join(ROOT, "sources", "bathy")
KEY = os.environ.get("LINZ_KEY")
if not KEY:
    sys.exit("LINZ_KEY env var required (LDS key, 32 hex chars)")

FETCHED_AT = "2026-07-27"


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "TideMap/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


# ------------------------------------------------------------------ WFS vector
def fetch_wfs(layer_id, out_dir, depth_attr_note):
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"layer-{layer_id}.geojson")
    url_tpl = (
        "https://data.linz.govt.nz/services;key={key}/wfs/layer-{lid}"
        "?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-{lid}"
        "&outputFormat=json&count=250000"
        "&bbox=-37.79,175.93,-37.41,176.37,urn:ogc:def:crs:EPSG:4326"
    )
    if not os.path.exists(out_path):
        data = fetch_json(url_tpl.format(key=KEY, lid=layer_id))
        feats = data.get("features", [])
        # follow paging just in case (not expected at these counts)
        nxt = next((l["href"] for l in data.get("links", []) if l.get("rel") == "next"), None)
        while nxt:
            page = fetch_json(nxt)
            feats.extend(page.get("features", []))
            nxt = next((l["href"] for l in page.get("links", []) if l.get("rel") == "next"), None)
        data["features"] = feats
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        print(f"layer-{layer_id}: {len(feats)} features -> {out_path}")
    else:
        print(f"layer-{layer_id}: already fetched")

    prov = {
        "file": f"layer-{layer_id}.geojson",
        "source": f"LINZ Data Service layer {layer_id}",
        "obtained_via": "WFS GetFeature, LDS key (wxs scope), key redacted",
        "request_used": url_tpl.format(key="<LINZ_KEY>", lid=layer_id),
        "bbox_wgs84": {"west": WEST, "south": SOUTH, "east": EAST, "north": NORTH},
        "depth_attribute": depth_attr_note,
        "vertical_datum": "chart datum (approximately LAT), metres, positive DOWN",
        "licence": "CC BY 4.0, attribution Toitu Te Whenua Land Information New Zealand",
        "fetched": FETCHED_AT,
    }
    with open(os.path.join(out_dir, "provenance.json"), "w") as f:
        json.dump(prov, f, indent=2)


# ------------------------------------------------------------- coastal 2m COGs
def clip_coastal():
    base = ("https://nz-coastal.s3.ap-southeast-2.amazonaws.com/"
            "bay-of-plenty/waihi-beach-and-tauranga_2025/dem_2m/2193")
    out_dir = os.path.join(BATHY, "coastal2m")
    os.makedirs(out_dir, exist_ok=True)
    sheets = ["BC36", "BD36", "BD37"]
    kept = []
    for name in sheets:
        out_path = os.path.join(out_dir, f"{name}_clip.tif")
        if os.path.exists(out_path):
            print(f"{name}: already clipped")
            kept.append(name)
            continue
        src = rasterio.open(f"/vsicurl/{base}/{name}.tiff")
        xs, ys = rtransform("EPSG:4326", src.crs, [WEST, EAST], [SOUTH, NORTH])
        # bbox corners in 2193 (axis-aligned approx is fine: sheet edges are metres-aligned)
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        b = src.bounds
        ix0, ix1 = max(x0, b.left), min(x1, b.right)
        iy0, iy1 = max(y0, b.bottom), min(y1, b.top)
        if ix0 >= ix1 or iy0 >= iy1:
            print(f"{name}: no overlap with bbox, skipped")
            continue
        win = from_bounds(ix0, iy0, ix1, iy1, src.transform)
        win = win.round_offsets().round_lengths()
        arr = src.read(1, window=win)
        prof = src.profile.copy()
        prof.update(width=arr.shape[1], height=arr.shape[0],
                    transform=src.window_transform(win),
                    compress="deflate", predictor=3, tiled=True,
                    blockxsize=512, blockysize=512)
        with rasterio.open(out_path, "w", **prof) as dst:
            dst.write(arr, 1)
        valid = arr != src.nodata
        print(f"{name}: clipped {arr.shape[1]}x{arr.shape[0]}, "
              f"{valid.mean()*100:.1f}% valid, "
              f"range {arr[valid].min():.1f}..{arr[valid].max():.1f} m "
              f"({os.path.getsize(out_path)/1048576:.0f} MB)")
        kept.append(name)
        src.close()
    prov = {
        "files": [f"{n}_clip.tif" for n in kept],
        "source": "Bay of Plenty - Waihi Beach and Tauranga Coastal LiDAR 2m DEM (2025)",
        "publisher": "Toitu Te Whenua Land Information New Zealand, nz-coastal open S3 bucket",
        "obtained_via": "keyless /vsicurl/ windowed read of the public COGs, clipped to project bbox",
        "stac_collection": f"{base}/collection.json",
        "capture_window": "2025-01-27 .. 2025-03-25 (same campaign window as hydro survey HS79)",
        "bbox_wgs84": {"west": WEST, "south": SOUTH, "east": EAST, "north": NORTH},
        "native_crs": "EPSG:2193", "resolution_m": 2.0, "nodata": -9999.0,
        "vertical_datum": "NZVD2016, metres, positive UP (topo-bathy LiDAR; deep channels are nodata)",
        "licence": "CC BY 4.0, attribution Toitu Te Whenua Land Information New Zealand",
        "fetched": FETCHED_AT,
    }
    with open(os.path.join(out_dir, "provenance.json"), "w") as f:
        json.dump(prov, f, indent=2)


if __name__ == "__main__":
    t0 = time.time()
    fetch_wfs(50672, os.path.join(BATHY, "hydro-contours"),
              "valdco: contour depth, metres below chart datum")
    fetch_wfs(50858, os.path.join(BATHY, "hydro-soundings"),
              "depth: sounding depth, metres below chart datum")
    clip_coastal()
    print(f"done in {time.time()-t0:.0f}s")
