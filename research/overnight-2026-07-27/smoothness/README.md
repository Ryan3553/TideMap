# J3 — why the tide pops in sudden zones with outlines, and the fix

Diagnosis only (per delegation). All evidence rendered offline with `prototype/look.mjs`
(unmodified) against the live data files; nothing in `prototype/` was edited. Scripts used to
produce the evidence are in this folder (`diff-sweep.mjs`, `field-plateau-stats.mjs`) — copy
them next to `prototype/look.mjs` (or run with a relative `../research/...` path from
`prototype/`, they only need `sharp` and `pipeline/lib/png16.mjs`, both already present) to
reproduce. Rendered PNGs referenced below are in `evidence/`.

## Verdict, in one sentence

**The height field the shader reads is quantized to 8 bits over a 4 m range (15.7 mm/step),
so a fine tide sweep only has ~15 distinct heights to cross; whole flats share one step and
flip together the instant the tide crosses it.** The waterline's own rendering (antialiased
`submerged` mix, edge sheen, shore glow) is fine — the "outline" reading comes from that
already-correct boundary rendering being applied to a shape that appears/disappears as a whole
unit rather than growing continuously. A second, independent cause compounds it: the "damp
band" (freshly-exposed-flat tint) is built from two **hard `step()`** thresholds in
tide-height space, so on every ebb frame it paints a filled region with genuinely pixel-hard
edges — not smoothed by anything, not related to quantization at all. Edge sheen / shore glow
are minor contributors (soft, broad, ~10% of full-scale brightness) — they make the pop *read*
more like a shape with a rim once it has already popped, but they are not what makes it pop.

## 1. Quantization — the dominant cause, measured

`prep-field.mjs` line 27: `enc = h => round((h - H_LO)/(H_HI - H_LO) * 255)` — every height is
rounded to one of 256 codes across `H_LO=-0.75` to `H_HI=3.25` (4 m), **15.7 mm/step**, before
it ever reaches the resize/blur/PNG-write pipeline. `field-v2.png` is confirmed 8-bit
(`prototype/data/field-v2.png`, RGB, `gl.UNSIGNED_BYTE` upload at template-v2.html:414).

**Sweep test.** Rendered `zoom=0.18 cx=0.25 cy=0.35` → then a tighter, busier flat crop
(`zoom=0.10 cx=0.235 cy=0.40`, 1200×900) across `tide = 0.900 → 0.960` in 0.005 steps (13
frames, `t=0` fixed so the shimmer noise term contributes zero frame-to-frame diff — only tide
motion is measured). Consecutive frames differenced, changed-pixel counts and 4-connected blob
sizes computed (`diff-sweep.mjs`; raw output `evidence/diff-sweep-stats.txt`).

| step (tide→tide+0.005) | changed px | largest single blob | blob = % of changed |
|---|---|---|---|
| 0.900→0.905 (baseline) | 4,207 | 533 | 12.7% |
| 0.915→0.920 | 4,984 | 1,005 | 20.2% |
| **0.940→0.945 (pop)** | **14,558** | **4,414** | **30.3%** |
| **0.945→0.950 (pop)** | **14,198** | **3,556** | **25.0%** |
| 0.955→0.960 | 6,327 | 1,237 | 19.6% |

Two of the twelve 5 mm steps carry ~2× the changed-pixel mass of the others, in blobs 3–8×
larger than baseline. Diff masks make it visible directly:

- `evidence/diffmask_baseline_0.900to0.905.png` — a thin, scattered, curving line: the
  waterline creeping forward normally.
- `evidence/diffmask_POP_0.940to0.945.png` — the *same* thin line, **plus a large solid white
  blob** filling almost the entire visible flat: that whole shape flipped state in one 5 mm
  step.

**Why, quantitatively.** Sampled the actual R-channel codes of `field-v2.png` in this crop
(`field-plateau-stats.mjs`): the single most common 8-bit code covers **41.8% of the crop**
(102,224 of 244,545 px is the land sentinel; the largest *intertidal* code, R=108 → h=0.9441 m,
covers 5,354 px, with one contiguous blob of 2,213 texels ≈ 0.2 km² at native map scale). That
whole 0.2 km² patch is a single height value — it can only ever flip in one frame, at whatever
tide crosses 0.944 m, which lands inside the 0.940→0.945 window above. Compare the *native*
16-bit source (`data/drying-height.png`, confirmed 16-bit grayscale colour-type 0, 2600×2600):
same crop, largest single code is **9.2%** of the intertidal area — 4.5× less clustering.

Direct proof this is an encoding artefact and not real terrain flatness: binned the native
16-bit heights into the same twelve 5 mm windows and compared against the 8-bit-quantized
version of the identical data:

```
tideLo tideHi   16-bit source   8-bit-quantized
0.900  0.905         4               0
0.905  0.910        78               0
0.910  0.915        19             311
0.915  0.920       214               0
0.920  0.925       115               0
0.925  0.930       185             725
0.930  0.935       425               0
0.935  0.940      1459               0
0.940  0.945       274            2879
0.945  0.950       672               0
0.950  0.955       482               0
0.955  0.960        15             502
```

At native precision, every 5 mm window gets *some* pixels — a graded, if uneven, advance. At
8-bit precision, **9 of 12 windows get exactly zero** pixels because no 8-bit code happens to
land in them, and the other 3 windows absorb everything that rounded into them. This is the
literal mechanism of "sudden distinct zones which appear and disappear": between pops nothing
can move (no representable height in that tide range), then a whole quantum's worth of area
becomes representable at once.

## 2. The outline — mostly the pop itself, small assist from glow terms

Rendered the same frame (`tide=0.943`, at the pop) with `set='{"edgeGain":0,"shoreGlow":0,
"dampGain":0}'` vs all terms at default (`evidence/isolate_all_terms_on.png` vs
`evidence/isolate_edge_shore_damp_off.png`). **The pale rim around the newly-dry flat is
present in both** — it is not manufactured by edge sheen or shore glow, it is the ordinary
antialiased `submerged` water→ground colour transition, which necessarily traces a *complete*
boundary the instant a plateau's state flips. Confirmed the rim isn't baked into the base
imagery either: fully dry render (`tide=0.332`, same isolate flags,
`evidence/isolate_fully_dry_no_outline_in_base.png`) shows no rim at all on that flat.

Diffing "all glow terms on" vs "off" (`evidence/diff_edgeShoreGlow_contribution_x4.png`, values
×4 for visibility) shows edge sheen + shore glow contribute a **broad, soft gradient** (max
channel delta 27/255, mean 5/255) that fades gently outward from the waterline over tens of
metres — not a hard line. Their effect is real but secondary: once a plateau pops, these terms
light up in sync around its whole new perimeter simultaneously, which reinforces the "shape
with a rim just appeared" read, but they aren't drawing the line themselves.

## 3. The damp band — a second, independent hard-edge source

`template-v2.html:292-295` (mirrored in `look.mjs:93-96`):

```glsl
float ebb  = step(uTide+0.0004, uTidePast);
float band = ebb * step(uTide,H) * step(H,uTidePast);
float wet  = clamp(band*(1.0-(H-uTide)/max(uTidePast-uTide,1e-4))*uDampGain, 0.0, 1.0);
```

Both `step(uTide,H)` and `step(H,uTidePast)` are **hard thresholds in the continuous height
field** — this is a real edge irrespective of the field's bit depth; even a perfectly
continuous height would produce a pixel-sharp boundary here, because `step()` has zero
transition width. `uTidePast` is fed from JS as tide **110 minutes ago**
(`DAMP_MIN=110`, template-v2.html:580,597) continuously through Play mode whenever the tide is
ebbing — so this hard-edged band is not a rare glitch, it is drawn on essentially every ebb
frame.

Verified by rendering `tide=0.943 past=0.965` (a real ebb) with damp on vs `dampGain:0`
(`evidence/damp_band_ebb_on.png` / off) and differencing
(`evidence/diff_damp_hardEdge_x3.png`, ×3): the diff is a set of **filled regions with crisp
polygonal boundaries** — a textbook "zone with an outline," fully independent of the
quantization issue. This is the second concrete source of the complaint, and the fix for it
(smoothstep the two boundaries) is unrelated to the height-encoding fix and should ship
alongside it.

## The fix

### A. Field v3 — 16-bit height, split across two 8-bit channels

Pack the field texture as **RGBA** instead of RGB. Height moves from a single 8-bit `R` (256
codes / 15.7 mm step) to a 16-bit code split across `R` (high byte) and the new `A` (low byte)
— 65,536 codes / **0.061 mm step**, a 256× precision gain. `G` (bathy proxy) and `B` (city
lights) are unchanged in meaning and channel.

```
field-v3.png — RGBA, 8-bit/channel, same 4096×4096 (or current P) grid
  R  height code, high byte:  hi = floor(code16 / 256)
  G  bathymetric depth proxy — unchanged from field-v2 (chamfer distance, smoothstepped)
  B  city lights — unchanged from field-v2
  A  height code, low byte:   lo = code16 mod 256

  code16 = hi*256 + lo,  0..65535
  h = H_LO + (code16 / 65535) * (H_HI - H_LO)      // H_LO=-0.75, H_HI=3.25 metres, unchanged
```

**Encoder (`prep-field.mjs`) change.** The current code quantizes to 8 bits (`enc()`) *before*
median/resize/blur, at the native N=2600 grid — that is where the precision is actually lost
today, not at the final PNG write. The fix must keep height as a continuous `Float32Array`
through median → resize → blur, and only quantize to the 16-bit code at the very last step:

1. Build `H` (Float32, metres) exactly as today (prep-field.mjs:38-47) — this is already
   effectively full precision, sourced from the 16-bit `drying-height.png`
   (0.0381 mm/code native, confirmed 16-bit grayscale colour-type 0 via `sharp` metadata and
   `png16.mjs`'s own IHDR check).
2. 3×3 median on the **float** `H` (same rationale as today — isolated fit noise, not
   quantization noise now, but the median still helps) — implement directly on the
   `Float32Array` (own median, do **not** round-trip through sharp's 8-bit raw buffers, which
   is exactly what silently destroys the precision today).
3. Resize N×N → P×P (mitchell/bicubic) and blur (σ≈1.1 px at P=4096) — again on the **float**
   array, own implementation (separable resize + separable gaussian are both easy at this
   grid size). **Do not** pass through `sharp`'s 8-bit raw `.raw().toBuffer()` path at any
   intermediate step — that truncates back to 256 levels and reintroduces the exact bug being
   fixed. (`sharp`'s raw `depth:'ushort'` *input* path is already known broken here, per the
   comment atop `pipeline/lib/png16.mjs`; verify float raw round-trips correctly with a
   byte-for-byte round-trip test before trusting it for the resize step, or just do it by
   hand — the grid is only 2600→4096, this is cheap.)
4. Only now quantize: `code16 = round(clamp((H' - H_LO)/(H_HI - H_LO), 0, 1) * 65535)`, split
   `hi = code16 >> 8`, `lo = code16 & 255`.
5. Pack `RGBA = [hi, bathyByte, cityByte, lo]`, write as a normal 4-channel 8-bit PNG (no
   16-bit PNG trickery needed at this stage — `sharp`'s ordinary `.png()` writer is fine for
   plain 8-bit-per-channel RGBA).

### B. Shader sampling — manual bilinear reconstruction (the hi/lo trap)

**Do not** just upload the RGBA texture with `gl.LINEAR` and read `.r`/`.a` directly. WebGL's
bilinear filter blends each channel **independently as raw bytes**. At every texel pair that
straddles a high-byte carry (e.g. code16 0x01FF → hi=1,lo=255 next to code16 0x0200 → hi=2,
lo=0), independently-interpolated hi and lo bytes do **not** reconstruct a linearly
interpolated 16-bit value — `lo` swings 255→0 while `hi` swings 1→2, and blending gives a
value near the *middle* of the whole 16-bit range, not near the true boundary. This would
paint a bright sawtooth seam exactly at those texels — a new, uglier artifact than the one
being fixed. This is a well-known trap for packed multi-byte values under hardware filtering;
it must be worked around with **manual** bilinear:

1. Bind the field texture `NEAREST`/`NEAREST` (not `LINEAR`) so `texture2D` returns exact,
   undistorted texel bytes:
   ```js
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
   ```
   Add a `uFieldSize` uniform (`vec2(P, P)`, e.g. `4096.0,4096.0`) alongside it.

2. In the fragment shader, decode-then-blend (blend the **decoded floats**, never the raw
   bytes) — replace every existing `texture2D(uField, uv)` call (there are four call sites in
   `template-v2.html`'s FS today: the main sample at line 271, the 4-tap `bSoft` swell probe
   at 335-338, and the two gradient/tangent probes at 349,350,353) with this:

   ```glsl
   uniform vec2 uFieldSize;   // e.g. vec2(4096.0, 4096.0) — the field texture's pixel size

   // uField MUST be bound NEAREST/NEAREST. Packing a 16-bit height across two 8-bit channels
   // and letting the GPU's own bilinear blend those bytes independently produces a seam at
   // every high-byte carry (see README). So the bilinear happens HERE, by hand, on the
   // already-decoded height/bathy/city floats, never on the raw R/A bytes.
   vec3 fieldTexel(vec2 uv){                     // exact texel, decoded: (height metres, bathy, city)
     vec4 t = texture2D(uField, uv);
     float code16 = t.r*255.0*256.0 + t.a*255.0; // 0..65535, exact for 8-bit inputs
     float H = H_LO + (code16/65535.0)*(H_HI-H_LO);
     return vec3(H, t.g, t.b);
   }
   vec3 sampleField(vec2 uv){                    // manual bilinear across 4 exact texels
     vec2 texel = uv*uFieldSize - 0.5;
     vec2 fr    = fract(texel);
     vec2 base  = (floor(texel)+0.5)/uFieldSize;
     vec2 du    = vec2(1.0)/uFieldSize;
     vec3 c00=fieldTexel(base), c10=fieldTexel(base+vec2(du.x,0.0));
     vec3 c01=fieldTexel(base+vec2(0.0,du.y)), c11=fieldTexel(base+du);
     return mix(mix(c00,c10,fr.x), mix(c01,c11,fr.x), fr.y);
   }
   ```

   Then: `vec3 fld=sampleField(uv); float H=fld.x; float bathy=fld.y; float city=fld.z;` in
   place of the current `vec3 f=texture2D(uField,uv).rgb; ...`. The `bSoft` 4-tap probe and the
   `bGx/bGy/bTang` gradient probes each become `sampleField(uv+offset).y` (they only ever used
   `.g`/bathy) instead of `texture2D(uField,uv+offset).g` — this also *improves* those probes
   slightly, since they get proper bilinear bathy instead of whatever the old single-texture
   LINEAR mode gave them for free (no behaviour change intended, just routed through the same
   correct path since the whole texture is now NEAREST at the hardware level).

3. **`look.mjs` lockstep** (required by the project's standing rule): mirror the same decode —
   its `samp()` helper currently does bilinear-in-byte-space on 3-channel buffers
   (`prototype/look.mjs:47-57`). It needs a field-specific variant that reads 4 channels, does
   the hi/lo decode per corner, and blends the decoded floats — same structure as the GLSL
   above, in JS.

Cost: 4 texture reads per field sample instead of 1, at up to 4 call sites — on a full-frame
WebGL1 shader at typical canvas sizes this is inexpensive; no measurable regression expected,
but the implementer should sanity-check frame time on load.

### C. Shader-side dither (defense in depth, small)

16-bit alone drops the step from 15.7 mm to 0.061 mm — already far below what's visible at any
zoom level used in this piece — so dither is not load-bearing for the fix, but the roadmap
asks for it and it's cheap insurance against the residual real-world flatness in the *native*
source data itself (§1 above: even at full 16-bit precision the busiest sampled crop still had
one code covering 9.2% of the intertidal area — genuine dead-flat mud, not an encoding bug, but
still capable of a visible micro-pop on the very calmest flats). A blue-noise texture asset
doesn't exist in the project yet, so use interleaved gradient noise (Jimenez 2014) — a cheap,
textureless, near-blue-noise dither already standard for this exact class of problem:

```glsl
float ditherIGN(vec2 fragCoord){
  return fract(52.9829189*fract(dot(fragCoord, vec2(0.06711056,0.00583715))));
}
// ... inside main(), right after sampleField():
const float DITHER_M = 0.0006;  // ±0.6 mm — roughly one native-source code, comfortably
                                 // sub-visual, just enough to decorrelate any residual flats
float hDither = (ditherIGN(gl_FragCoord.xy + vec2(uTime*0.7, 0.0)) - 0.5) * DITHER_M;
H += hDither;                   // apply BEFORE submerged/edge/shore/wet/nd all read H
```

The `uTime*0.7` phase drift keeps it from reading as a fixed screen-space grain during Play
mode (a static dither pattern would itself look like an artifact once the eye locks onto it);
the drift is slow enough, and the amplitude small enough, that it cannot be mistaken for actual
water motion. Apply dither to `H` once, immediately after `sampleField()`, so every downstream
use (submerged, edge, shore, damp band, night glow) sees the same dithered value — do not
dither each term separately or they'll decorrelate from each other and look noisy rather than
grainy.

### D. Damp-band step() → smoothstep() (independent of A–C, ship together)

`template-v2.html:292-294` (and the matching block in `look.mjs:93-96`):

```glsl
// was:
// float ebb  = step(uTide+0.0004, uTidePast);
// float band = ebb * step(uTide,H) * step(H,uTidePast);

const float DAMP_EDGE_M = 0.01;      // metres — softening width for both band boundaries
float ebb    = smoothstep(uTide, uTide+0.004, uTidePast);              // soft turn-of-tide
float bandLo = smoothstep(uTide-DAMP_EDGE_M, uTide+DAMP_EDGE_M, H);          // was step(uTide,H)
float bandHi = 1.0 - smoothstep(uTidePast-DAMP_EDGE_M, uTidePast+DAMP_EDGE_M, H); // was step(H,uTidePast)
float band   = ebb * bandLo * bandHi;
float wet    = clamp(band*(1.0-(H-uTide)/max(uTidePast-uTide,1e-4))*uDampGain, 0.0, 1.0);
```

`DAMP_EDGE_M=0.01` (1 cm) softens both the leading edge (freshly exposed, at `H≈uTide`) and
the trailing edge (dried out by now, at `H≈uTidePast`) over a couple of centimetres of
tide-height — "a few mm" per the roadmap brief; 1 cm read well in the isolated render tests
and is small enough not to visibly widen the band on a steep shore. The `ebb` gate is also
softened over a 4 mm window around the turn of the tide so the whole damp effect doesn't
switch on/off as a hard toggle exactly at high/low water — it was already tolerance-gated by
`0.0004`, this just widens that tolerance into an actual transition.

### E. Slider defaults

No slider defaults strictly need to change for the fix to work — A/B/D remove the two real
causes of hard edges outright, at any current slider setting. One small optional rebalance,
consistent with the roadmap's "outlines follow gently": once A–D land, the shape pop is gone,
so edge/shore glow no longer need to compensate visually for a jump that no longer happens.
`edgeGain` (currently day 0.10 / presets 0.09–0.12) and `glowM` (0.5 m reach) could come down
slightly — try `edgeGain × 0.85` and `glowM × 0.8` — as a finishing pass once A–D are in and
visible, not before (isolating this now, before the pop is gone, wouldn't show its real
effect). Not required for correctness; flagged for the person doing the visual pass.

## Files

- `evidence/` — all rendered PNGs and the raw diff-sweep stats referenced above.
- `diff-sweep.mjs` — differences consecutive frames in a directory, reports changed-pixel
  counts and connected-component (blob) sizes; run from `prototype/`:
  `node <path>/diff-sweep.mjs <frames-dir>`.
- `field-plateau-stats.mjs` — reports the largest single quantized-code region in a crop, for
  both `field-v2.png` (8-bit, live) and `drying-height.png` (16-bit, native source); run from
  `prototype/`: `node <path>/field-plateau-stats.mjs`.

## Summary for the morning report

Root cause #1 (dominant): `field-v2.png` height is 8-bit over a 4 m range (15.7 mm/step).
Measured on a real flat: two of twelve 5 mm tide-sweep steps carried 2× the normal
changed-pixel mass in blobs up to 8× larger than baseline, because a single 8-bit code covers
up to 42% of a crop's area as one contiguous plateau (vs 9% for the same crop at native 16-bit
precision) — that whole plateau can only flip in the one frame its code's tide threshold is
crossed. Root cause #2 (independent, always-on during ebb): the damp-band tint uses hard
`step()` thresholds with zero transition width, painting genuinely hard-edged polygons every
ebbing frame. Edge sheen / shore glow are confirmed *not* the source of the hard edges (max
27/255 delta, broad and soft) — they just make an already-popped shape read more like "a zone
with a rim." Fix: 16-bit height split R(hi)/A(lo) in a new field-v3.png, decoded with **manual**
bilinear (hardware bilinear on packed hi/lo bytes creates a worse seam at every byte carry —
documented trap), a small interleaved-gradient dither as insurance, and the damp band's two
`step()`s replaced with 1 cm `smoothstep()`s. All four pieces are additive and independent;
none require re-tuning existing sliders to work.
