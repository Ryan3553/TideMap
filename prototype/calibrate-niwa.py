import numpy as np
from PIL import Image

P = 4096
WEST, SOUTH, EAST, NORTH = 175.93, -37.79, 176.37, -37.41

elev = np.fromfile('prototype/data/niwa-elevation-raw.f32', dtype=np.float32).reshape(P, P)
depth = np.maximum(0.0, -elev)

# isWater mask at native N=2600 grid (same bbox), nearest-resampled to P for stats.
dh = np.array(Image.open('prototype/data/drying-height.png'))   # uint16, N x N
hm = np.array(Image.open('prototype/data/harbour-mask.png'))    # uint8,  N x N
N = dh.shape[0]
isWater_native = (dh == 0) | ((dh != 0) & (dh != 65535) & (hm < 128))
inHarbourPoly = hm >= 128

# resample both (nearest) to P for direct index alignment with the niwa array
def nearest_resize(a, P):
    idx = (np.arange(P) * (a.shape[0] / P)).astype(np.int64)
    idx = np.clip(idx, 0, a.shape[0]-1)
    return a[idx][:, idx]

isWater = nearest_resize(isWater_native, P)
inHarbour = nearest_resize(inHarbourPoly, P)

def lonlat_to_px(lon, lat):
    i = (lon - WEST) / (EAST - WEST) * P
    j = (NORTH - lat) / (NORTH - SOUTH) * P
    return int(i), int(j)

pts = {
    'mid shipping channel (Stella Passage/entrance)': (176.1830, -37.6520),
    'harbour flat (Otumoetai/Matua)': (176.0700, -37.6650),
    '1km offshore (off Mt Maunganui beach)': (176.2010, -37.6280),
    '5km offshore': (176.2500, -37.6000),
}
print('--- sample points ---')
for name, (lon, lat) in pts.items():
    pi, pj = lonlat_to_px(lon, lat)
    e = elev[pj, pi]
    print(f'{name:45s} lon={lon:.4f} lat={lat:.4f} px=({pi},{pj})  elev={e:8.2f}m  depth={max(0,-e):7.2f}m  water={bool(isWater[pj,pi])} harbourPoly={bool(inHarbour[pj,pi])}')

print()
print('--- depth distribution, all water pixels ---')
w = depth[isWater]
for pct in [5,10,25,50,75,90,95,99]:
    print(f'  p{pct:2d} = {np.percentile(w,pct):.2f} m')
print(f'  mean={w.mean():.2f} max={w.max():.2f}')

print()
print('--- depth distribution, harbour-interior water pixels (inside harbour polygon) ---')
hw = depth[isWater & inHarbour]
for pct in [5,10,25,50,75,90,95,99]:
    print(f'  p{pct:2d} = {np.percentile(hw,pct):.2f} m')
print(f'  mean={hw.mean():.2f} max={hw.max():.2f} n={hw.size}')

print()
print('--- depth distribution, open-sea water pixels (outside harbour polygon) ---')
sw = depth[isWater & ~inHarbour]
for pct in [5,10,25,50,75,90,95,99]:
    print(f'  p{pct:2d} = {np.percentile(sw,pct):.2f} m')
print(f'  mean={sw.mean():.2f} max={sw.max():.2f} n={sw.size}')
