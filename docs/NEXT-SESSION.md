# Next session — kickoff

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
