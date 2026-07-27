#!/usr/bin/env python3
"""
Merge every real bathymetry source the keys currently reach into one elevation
grid for the renderer: prototype/data/depth-composite-raw.f32.

Same contract as niwa-elevation-raw.f32 (which prep-field3.mjs consumed until
now): P x P float32, row-major, row 0 = north, equirectangular over the project
bbox, metres relative to LOCAL MSL, negative = underwater. Keeping the MSL
reference keeps prep-field3.mjs's depth->G curve tuning valid unchanged.

Sources, in priority order where they overlap:

  1. Coastal LiDAR 2m DEM (2025)   sources/bathy/coastal2m/*.tif
     NZVD2016 -> MSL via -0.12 m (LINZ: MSL sits ~0.12 m above NZVD2016 zero in
     the Bay of Plenty). Real 2 m measurement wherever the green laser reached:
     flats, shallows, and a surprising amount of channel floor. Downsampled to
     the grid with nodata-aware block AVERAGING (this is a ~5x downsample; the
     round-2 smooth-then-cubic lesson applies to upsampling, not here), and a
     cell only counts where >= 30% of its 2 m samples are valid.
  2. Hydro chart vectors            sources/bathy/hydro-{contours,soundings}/
     Depth contours (valdco 0..20) + soundings, metres below chart datum,
     CD -> MSL via -1.107 m (mean tide level computed from the LINZ Tauranga
     tide tables in sources/tides/, this repo's own datum). Interpolated
     (linear, Delaunay) into a surface, trusted only NEAR actual vector data
     (gaussian confidence over distance-to-nearest-point, ~250 m scale) and
     never on land (drying-height land sentinel gates it off) - chart data
     lives exactly where the LiDAR fades: the deep channels.
  3. NIWA 25 m DTM (background)     prototype/data/niwa-elevation-raw.f32
     Already ~MSL, already on this grid (run resample-niwa-depth.py first).
     Open ocean and anywhere neither better source reaches.

  0. HS79 Multibeam 2m (2024)       sources/bathy/multibeam2m/*.tif
     LDS layer 122679, exported 2026-07-27 once the key gained the Exports scope.
     Values are elevation relative to chart datum (approx LAT), negative down,
     float32, nodata +3.4e38. COVERAGE IS OFFSHORE ONLY: the survey band runs
     along the shelf from ~5 m to ~46 m below LAT and never enters the harbour -
     the harbour channels stay with the LiDAR + chart vectors. Highest priority
     where valid (hydro-survey grade, +-0.31 m). LAT -> MSL via -1.107 m.

Usage: python build-depth-composite.py [P=4096]
Debug: DEBUG_DUMP=1 writes research/overnight-2026-07-27/bathy/composite-*.png
"""
import json
import os
import sys

import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds as tf_from_bounds
from scipy.interpolate import LinearNDInterpolator
from scipy.ndimage import gaussian_filter, distance_transform_edt, zoom
from scipy.spatial import cKDTree

P = int(sys.argv[1]) if len(sys.argv) > 1 else 4096
WEST, SOUTH, EAST, NORTH = 175.93, -37.79, 176.37, -37.41
MSL_ABOVE_CD = 1.107      # mean of all HW/LW in sources/tides/tauranga_*.csv
MSL_ABOVE_NZVD = 0.12     # LINZ Bay of Plenty sea surface topography
LIDAR_MIN_COVER = 0.30
VEC_CONF_M = 250.0        # gaussian scale of chart-vector trust, metres
DEG_LON_M = 111320 * np.cos(np.deg2rad(37.6))   # ~88,190 m/deg
DEG_LAT_M = 110950.0

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BATHY = os.path.join(ROOT, "sources", "bathy")
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

dst_transform = tf_from_bounds(WEST, SOUTH, EAST, NORTH, P, P)
dst_crs = "EPSG:4326"

# ---------------------------------------------------------------- 3. NIWA base
niwa_path = os.path.join(DATA, "niwa-elevation-raw.f32")
if not os.path.exists(niwa_path):
    sys.exit("missing data/niwa-elevation-raw.f32 - run: python resample-niwa-depth.py %d" % P)
e = np.fromfile(niwa_path, dtype=np.float32).reshape(P, P).astype(np.float64)
src_id = np.zeros((P, P), dtype=np.uint8)  # 0=NIWA 1=vectors 2=LiDAR (debug map)
print(f"NIWA base: range {e.min():.1f}..{e.max():.1f} m MSL")

# ------------------------------------------------------------- 1. LiDAR 2m DEM
lidar = np.full((P, P), np.nan)
cover = np.zeros((P, P))
for name in ["BC36", "BD36", "BD37"]:
    p = os.path.join(BATHY, "coastal2m", f"{name}_clip.tif")
    with rasterio.open(p) as src:
        arr = src.read(1)
        valid = arr != src.nodata
        vals = np.where(valid, arr, 0.0).astype(np.float64)
        vmask = valid.astype(np.float64)
        d_val = np.full((P, P), np.nan)
        d_msk = np.full((P, P), 0.0)
        # sum-preserving average: reproject value*mask and mask separately, divide
        reproject(vals, d_val, src_transform=src.transform, src_crs=src.crs,
                  dst_transform=dst_transform, dst_crs=dst_crs,
                  resampling=Resampling.average, src_nodata=None, dst_nodata=np.nan)
        reproject(vmask, d_msk, src_transform=src.transform, src_crs=src.crs,
                  dst_transform=dst_transform, dst_crs=dst_crs,
                  resampling=Resampling.average, src_nodata=None, dst_nodata=0.0)
        got = np.isfinite(d_val) & (d_msk > 0)
        est = np.where(got, d_val / np.maximum(d_msk, 1e-9), np.nan)
        take = got & (d_msk > cover)          # disjoint sheets; keep best coverage
        lidar[take] = est[take]
        cover[take] = d_msk[take]
        print(f"LiDAR {name}: contributes {take.sum()} cells")
lidar_valid = np.isfinite(lidar) & (cover >= LIDAR_MIN_COVER)
lidar_msl = lidar - MSL_ABOVE_NZVD
print(f"LiDAR: {lidar_valid.mean()*100:.1f}% of grid at >= {LIDAR_MIN_COVER:.0%} coverage, "
      f"range {np.nanmin(np.where(lidar_valid, lidar_msl, np.nan)):.1f}.."
      f"{np.nanmax(np.where(lidar_valid, lidar_msl, np.nan)):.1f} m MSL")

# --------------------------------------------------------- 2. chart vector surface
def load_points():
    pts, vals = [], []
    with open(os.path.join(BATHY, "hydro-contours", "layer-50672.geojson")) as f:
        cont = json.load(f)
    for ft in cont["features"]:
        d = ft["properties"].get("valdco")
        if d is None:
            continue
        g = ft["geometry"]
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        for line in lines:
            prev = None
            for lon, lat in (c[:2] for c in line):
                # densify long segments so straight channel walls carry weight
                if prev is not None:
                    seg_m = np.hypot((lon - prev[0]) * DEG_LON_M, (lat - prev[1]) * DEG_LAT_M)
                    n_add = int(seg_m // 60)
                    for k in range(1, n_add + 1):
                        t = k / (n_add + 1)
                        pts.append((prev[0] + (lon - prev[0]) * t, prev[1] + (lat - prev[1]) * t))
                        vals.append(d)
                pts.append((lon, lat)); vals.append(d)
                prev = (lon, lat)
    n_cont = len(pts)
    with open(os.path.join(BATHY, "hydro-soundings", "layer-50858.geojson")) as f:
        snd = json.load(f)
    for ft in snd["features"]:
        d = ft["properties"].get("depth")
        if d is None:
            continue
        lon, lat = ft["geometry"]["coordinates"][:2]
        pts.append((lon, lat)); vals.append(d)
    print(f"chart vectors: {n_cont} contour pts (densified), {len(pts)-n_cont} soundings")
    return np.array(pts), np.array(vals, dtype=np.float64)

pts, depths_cd = load_points()
vec_msl = -depths_cd - MSL_ABOVE_CD          # depth below CD -> elevation vs MSL

# interpolate on a half-res grid then smooth-then-cubic upsample (round-2 lesson)
Q = P // 2
qlon = WEST + (np.arange(Q) + 0.5) / Q * (EAST - WEST)
qlat = NORTH - (np.arange(Q) + 0.5) / Q * (NORTH - SOUTH)
qlon2, qlat2 = np.meshgrid(qlon, qlat)
interp = LinearNDInterpolator(pts, vec_msl)
vec_q = interp(qlon2, qlat2)                  # nan outside convex hull
print(f"vector surface (at {Q}px): {np.isfinite(vec_q).mean()*100:.1f}% inside hull")

# confidence: gaussian of distance to nearest chart point (in metres)
tree = cKDTree(np.column_stack([pts[:, 0] * DEG_LON_M, pts[:, 1] * DEG_LAT_M]))
qd, _ = tree.query(np.column_stack([qlon2.ravel() * DEG_LON_M, qlat2.ravel() * DEG_LAT_M]),
                   workers=-1)
conf_q = np.exp(-(qd.reshape(Q, Q) / VEC_CONF_M) ** 2)
# fade trust out BEFORE the convex-hull edge, or the surface cuts off in a hard
# straight seam right where extreme data points sit on the hull boundary
hull_mask = np.isfinite(vec_q).astype(np.float64)
conf_q *= np.clip(gaussian_filter(hull_mask, 5.0) * 1.25 - 0.25, 0, 1)
conf_q[~np.isfinite(vec_q)] = 0.0
vec_q = np.where(np.isfinite(vec_q), vec_q, 0.0)

vec_full = zoom(gaussian_filter(vec_q, 0.75), P / Q, order=3, mode="nearest")
conf_full = np.clip(zoom(gaussian_filter(conf_q, 0.75), P / Q, order=3, mode="nearest"), 0, 1)

# never trust interpolation across land: gate by the drying-height land sentinel
from PIL import Image  # only for reading the 16-bit mask cheaply
Image.MAX_IMAGE_PIXELS = None
dh = np.array(Image.open(os.path.join(DATA, "drying-height.png")))
land = (dh == 65535).astype(np.float64)
land_p = zoom(land, P / dh.shape[0], order=1, mode="nearest")
conf_full *= np.clip(1.0 - land_p * 1.5, 0, 1)

# ------------------------------------------------------------------ merge
w_vec = conf_full
e = e * (1 - w_vec) + vec_full * w_vec
src_id[w_vec > 0.5] = 1

w_lid = gaussian_filter(lidar_valid.astype(np.float64), 4.0)  # feather the seam (~38 m)
w_lid[~lidar_valid & (w_lid < 0.5)] = 0.0
lid_fill = np.where(lidar_valid, lidar_msl, 0.0)
# fill feather ring values from nearby valid LiDAR so the blend never reads zeros
ring = (w_lid > 0) & ~lidar_valid
if ring.any():
    idx = distance_transform_edt(~lidar_valid, return_indices=True, return_distances=False)
    lid_fill[ring] = lidar_msl[idx[0][ring], idx[1][ring]]
e = e * (1 - w_lid) + lid_fill * w_lid
src_id[w_lid > 0.5] = 2

# ------------------------------------------------- 0. HS79 multibeam 2m (highest priority)
MB_PATH = os.path.join(BATHY, "multibeam2m",
                       "Bay of Plenty Multibeam 2m Depth Model (2024).tif")
if os.path.exists(MB_PATH):
    mb = np.full((P, P), np.nan)
    mb_cov = np.zeros((P, P))
    with rasterio.open(MB_PATH) as src:
        arr = src.read(1)
        valid = np.abs(arr) < 1e30
        vals = np.where(valid, arr, 0.0).astype(np.float64)
        vmask = valid.astype(np.float64)
        d_val = np.full((P, P), np.nan)
        d_msk = np.full((P, P), 0.0)
        reproject(vals, d_val, src_transform=src.transform, src_crs=src.crs,
                  dst_transform=dst_transform, dst_crs=dst_crs,
                  resampling=Resampling.average, src_nodata=None, dst_nodata=np.nan)
        reproject(vmask, d_msk, src_transform=src.transform, src_crs=src.crs,
                  dst_transform=dst_transform, dst_crs=dst_crs,
                  resampling=Resampling.average, src_nodata=None, dst_nodata=0.0)
        got = np.isfinite(d_val) & (d_msk > 0)
        mb[got] = d_val[got] / np.maximum(d_msk[got], 1e-9)
        mb_cov[got] = d_msk[got]
    mb_valid = np.isfinite(mb) & (mb_cov >= LIDAR_MIN_COVER)
    mb_msl = mb - MSL_ABOVE_CD                      # LAT-referenced elevation -> MSL
    # datum sanity: multibeam vs what the composite already believes, in the overlap
    ov = mb_valid & (e < -2)
    if ov.sum() > 1000:
        d = (mb_msl - e)[ov]
        print(f"datum cross-check (multibeam minus composite, {ov.sum()} px): "
              f"median {np.median(d):+.2f} m, IQR {np.percentile(d,25):+.2f}..{np.percentile(d,75):+.2f}")
    w_mb = gaussian_filter(mb_valid.astype(np.float64), 4.0)
    w_mb[~mb_valid & (w_mb < 0.5)] = 0.0
    mb_fill = np.where(mb_valid, mb_msl, 0.0)
    ring = (w_mb > 0) & ~mb_valid
    if ring.any():
        idx = distance_transform_edt(~mb_valid, return_indices=True, return_distances=False)
        mb_fill[ring] = mb_msl[idx[0][ring], idx[1][ring]]
    e = e * (1 - w_mb) + mb_fill * w_mb
    src_id[w_mb > 0.5] = 3
    print(f"multibeam: {mb_valid.mean()*100:.1f}% of grid, "
          f"range {np.nanmin(np.where(mb_valid, mb_msl, np.nan)):.1f}.."
          f"{np.nanmax(np.where(mb_valid, mb_msl, np.nan)):.1f} m MSL")
else:
    print("multibeam: not on disk, skipped")

# ------------------------------------------------------------------ checks
# datum sanity: LiDAR vs chart vectors where both confident and underwater
both = lidar_valid & (conf_full > 0.6) & (lidar_msl < -1.5) & (vec_full < -1.5)
if both.sum() > 100:
    diff = (lidar_msl - vec_full)[both]
    print(f"datum cross-check (LiDAR minus chart, {both.sum()} px underwater): "
          f"median {np.median(diff):+.2f} m, IQR {np.percentile(diff,25):+.2f}..{np.percentile(diff,75):+.2f}")

def transect(label, lon0, lat0, lon1, lat1, n=24):
    ii = np.linspace(0, 1, n)
    lons = lon0 + (lon1 - lon0) * ii
    lats = lat0 + (lat1 - lat0) * ii
    xs = ((lons - WEST) / (EAST - WEST) * P).astype(int).clip(0, P - 1)
    ys = ((NORTH - lats) / (NORTH - SOUTH) * P).astype(int).clip(0, P - 1)
    print(f"transect {label}: " + " ".join(f"{e[y, x]:.1f}" for x, y in zip(xs, ys)))

transect("entrance N-S", 176.171, -37.630, 176.171, -37.660)
transect("western channel E-W", 176.02, -37.62, 176.08, -37.62)

src_counts = [(src_id == k).mean() * 100 for k in (0, 1, 2, 3)]
print(f"source map: NIWA {src_counts[0]:.1f}%  chart-vectors {src_counts[1]:.1f}%  "
      f"LiDAR {src_counts[2]:.1f}%  multibeam {src_counts[3]:.1f}%")
print(f"composite range: {e.min():.1f}..{e.max():.1f} m MSL, underwater fraction {(e < 0).mean():.3f}")

e.astype(np.float32).tofile(os.path.join(DATA, "depth-composite-raw.f32"))
print("wrote data/depth-composite-raw.f32")

with open(os.path.join(DATA, "depth-composite.json"), "w") as f:
    json.dump({
        "description": "Composite real-bathymetry elevation grid, metres vs local MSL, negative underwater. Priority: coastal LiDAR 2m (2025) > chart contours+soundings (near data only) > NIWA 25m DTM. Built by build-depth-composite.py; see sources/bathy/*/provenance.json.",
        "grid": {"P": P, "bbox": [WEST, SOUTH, EAST, NORTH], "row0": "north"},
        "datums": {"msl_above_chart_datum_m": MSL_ABOVE_CD,
                   "msl_above_nzvd2016_m": MSL_ABOVE_NZVD,
                   "note": "MSL_ABOVE_CD computed as the mean of all HW/LW heights in sources/tides/tauranga_*.csv (mean tide level, 2023-2027); LINZ's published MSL-CD for Tauranga is 1.14 m - the 3 cm gap is MTL-vs-MSL and does not matter at channel depths"},
        "multibeam": "LDS 122679 HS79 multibeam 2m (LAT datum) integrated as priority 0 where valid - offshore shelf band only (~5..46 m below LAT); the harbour interior is not in the survey",
    }, f, indent=2)

if os.environ.get("DEBUG_DUMP"):
    out_dir = os.path.join(ROOT, "research", "overnight-2026-07-27", "bathy")
    dep = np.clip(-e, 0, 30) / 30
    img = (np.stack([dep, np.where(src_id == 1, 0.5 + dep * 0.5, dep),
                     np.where(src_id == 2, 0.5 + dep * 0.5, dep)], -1) * 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(out_dir, "composite-depth-srcmap.png"))
    Image.fromarray((dep * 255).astype(np.uint8)).save(os.path.join(out_dir, "composite-depth.png"))
    print("debug dumps written")
