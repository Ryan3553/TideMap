# Wave 2a — `field-v3.png`, the 16-bit height field + real-bathymetry depth proxy

Builds `prototype/data/field-v3.png` per the J3 diagnosis
(`research/overnight-2026-07-27/smoothness/README.md`). Did not touch
`prototype/template-v2.html` or `prototype/look.mjs` (wave-2b shader agent's territory) or
`prep-field.mjs` (untouched, `field-v2.png` still builds from it unchanged).

## Method

### R + A — 16-bit drying height

`prototype/prep-field3.mjs`, modelled on `prep-field.mjs` but keeping height as `Float32Array`
the whole way through instead of quantizing to 8 bits before resize/blur (that early
quantization was the entire J3 bug):

1. Build `H` (float32, metres) from `data/drying-height.png` (16-bit source, read via
   `pipeline/lib/png16.mjs` `decodeGray16` — never touched by `sharp`'s 8-bit paths) — identical
   logic to `prep-field.mjs` (subtidal/supratidal sentinels, harbour-mask override for
   glint/surf outside the harbour).
2. 3×3 median directly on the `Float32Array` (hand-rolled, no sharp round-trip).
3. Mitchell-Netravali (B=C=1/3) separable resample 2600→4096, hand-rolled (sharp's raw 8-bit
   buffers were never used for this step).
4. Separable gaussian blur, σ=1.1 output px, hand-rolled.
5. Quantize **once**, at the very end: `code16 = round(clamp((h-H_LO)/(H_HI-H_LO),0,1)*65535)`,
   `R = code16>>8`, `A = code16&255`. `H_LO=-0.75, H_HI=3.25` (unchanged).
6. Assemble the final RGBA buffer by hand (a plain `Buffer`, never passed through any sharp op
   that reads/writes pixel values) and write it with `sharp(buf,{raw:...}).png()` — that call
   only encodes already-quantized bytes, it doesn't touch them.

### G — hybrid real/proxy depth

`prototype/resample-niwa-depth.py` (rasterio + scipy — sharp/JS can't read GeoTIFF) reprojects
`sources/bathy/niwa/bop25m_dtm_tauranga_bbox.tif` onto the field's exact equirectangular grid.
**Important finding**: the tif's *actual* extent (from its own `transform`, EPSG:4326) is
**not** the requested bbox — ArcGIS's `exportImage` padded north/south to keep square degree
pixels (actual bounds `175.930,-37.8403` to `176.370,-37.3597`, vs the requested/field bbox
`175.93,-37.79` to `176.37,-37.41`). It fully contains the field bbox on both axes, so this is
a proper geo-coordinate bilinear resample (`scipy.ndimage.map_coordinates`, using each field
pixel's true lon/lat mapped through the tif's own affine transform), not a naive index scale.
Output: `prototype/data/niwa-elevation-raw.f32` (float32, metres, negative = underwater),
which `prep-field3.mjs` treats as a plain data input.

`prep-field3.mjs` then:
- `depth = max(0, -elevation)` where `elevation < -0.05m` (confidently underwater); elsewhere
  treated as NIWA-invalid (land, or too close to 0 to trust).
- Maps depth → G via a two-segment ease, tuned against real sampled points and the depth
  distribution inside the harbour polygon (see calibration below):
  ```
  depth < 15m:  G = 0.5 * (depth/15)^0.6
  depth >= 15m: G = 0.5 + 0.5*smoothstep(15, 40, depth)
  ```
- Falls back to `field-v2.png`'s existing chamfer-distance G everywhere NIWA is invalid, blended
  via an 8px-blurred alpha mask built from the NIWA valid/invalid boundary (so the seam — which
  does not line up with the drying-height-derived shoreline exactly, since it's a different
  source — fades smoothly instead of snapping).

`prototype/calibrate-niwa.py` is the exploration script used to pick the curve's breakpoints
(percentile depth stats inside/outside the harbour polygon, and to find real coordinates for
"mid shipping channel" — the deepest contiguous water inside the harbour polygon south of the
entrance scour hole — rather than guessing at map coordinates).

### B — city lights

`prototype/data/citylights.png` verbatim (asserted 4096×4096×1 before use).

## Verification

### 1. 16-bit round trip (numbers)

`prep-field3.mjs` decodes the PNG it just wrote and compares every pixel's reconstructed height
against the float field right before quantization:

```
max abs error   0.0305 mm
mean abs error  0.00167 mm
tolerance       0.0616 mm  (4m / 65535 * 1.01)
result: PASS
```

0.0305mm is essentially the theoretical max rounding error of a single quantize-to-nearest step
(half an LSB = 4m/65535/2 = 0.0305mm) — i.e. quantization is happening exactly once, at the end,
as required. `prototype/verify-field3.mjs` independently re-checks every R/A pair decodes to a
value in `[0, 65535]` (hi/lo pack self-consistency).

### 2. Quantization/plateau fix, directly measured

Same crop and methodology as the J3 diagnosis (`smoothness/field-plateau-stats.mjs`:
`zoom=0.10 cx=0.235 cy=0.40`, 595×411px busy-flat crop), largest single contiguous quantized
code, intertidal pixels only (water/land sentinels excluded):

| field | codes in crop | largest single code | % of intertidal area |
|---|---|---|---|
| `field-v2.png` (8-bit R, live before this change) | 256 total (incl. land sentinel) | 102,224 px | **41.8%** (all-inclusive; dominated by the land sentinel) |
| `data/drying-height.png` (native 16-bit source, N=2600) | 582 | 4,824 px | **9.2%** |
| **`field-v3.png` (16-bit R/A, this deliverable, P=4096)** | 36,527 | 7,674 px | **5.2%** |

`field-v3` beats even the native 16-bit source's plateau size — expected, since it's resampled
to a finer P=4096 grid with a small gaussian blur, both of which further break up flat runs. The
dominant cause of the tide-pop bug (one 8-bit code covering up to 42% of a crop, flipping state
all at once) is gone. (`prototype/verify-field3-plateau.mjs`, run from `prototype/`.)

### 3. G-channel sample table (old field-v2 proxy vs new field-v3 hybrid)

| location | old G (0-255) | new G (0-255) | depth (NIWA, m) |
|---|---|---|---|
| mid shipping channel (176.181E, 37.6475S) | 1 | **129** | 16.46 |
| harbour flat (176.0769E, 37.647S) | 15 | 8 | 0.17 |
| 1km offshore (176.201E, 37.628S) | 14 | **129** | 16.17 |
| 5km offshore (176.25E, 37.60S) | 255 | 244 | 35.41 |

The flat and far-offshore points land close to the old proxy (as intended — no regression at
the extremes the old proxy already got right). The two mid-range points are where the fix
actually matters: the old chamfer-distance proxy reads the shipping channel and the sampled
"1km offshore" point as **shallower than the shore flat** (values 1 and 14, both below the
flat's 15) — an artifact of measuring distance-to-nearest-shore rather than real depth (a
narrow, deep channel close to land reads as "close to shore" = "shallow" under that method,
exactly the analogous failure mode J2 found in the old city-lights heuristic). The new hybrid
correctly reads both as substantially deeper (129, matching their real ~16m NIWA depth) while
preserving the correct coarse ordering everywhere else (flat < mid-depths < 5km-offshore-deep).

Depth→G curve calibration (`calibrate-niwa.py`) against the harbour's real depth distribution:
harbour-interior water pixels have depth p50=1.0m, p90=5.9m, p99=14.2m — i.e. genuinely mostly
very shallow, with the channel/basin tail extending to ~15-31m — which is what the two-segment
curve's 15m breakpoint targets.

### 4. Visual check (rendered previews, `research/overnight-2026-07-27/field-v3/`)

- `preview-R-height.png` / `crop-R-height.png` — reconstructed height, remapped to the same
  0-255 display range as before. Smooth gradient, no banding/plateau blockiness (the crop shows
  the water/land antialiased edge and continuous grey ramps across the flats).
- `preview-G-bathy.png` vs `preview-G-bathy-OLD-v2.png`, and `crop-G-bathy-new.png` vs
  `crop-G-bathy-old.png` (crop over the harbour entrance/port area) — the new G channel shows
  visible fine snaking channel structure inside the harbour (the dredged shipping channel
  threading toward the port) that the old chamfer proxy does not have at all (old proxy inside
  the harbour is almost uniformly near-black except for coarse shoreline-distance blobs).
- `preview-B-citylights.png` / `crop-B-citylights.png` — CBD and Mount Maunganui read as the
  brightest features, roads thread through as fainter filaments, matching J2's verification.

### 5. File size

`prototype/data/field-v3.png` = **7,690 kB** (~7.5 MB) — well under the ~25MB acceptable ceiling
flagged in the brief, despite the A channel carrying effectively-noisy low-byte data (PNG's
deflate still compresses it reasonably; RGBA/8bpc at 4096² gives a 64MB raw upper bound, so this
is a good compression ratio, not a red flag).

## Files

- `prototype/prep-field3.mjs` — the generator (reproducible one-shot; run from `prototype/`:
  `node prep-field3.mjs [P]`, defaults P=4096). Requires
  `prototype/data/niwa-elevation-raw.f32` to exist first (see below).
- `prototype/resample-niwa-depth.py` — reprojects the NIWA GeoTIFF onto the field grid; run
  from repo root: `python prototype/resample-niwa-depth.py 4096`. Requires `rasterio` + `scipy`
  (both present in this environment; confirmed via `python -c "import rasterio"`).
- `prototype/calibrate-niwa.py` — exploration/calibration script used to pick real sample
  coordinates and the depth→G curve's breakpoints (not part of the build, kept for
  reproducibility of the design decisions above).
- `prototype/verify-field3.mjs` — round-trip self-check, G-channel sample table, channel preview
  PNG renderer. Run from `prototype/`: `node verify-field3.mjs`.
- `prototype/verify-field3-plateau.mjs` — the plateau-size measurement in table §2 above. Run
  from `prototype/`: `node verify-field3-plateau.mjs`.
- `prototype/data/field-v3.png`, `prototype/data/field-v3.json` — the deliverable and its
  provenance/encoding doc (channel layout, height pack/unpack formula, depth-proxy curve,
  explicit warning to the shader agent about the hi/lo hardware-bilinear trap).
- `prototype/data/niwa-elevation-raw.f32` — intermediate NIWA depth grid (float32, P×P,
  regenerate with `resample-niwa-depth.py`, not otherwise committed-significant on its own).
- This README, and the six preview/crop PNGs alongside it.

## Notes / assumptions for the wave-2b shader agent

- Channel layout and unpack formula are exactly as specified in the J3 README and mirrored in
  `field-v3.json` — `code16 = R*256 + A`, `h = H_LO + (code16/65535)*(H_HI-H_LO)`,
  `H_LO=-0.75, H_HI=3.25`. **Sample the field texture NEAREST/NEAREST and decode-then-blend
  manually** — hardware bilinear on the raw R/A bytes is wrong at every high-byte carry (see the
  J3 README §B for the exact shader code pattern; not implemented here per the wave-2a/2b split).
- G's *meaning* is unchanged (still "bathymetric depth proxy, higher = deeper/more open water",
  still explicitly a proxy, not a chart-datum depth measurement, even where it's NIWA-derived —
  the NIWA DTM's vertical datum is ~MSL, not LAT/chart datum, and was not reconciled here) — no
  shader-side changes should be needed for G's role in existing rendering logic, only the values
  themselves are (in the channel/harbour-basin areas) meaningfully different from field-v2.
- B is bit-identical in source (`citylights.png`) to what a future round would have wired in
  anyway; this doesn't change J2's "not yet wired into the shader" status — field-v3 *is* that
  wiring, for the B channel specifically.
