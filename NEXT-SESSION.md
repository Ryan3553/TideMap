# Next session — kickoff

## Paste this as the opening message

> Project: TideMap, an always-on iPad artwork of Tauranga Harbour. Working directory
> `D:\Development\Claude Sandbox\TideMap` (git repo, clean tree).
>
> Read `HANDOVER.md` first, then `CONCEPT.md`. Do not re-run the 204-scene pipeline fit —
> the raster is sound apart from one defect described in the handover.
>
> Three jobs, in this order:
> 1. Urban land is misclassified as intertidal (45% of the Tauranga CBD). Fix it in the
>    pipeline and rebuild the field raster.
> 2. Land rendering flattens the imagery to a two-stop luminance ramp and throws away all
>    the detail. Keep the real RGB and grade it instead.
> 3. Clamp zoom so the widest landscape frame can't overflow the map.
>
> Then rebuild `prototype/tidemap-v2.html` and publish it as an artifact.

## Reading list, and why each

**Always:**

| doc | why |
|---|---|
| `HANDOVER.md` | State, the three diagnosed defects with measurements, what not to touch. The single most important file. |
| `CONCEPT.md` | What the piece *is* and the rulings behind it — north stays up, artwork not utility, why the damp band exists. Prevents re-litigating settled decisions. |

**Per job:**

| job | also read |
|---|---|
| 1. Urban misclassification | `pipeline/VALIDATION.md` §5 (notes for the renderer) and §6 (defect record). Long — have a subagent read it and report rather than loading it whole. |
| 2. Land rendering | `prototype/template-v2.html` fragment shader only. Nothing else. |
| 3. Zoom clamp | `prototype/template-v2.html`, the `applyFrame` and `frame` functions. |
| Anything touching sources | `sources/MANIFEST.md` — how to regenerate, and the LDS-vs-Basemaps key trap. |

**Rarely needed:** `tide/VALIDATION.md` (the tide model is finished and over-specified for an
artwork — do not spend effort here), `research/FINDINGS.md` (the original feasibility
question, now settled).

## Acceptance criteria

1. **Urban misclassification** — re-measure the CBD / Mount Maunganui / Pāpāmoa boxes in
   `HANDOVER.md`. CBD intertidal should fall from 45% to a few percent, and the harbour's
   intertidal total should stay near **138 km²** (if it drops far below, real flats are being
   destroyed — that is a worse bug than the one being fixed).
2. **Land rendering** — at midday, land should show visible variation: fields, forest, urban
   blocks distinguishable. Compare against `research/composition/` and Ryan's Google Earth
   reference. The flats and water treatment must not regress.
3. **Zoom clamp** — every device × orientation renders with no black band. There is a
   measurement snippet in the session log; re-derive it from `zoom × aspect × 1.0866 ≤ 1`.

## Verification, because this environment has traps

- The Browser pane cannot open `file://`. Run `node prototype/serve.mjs` and use
  `localhost:5179`.
- The pane is often not compositing, so **screenshots fail and `requestAnimationFrame` is
  suspended** — nothing self-reports. `template-v2.html` exposes `window.__tick()` to drive
  one frame and `window.__pixel(x,y)` to read the framebuffer. Use them; they are how every
  claim in the last session was checked.
- `preview_start({name})` resolves a launch config from the *other* project in this sandbox.
  Start the server with Bash and attach with `preview_start({url})`.

## Traps already paid for — do not rediscover these

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
