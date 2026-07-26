#!/usr/bin/env python3
"""
Resample the NIWA Bay of Plenty 25m DTM onto the field grid.

The tif is EPSG:4326, and its actual returned extent (per its own transform) is
NOT the same as the requested bbox (ArcGIS exportImage padded the north/south
edges to keep square pixels in degrees) -- see sources/bathy/niwa/provenance.json.
It fully contains the field bbox in both axes, so we do a proper geo-coordinate
bilinear resample (source pixel coords computed from lon/lat, not a naive index
scale) onto the field's square P x P grid, equirectangular, row 0 = north,
bbox west=175.93 south=-37.79 east=176.37 north=-37.41 -- the same convention as
drying-height.png / citylights.png / field-v2.png.

Output: prototype/data/niwa-elevation-raw.f32 -- raw float32, row-major, P*P
samples, metres (negative = underwater depth, positive = land elevation),
bilinear-resampled, NO other processing. Node (prep-field3.mjs) does the
depth-curve mapping, land/water split and feathered blend with the old proxy.
"""
import sys
import numpy as np
import rasterio
from scipy.ndimage import map_coordinates

P = int(sys.argv[1]) if len(sys.argv) > 1 else 4096
WEST, SOUTH, EAST, NORTH = 175.93, -37.79, 176.37, -37.41

src_path = 'sources/bathy/niwa/bop25m_dtm_tauranga_bbox.tif'
ds = rasterio.open(src_path)
band = ds.read(1).astype(np.float64)
t = ds.transform
# lon = t.c + (px+0.5)*t.a ;  lat = t.f + (py+0.5)*t.e   (t.e negative, row0=north)

# Target grid pixel centres, in lon/lat.
i = np.arange(P) + 0.5
j = np.arange(P) + 0.5
lon = WEST + (i / P) * (EAST - WEST)                # (P,)
lat = NORTH - (j / P) * (NORTH - SOUTH)              # (P,)  row0 = north
lon2d, lat2d = np.meshgrid(lon, lat)                 # (P,P) each

# Map to source (fractional) pixel coordinates.
src_px = (lon2d - t.c) / t.a - 0.5
src_py = (lat2d - t.f) / t.e - 0.5

assert src_px.min() >= -0.51 and src_px.max() <= ds.width - 0.49, \
    f'x out of bounds: {src_px.min()} {src_px.max()} vs width {ds.width}'
assert src_py.min() >= -0.51 and src_py.max() <= ds.height - 0.49, \
    f'y out of bounds: {src_py.min()} {src_py.max()} vs height {ds.height}'

out = map_coordinates(band, [src_py, src_px], order=1, mode='nearest')
out = out.astype(np.float32)

print(f'resampled {P}x{P}, elevation range {out.min():.2f} .. {out.max():.2f} m', file=sys.stderr)
print(f'underwater (elev<0) fraction: {(out < 0).mean():.4f}', file=sys.stderr)

out.tofile('prototype/data/niwa-elevation-raw.f32')
print('wrote prototype/data/niwa-elevation-raw.f32', file=sys.stderr)
