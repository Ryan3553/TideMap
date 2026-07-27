# Next session — kickoff

> **2026-07-26 late:** an overnight "make it beautiful" round ran — see `docs/ROADMAP.md`
> for the jobs and `docs/REPORT-2026-07-27.md` for how it ended. The sections below predate
> that round; the traps all still stand.

## Ryan's queue for the next round (2026-07-27 morning)

> **2026-07-27 evening: item 0 is DONE** — arteries built and live in the page, on a
> composite of real bathymetry (`build-depth-composite.py`). **Ryan added the Exports
> scope the same evening and the true HS79 multibeam 2 m (122679) is now IN, priority 0.**
> The big finding: the survey is OFFSHORE ONLY — a shelf band ~5–46 m below LAT (approaches,
> Karewa, the coastal shelf); it never enters the harbour. So the harbour arteries stand on
> the coastal LiDAR + chart vectors, and the multibeam owns the ocean: real sand ridges off
> the beach, crisper ebb-delta lobes, and a ~1.2 m depth correction over what NIWA claimed.
> The new `prep-flow.mjs` needs no change; it reads whatever `depth-composite-raw.f32` says.
> **Item 1 is also DONE** (same day, follow-up round): wide screens put the panel beside a
> sticky piece; narrow screens pin the stage and shrink it to ~34vh once you scroll into
> the sliders (`.tune`, hysteresis 180/60 px). Kiosk untouched; kiosk+Controls gets the
> narrow behaviour. **Item 2's LiDAR-hillshade bullet is DONE too**: `fetch-relief.mjs`
> bakes `data/relief.png` (gradient map, Basemaps elevation terrain-rgb z13, Basemaps
> key) and the shader applies an azimuth-aware raking-light term on land, windowed to
> low sun (real azimuth under Play — `sunPos` now returns `az`, verified for this
> hemisphere; fixed NE in slider mode). Slider: Ground → **Land relief** (default 0.4).
> Items 3-4 untouched.

0. **THE FLOW REBUILD — do this on the 2 m data, in this order.** Ryan rejected the current
   channel flow ("overlapping brush strokes, like a badly painted picture") and marked up
   what he wants: **long, sparse, artery-like streamlines along each channel's DEEPEST
   line** — one continuous spine per channel, the mouth artery branching into the arms like
   the drainage tree it is, strong in the thalweg, fading at channel edges, near-zero on
   flats and open ocean. NOT dense braided texture. A round-3 rebuild against the 25 m NIWA
   data was started and deliberately stopped on Ryan's instruction: better bathymetry first.
   Sequence:
   a. Fetch **LDS layer 122679 (BoP Multibeam 2 m, 2024)** with the key in `.env`
      (recipe: `research/overnight-2026-07-27/bathy/README.md`).
   b. Re-run the depth resample (watch the round-2 lesson in `resample-niwa-depth.py`:
      smooth-then-cubic, no order-1 bilinear) and regenerate field-v3's G channel via
      `prep-field3.mjs`.
   c. THEN rebuild `prep-flow.mjs` as artery streamlines: direction = channel axis from the
      smoothed real depth (seaward-signed), amplitude ∝ depth relative to the local
      cross-channel maximum (`rel = depth/localMax(~40px)`, pow-shaped), sparse seeds
      (~10-18%) integrated LONG (L 100-200px, RK2), same flow.png channel contract
      (A-phase / B-phase / seaward angle) so the shader needs no change. Keep the
      vessel-islet heal and critical-point ring damping; no sharp blur (block seams);
      Float32 throughout.
   Acceptance = Ryan's principle verbatim: each major channel shows one continuous bright
   spine traceable end-to-end; brightness ranked dredged channel > secondary > creeks >
   flats ≈ 0; no dabs, rings, or woolly texture. His marked-up screenshot is committed at
   `research/overnight-2026-07-27/flow/Ryan-markup.png` — the arrows illustrate the
   principle; the real artery paths come from the bathymetry, not from tracing the arrows.

1. **Keep the map visible while driving the controls.** The control panel has grown, and
   tuning means scrolling the piece off screen. Make the canvas stay put — e.g. a sticky
   (position:sticky) or docked mini-preview while the panel scrolls, or pin the piece and
   scroll only the panel. Kiosk mode must be untouched. This is UI work in
   `template-v2.html` CSS/layout only; do not touch the shader.
2. **The LINZ keys now exist** — in `.env` at the repo root (gitignored; NEVER commit or
   embed them — `build-v2.mjs` asserts no key reaches the page). Two different keys for two
   different services (the old trap): the **LDS key** (32 hex) is for data.linz.govt.nz,
   the **Basemaps key** (ULID) for basemaps.linz.govt.nz. What to spend them on, in value
   order:
   - **LDS layer 122679 — Bay of Plenty Multibeam 2 m Depth Model (2024)**: replaces the
     25 m NIWA grid in field-v3's G channel. Chart datum (LAT), 12x finer. The fetch recipe
     and datum notes are in `research/overnight-2026-07-27/bathy/README.md`.
   - **LDS 50672 (hydro depth contours) + 50858 (soundings)** — vector truth for the
     channels; also the NZ 5411 raster charts (51402/51322/51323) if a chart-styled
     basemap variant is ever wanted.
   - **Higher-zoom LINZ aerial** (layer 123991 at z15/z16 for the city end) — sharper
     fusion basemap where the eye lingers. z15 ≈ 1,900 tiles; sub-region only.
   - **LDS 120366 — BoP LiDAR 1 m DEM (2024)**: land topography. Use for a subtle
     hillshade under the raking dawn/dusk light (the sun's azimuth is already computed) —
     land currently has no relief response. Could be a fourth texture or baked into a
     spare channel; keep it gentle, artwork not terrain map.
3. **Imagery can still get better.** Current default is LINZ-detail x Sentinel-2-colour
   fusion. Worth trying with keys/registration: Maxar/Airbus one-off scenes are paid
   (probably not), but **Planet's visual basemaps** have free research tiers;
   **LINZ Basemaps aerial WMTS** (with the Basemaps key) may serve newer/better-toned
   composites than the LDS tiles; and the Sentinel-2 fusion donor could move to a
   **seasonal best-pixel composite** (more scenes, per-pixel quality ranking) rather than
   a 3-scene median. Judge on the same three crops as before
   (`research/overnight-2026-07-27/imagery/`).
   **Google Maps/Earth (and Bing/Esri) are ruled out — settled 2026-07-27.** Their ToS
   forbid tile extraction, offline use and redistribution, all of which a self-contained
   page requires. Google's Tauranga base is aerial imagery of the same lineage as our
   LINZ 0.1 m layer anyway — their edge is COLOUR PROCESSING, not pixels — so the way to
   "Google quality" is better grading/fusion of what we legally hold, not other tiles.
4. **Animation**: the water's clock now scales with playback speed (capped 30x) and the
   base pace was raised after Ryan couldn't see it at all (flow cycle 36 s, swell drift
   ~2x, shimmer drift 0.045). He has not yet confirmed the new pace feels right on the
   iPad — expect a tuning note. If it needs to be user-adjustable, expose a "Water pace"
   slider driving a single multiplier on `animT` accumulation.

The three jobs this file used to specify — urban misclassification, land rendering, zoom
clamp — are **done**, and so is the round after it: the look, the continuous waterline, and
packaging the piece as an installable iPad app. See `HANDOVER.md` for what each turned out to
be, and `IPAD.md` for getting it onto the device.

**What is left is Ryan's to call, and it is colour.** Everything is in place for it: the sliders
work, *Copy settings* works, and the JSON he sends back becomes the default. Do not spend a
session guessing at the palette before he has driven it.

## Paste this as the opening message

> Project: TideMap, an always-on iPad artwork of Tauranga Harbour. Working directory
> `D:\Development\Claude Sandbox\TideMap` (git repo, clean tree).
>
> Read everything in `docs/` — start with `HANDOVER.md`, then `CONCEPT.md`. Do not re-run the
> 204-scene pipeline fit; the raster is sound.
>
> [state the job here]
>
> Then rebuild `prototype/tidemap-v2.html` and publish it as an artifact.

## Reading list, and why each

**Always:**

| doc | why |
|---|---|
| `HANDOVER.md` | State, the three fixed defects with measurements, what not to touch. The single most important file. |
| `CONCEPT.md` | What the piece *is* and the rulings behind it — north stays up, artwork not utility, why the damp band exists. Prevents re-litigating settled decisions. |

**Per job:**

| job | also read |
|---|---|
| Anything touching the raster | `docs/pipeline-validation.md` §5 (notes for the renderer), §6 (harbour-mask defect record), §7 (the stage-9 clean and what it cost). Long — have a subagent read it and report rather than loading it whole. |
| Anything touching the look | `prototype/template-v2.html` fragment shader only. Nothing else. |
| Framing | `prototype/template-v2.html`, the `applyFrame`, `zoomCap` and `frame` functions. |
| Anything touching sources | `docs/SOURCES.md` — how to regenerate, and the LDS-vs-Basemaps key trap. |
| Anything touching the iPad build | `docs/IPAD.md` — the home-screen app, the three ways LAN testing goes wrong, and what native would really cost. |

**Rarely needed:** `docs/tide-validation.md` (the tide model is finished and over-specified for an
artwork — do not spend effort here), `docs/FINDINGS.md` (the original feasibility
question, now settled).

## A method note worth keeping

Every measurement in the first pass at job 1 was confounded by the **box** it was measured in:
a box drawn over "the CBD" contains most of two estuaries, so it reports 40% intertidal and the
number means nothing. Two of the three headline figures in the previous handover were artifacts
of that. **Before believing a regional statistic, render the region and look at it.** The crop
scripts that settled it took ten minutes to write and overturned the framing of the whole job.

## Verification, because this environment has traps

- The Browser pane cannot open `file://`. Run `node prototype/serve.mjs` and use
  `localhost:5179`.
- The pane is often not compositing, so **screenshots fail and `requestAnimationFrame` is
  suspended** — nothing self-reports. `template-v2.html` exposes `window.__tick()` to drive
  one frame and `window.__pixel(x,y)` to read the framebuffer. Use them; they are how every
  claim in the last session was checked.
- `preview_start({name})` resolves a launch config from the *other* project in this sandbox.
  Start the server with Bash and attach with `preview_start({url})`.

## Seeing what you have built

The Browser pane cannot screenshot, so **`prototype/look.mjs` reproduces the fragment shader in
Node and writes a PNG.** It is the only way to actually look at the piece from an agent session,
and every colour decision in the third pass was made with it.

```bash
cd prototype && node --max-old-space-size=8192 look.mjs out=_day.png tide=0.6 light=0.92
```

`zoom= cx= cy= tide= light= moon= past= w= h= set='{"clarity":0.4}'`. It is a **hand-kept copy**
of the shader maths — if you change `template-v2.html`, change it too, or it will quietly lie to
you.

## Traps already paid for — do not rediscover these

- **A backtick anywhere inside the `FS` shader template literal — including in a GLSL comment —
  ends the string early and the module dies with a silent SyntaxError.** No console output in the
  pane; the page just does nothing. `look.mjs` cannot catch it (it never contains the literal).
  `build-v2.mjs` now parses the assembled module source and refuses to build. Write 'quotes',
  never backticks, in shader comments.
- **An inline `<script type="module">` with no closing `</script>` silently never executes.** No
  console error, no exception, no `error` event — `document.scripts[0]` is there with the full
  source and nothing runs. This cost most of an hour. `build-v2.mjs` now asserts the module
  source is small; if the page ever "does nothing", check the closing tag first.
- **A zero-width container made `applyFrame()` set a negative canvas size, which throws and takes
  the whole module down.** That happens in a background tab or an un-laid-out iframe — i.e. in
  the artifact viewer. `applyFrame` now has floors and a `ResizeObserver`.
- **Do not put multi-megabyte data URIs inside the module source.** They belong in `<img>` tags in
  the document, where the parser handles them and they decode off the main thread.
- **`sharp` silently truncates 16-bit PNG input to 8 bits.** It cannot read
  `drying-height.png`. Use `pipeline/lib/png16.mjs` → `decodeGray16`.
- **`sharp` raw output channel count depends on the input's alpha, not on your expectation.**
  A 1-channel PNG comes back as RGB; a composited PNG comes back RGBA. Indexing `i*3` on the
  wrong count produces convincing, meaningless output — it cost two wrong conclusions last
  session. `prep-hires.mjs` has a `rawRGB()` helper that asserts the length; use it.
- **titiler rejects any request over ~1400 px per side** (HTTP 500). Tile and composite.
- The LINZ key is a **Data Service** key, not a **Basemaps** key. Different service,
  different format, different endpoint.

## Still Ryan's to decide

- Colour. The sliders exist so it stops being the agent's guess; he sends back the JSON from
  *Copy settings* and it becomes the default.
- Default framing: city end, northern basin, or a slowly travelling frame.
- Whether the landscape framing complaint is the overflow bug or something else — he has
  seen something a measurement of all six device aspects did not reproduce. Ask for a
  screenshot before changing anything.
