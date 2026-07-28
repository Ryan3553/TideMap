#!/usr/bin/env python3
"""
Fetch LDS layer 122642 - Bay of Plenty - Tauranga LiDAR 1m DEM (2025), open CC BY 4.0,
via the Koordinates Export API (same mechanism already used for the HS79 multibeam,
LDS 122679 - see sources/bathy/multibeam2m/provenance.json). Clips to the intersection
of the layer's own coverage (lon 176.0145..176.4273, lat -37.6206..-37.8389) and the
project bbox (175.93..176.37, -37.79..-37.41), i.e. lon 176.01..176.37, lat -37.80..-37.61.

Native CRS EPSG:2193 (NZTM2000), vertical datum NZVD2016 (same as the coastal 2m DEM
already in sources/bathy/coastal2m/), 1 m resolution, kind "grid" -> export format
"image/tiff;subtype=geotiff".

Usage:  LINZ_KEY=<lds key>  python fetch-122642.py
"""
import io
import json
import os
import sys
import time
import urllib.request
import zipfile

LAYER = 122642
BASE = "https://data.linz.govt.nz/services/api/v1.x"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT_DIR = os.path.join(ROOT, "sources", "bathy", "coastal1m")
KEY = os.environ.get("LINZ_KEY")
if not KEY:
    sys.exit("LINZ_KEY env var required (LDS key, 32 hex chars)")

# intersection of layer coverage and project bbox, padded slightly for safety margin
WEST, SOUTH, EAST, NORTH = 176.01, -37.80, 176.37, -37.61

FETCHED_AT = time.strftime("%Y-%m-%d")


def api(url, data=None, method=None):
    headers = {"Authorization": f"key {KEY}", "User-Agent": "TideMap/1.0"}
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    marker = os.path.join(OUT_DIR, "provenance.json")
    if os.path.exists(marker):
        print("122642: already fetched (provenance.json exists), skipping")
        return

    resume_id = os.environ.get("EXPORT_ID")
    if resume_id:
        export_url = f"{BASE}/exports/{resume_id}/"
        created = api(export_url)
        export_id = created.get("id")
        print(f"resuming export id {export_id}: {export_url}")
    else:
        extent = {
            "type": "Polygon",
            "coordinates": [[
                [WEST, SOUTH], [WEST, NORTH], [EAST, NORTH], [EAST, SOUTH], [WEST, SOUTH],
            ]],
        }
        req_body = {
            "name": "tauranga-lidar-1m-122642-clip",
            "crs": "EPSG:2193",
            "formats": {"grid": "image/tiff;subtype=geotiff"},
            "items": [{"item": f"{BASE}/layers/{LAYER}/"}],
            "extent": extent,
        }
        print("submitting export job...")
        created = api(f"{BASE}/exports/", data=req_body)
        export_url = created["url"]
        export_id = created.get("id")
        print(f"export id {export_id}: {export_url}")

    state = created.get("state")
    t0 = time.time()
    while state not in ("complete", "error", "cancelled", "gone"):
        time.sleep(5)
        created = api(export_url)
        state = created.get("state")
        print(f"  ...{state} ({time.time()-t0:.0f}s)")
        if time.time() - t0 > 900:
            sys.exit("export job timed out after 900s")
    if state != "complete":
        sys.exit(f"export job ended in state={state}: {json.dumps(created)[:500]}")

    dl_url = created["download_url"]
    print(f"downloading {dl_url}")
    # the download endpoint 302s to a pre-signed S3 URL; requests strips Authorization on a
    # cross-host redirect automatically (urllib does not, and S3 400s on the stray header)
    import requests
    resp = requests.get(dl_url, headers={"Authorization": f"key {KEY}", "User-Agent": "TideMap/1.0"},
                         timeout=300, stream=True)
    resp.raise_for_status()
    chunks = []
    got = 0
    for chunk in resp.iter_content(chunk_size=1 << 20):
        chunks.append(chunk)
        got += len(chunk)
        if got % (50 << 20) < (1 << 20):
            print(f"  ...{got/1048576:.0f} MB")
    blob = b"".join(chunks)
    print(f"downloaded {len(blob)/1048576:.1f} MB")

    tif_files = []
    if zipfile.is_zipfile(io.BytesIO(blob)):
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            for name in z.namelist():
                out_path = os.path.join(OUT_DIR, os.path.basename(name))
                if os.path.basename(name) == "":
                    continue
                with z.open(name) as src, open(out_path, "wb") as dst:
                    dst.write(src.read())
                print(f"  extracted {os.path.basename(name)}")
                if name.lower().endswith(".tif") or name.lower().endswith(".tiff"):
                    tif_files.append(os.path.basename(name))
    else:
        out_path = os.path.join(OUT_DIR, "Bay of Plenty - Tauranga LiDAR 1m DEM (2025).tif")
        with open(out_path, "wb") as f:
            f.write(blob)
        tif_files.append(os.path.basename(out_path))
        print(f"  saved {os.path.basename(out_path)} (not a zip)")

    if not tif_files:
        sys.exit("no .tif found in export bundle")

    # inspect the downloaded tif for a quick sanity report
    import rasterio
    import numpy as np
    tif_path = os.path.join(OUT_DIR, tif_files[0])
    with rasterio.open(tif_path) as src:
        arr = src.read(1)
        nodata = src.nodata
        valid = np.isfinite(arr) & (arr != nodata) if nodata is not None else np.isfinite(arr)
        print(f"tif: {src.width}x{src.height}, crs={src.crs}, nodata={nodata}, "
              f"{valid.mean()*100:.1f}% valid, range {arr[valid].min():.2f}..{arr[valid].max():.2f}"
              if valid.any() else "tif: no valid pixels?!")
        prov_extra = {
            "grid": f"{src.width}x{src.height}",
            "bounds_native": list(src.bounds),
            "nodata": nodata,
            "valid_fraction": float(valid.mean()),
            "range_m": [float(arr[valid].min()), float(arr[valid].max())] if valid.any() else None,
        }

    prov = {
        "files": tif_files,
        "source": "LDS layer 122642 - Bay of Plenty - Tauranga LiDAR 1m DEM (2025)",
        "publisher": "Toitu Te Whenua Land Information New Zealand / 3D Coastal Mapping (survey by Woolpert Ltd for BOPLASS Ltd)",
        "obtained_via": "Koordinates export API (LDS key WITH Exports scope), key redacted",
        "request_used": (f"POST {BASE}/exports/ {{items:[layer 122642], formats:{{grid:'image/tiff;subtype=geotiff'}}, "
                          f"crs:'EPSG:2193', extent:bbox-polygon}}; poll; GET download_url"),
        "export_id": export_id,
        "bbox_wgs84_requested": {"west": WEST, "south": SOUTH, "east": EAST, "north": NORTH},
        "layer_native_extent_wgs84": {"west": 176.0145, "south": -37.8389, "east": 176.4273, "north": -37.6206},
        "native_crs": "EPSG:2193",
        "resolution_m": 1.0,
        "capture_window": "2025-02-12 .. 2025-03-02 (Woolpert Ltd for BOPLASS Ltd; same 2025 3D Coastal Mapping campaign as the 2m coastal DEM and HS79 multibeam)",
        "vertical_datum": "NZVD2016, metres, positive UP (topo-bathy LiDAR DEM; same datum/contract as sources/bathy/coastal2m)",
        "vertical_accuracy": "+/-0.2 m (95%)",
        "horizontal_accuracy": "+/-1.0 m (95%)",
        "licence": "CC BY 4.0, attribution Toitu Te Whenua Land Information New Zealand",
        "fetched": FETCHED_AT,
        "tif_inspection": prov_extra,
        "note": ("Priority slot: build-depth-composite.py integrates this ABOVE the 2m nz-coastal "
                 "LiDAR (sources/bathy/coastal2m) within this layer's own footprint only; the 2m "
                 "LiDAR + chart vectors + NIWA continue to cover everywhere outside it."),
    }
    with open(marker, "w") as f:
        json.dump(prov, f, indent=2)
    print(f"wrote {marker}")


if __name__ == "__main__":
    main()
