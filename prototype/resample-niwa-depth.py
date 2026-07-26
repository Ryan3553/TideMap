#!/usr/bin/env python3
"""
Resample the NIWA Bay of Plenty 25m DTM onto the field grid.

The tif is EPSG:4326, and its actual returned extent (per its own transform) is
NOT the same as the requested bbox (ArcGIS exportImage padded the north/south
edges to keep square pixels in degrees) -- see sources/bathy/niwa/provenance.json.
It fully contains the field bbox in both axes, so we do a proper geo-coordinate
resample (source pixel coords computed from lon/lat, not a naive index scale)
onto the field's square P x P grid, equirectangular, row 0 = north, bbox
west=175.93 south=-37.79 east=176.37 north=-37.41 -- the same convention as
drying-height.png / citylights.png / field-v2.png.

Round 2 (see research/overnight-2026-07-27/field-v3/README.md "round 2" note): the
original order=1 (bilinear) resample here left a faint but real period-~3-row
artifact in the output -- confirmed by direct measurement (FFT of the row-wise
second-difference peaks sharply at period 3.05-3.09 rows). Root cause: the source
tif's own 1547x1690 grid is upsampled onto the 4096x4096 field grid at a
near-integer, non-integer ratio (4096/1690 = 2.424 rows out per source row, same
order of magnitude on the column axis). Bilinear interpolation is exactly linear
*within* each source cell, so any run of ~2-3 consecutive output rows landing in
the same source cell are exactly collinear (zero curvature) while the next row,
crossing into the next cell, kinks -- a real piecewise-linear faceting artifact,
not sampling noise. It's small in the raw metres (~0.01-0.04m rms locally) and
invisible under a gentle linear read, but gets amplified by any steep/exponential
curve applied to the depth downstream (prep-field3.mjs's depth->G ease, and the
shader's cubed night-glow term) into a visible banded stripe over open water.

Fix: pre-smooth the source band with a small gaussian (sigma=0.75 source px, i.e.
~19m, well under one native 25m pixel -- removes the sharp per-cell linear facets
that the kink comes from, without perceptibly softening real bathymetric
features) and use a cubic spline (order=3, C2-continuous) instead of bilinear for
the final resample -- order=3 alone cuts the period-3 spectral energy by ~3x,
gaussian+order=3 together cut it by >25x (measured, see the README note) while
leaving open-water values within a few cm of the old bilinear ones. The geo-
registration (src_px/src_py computation from the tif's own affine transform) is
UNCHANGED from before -- only the interpolation method changed.

Output: prototype/data/niwa-elevation-raw.f32 -- raw float32, row-major, P*P
samples, metres (negative = underwater depth, positive = land elevation).
Node (prep-field3.mjs) does the depth-curve mapping, land/water split and
feathered blend with the old proxy.
"""
import sys
import numpy as np
import rasterio
from scipy.ndimage import map_coordinates, gaussian_filter

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

# Gaussian pre-filter (in source-pixel units) removes the sharp per-cell linear facets
# that a bilinear/low-order resample at this near-integer upsample ratio turns into a
# period-~3-row banding artifact (see module docstring "round 2"); order=3 cubic spline
# then gives a C2-continuous resample instead of order=1's piecewise-linear one.
band_smooth = gaussian_filter(band, sigma=0.75, mode='nearest')
out = map_coordinates(band_smooth, [src_py, src_px], order=3, mode='nearest')
out = out.astype(np.float32)

print(f'resampled {P}x{P}, elevation range {out.min():.2f} .. {out.max():.2f} m', file=sys.stderr)
print(f'underwater (elev<0) fraction: {(out < 0).mean():.4f}', file=sys.stderr)

out.tofile('prototype/data/niwa-elevation-raw.f32')
print('wrote prototype/data/niwa-elevation-raw.f32', file=sys.stderr)
