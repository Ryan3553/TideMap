# TideMap — concept and architecture

*Working doc. Decisions are mine unless marked NEEDS RYAN.*

## What this is

**An always-on artwork for an iPad, showing Tauranga Harbour breathing.** Plugged in,
screen on, sitting in the cabinet next to the photographs. Real data, displayed
beautifully. It earns its place by being worth looking at, not by being useful.

It is not a tide utility. Nobody plans a fishing trip with it. That changes what
"accurate" has to mean: an error of twenty minutes in the time of high water is
invisible in an artwork and unforgivable in a tide table. We are making the former.

This only works because Tauranga is ~60% intertidal. Most harbours would give a
shoreline that twitches. Tauranga empties and fills.

## The central problem: the tide is too slow to see

Measured, not guessed. Tauranga's intertidal flats are roughly 145 km² draining over a
~1.8 m range, so the harbour gains area at order 80 km² per vertical metre. Spread along
a waterline that — counting the whole braided channel network — runs to several hundred
kilometres, the water's edge advances on the order of **a metre or two per minute** at
mid-tide, when it is moving fastest.

On a whole-harbour view an iPad pixel covers 10–15 m of ground. So the waterline crosses
**about one pixel every ten minutes**. That is far below the threshold of visible motion.
You cannot watch the tide come in, on screen or in real life.

So: **do not fight it.** Real-time tidal motion cannot be the visible motion in the
piece. Three moves supply the life instead, and all three are physically true.

### 1. Light does the moving

The piece is lit by the actual sun. Dawn comes up over the Pacific behind Mauao, the
light rakes across the flats in the morning, flattens at noon, goes long and gold in the
evening, and the harbour turns to silver under the real moon at night. Sun and moon
positions are cheap to compute exactly and need no network.

This is what a window does. You never see the tide move through a window either — you
see the *day* move. Light changes perceptibly over ten or twenty minutes, which is
exactly the timescale a glanceable artwork needs.

### 2. Wet sand shows the direction

The best answer to "which way is it going?" is not a UI element. Freshly exposed tidal
flat is **dark and wet**, and it **pales as it dries**. So:

- **Ebbing** — a dark damp band lies above the waterline, widening behind the retreating
  water. The harbour looks like it is draining, because that is what draining looks like.
- **Flooding** — no band. Water advances over pale dry sand, clean-edged.

Direction is encoded in the picture itself, continuously, with no chrome and no arrows.
It is real physics, not a graphic device, and it is beautiful. This is the single best
idea in the project.

### 3. The breath

Every so often — say a quarter hour — the piece takes one slow twenty-second sweep
through the last few hours of tide and settles back to now. A sweep hand on a clock that
otherwise only has an hour hand. You catch it in your peripheral vision, understand the
whole state of the harbour at a glance, and it is gone.

Optional and adjustable, including off. Some people will want the piece dead still.

## The thesis: the moon is in the picture, and the moon is why

The moon is drawn in the sky, in its true phase and true position. Over a month a viewer
who never reads a word of explanation notices that when the moon is full or new, the
flats go widest and the water climbs highest — and that when it is half, the harbour
barely moves at all.

The artwork teaches its own physics by being accurate. That is the difference between
data as decoration and data as art. Everything else in the piece serves this.

## Composition

Three layers, bottom to top:

1. **Basemap** — one high-quality capture: dry land, town, forest, the Mount.
2. **Water** — everything below the current tide height. Colour, depth gradient and
   surface treatment are ours to choose.
3. **Waterline and the damp band** — the boundary, and the drying-sand gradient behind
   it. The thing the eye tracks.

All of it driven by one data asset: a **drying-height raster** giving, per pixel, the
tide height at which that pixel goes under. Rendering is then a threshold, and the damp
band is simply "pixels that went dry within the last N minutes" — which the raster gives
us for free.

This is why we are not crossfading photographs. Photographs are frozen at nine specific
tides, in nine different lights, across three years and four seasons — the light flickers
between frames. A single basemap plus a computed waterline gives one consistent world we
can light however we choose.

## Fitting an awkward shape to a screen

**RULING (Ryan, 2026-07-26): north stays up. No rotation.** I had proposed rotating the
frame 38° so the coastline ran horizontally, on the grounds that the harbour is ~4:1 and
nothing on an iPad is. That was solving with rotation what composition solves better:
zoom in, let the far ends run off frame, and the NW–SE diagonal becomes the composition
rather than the problem. The rotated studies in `research/composition/` are kept as a
record of the rejected direction, not as the plan.

Consequence: the frame cannot contain the whole 40 km at once. That is a compositional
choice, not a defect —

- **The city end** (Matakana, the entrance, Mauao, the two arms behind the city) —
  legible, populated, the view most people would recognise as theirs. Current default.
- **The northern basin** (Bowentown to Ōmokoroa) — emptier, wilder, most dramatic drying.
- **A travelling frame** — drifts along the harbour over hours; solves framing, burn-in
  and monotony at once, at the cost of the "same view every glance" quality that makes
  the tide legible by comparison. Offer it, do not default to it.

Framing is now a live control (zoom + centre, drag and scroll), so this is Ryan's to set
rather than mine to guess.

## Night

The piece does not go black. It goes moonlit: silver water, dark land, and the real
lights of Tauranga and Mount Maunganui along the shore. Brightness follows the room and
the hour. It should be something you would happily leave glowing in a dark lounge.

## Always-on practicalities

- Keep the screen awake (`isIdleTimerDisabled`); assume mains power.
- **Drift the frame very slowly** to avoid burn-in on OLED iPads — a glacial pan and
  zoom over hours. This is a burn-in mitigation that happens to also be the correct
  aesthetic choice, so it costs nothing.
- Dim substantially at night; consider an ambient-light response.
- No network ever. Sun, moon and tide all computed on device from bundled constants.

## The iPhone wallpaper idea — parked, deliberately

Two reasons, one aesthetic and one hard:

- **Aesthetic:** a wallpaper's job is to recede behind app icons. It must be quiet and
  low-contrast. That is directly at war with "the harbour is the subject." Ryan's own
  instinct here is right.
- **Technical:** an iOS app cannot set the wallpaper programmatically. Only the user can,
  or a Shortcuts automation — so a tide-following wallpaper is a clunky workaround, not a
  product.

Not worth pursuing. The iPad piece is the product.

## Consequences for the tide engine

Accuracy requirements drop sharply. Height error of a few centimetres is far more than an
artwork needs, and timing error of even half an hour is imperceptible. The work already
done is comfortably sufficient; further refinement is not worth the effort. LINZ
attribution is still required and still correct to give.

## Open questions

- **NEEDS RYAN — the look.** Photographic satellite, or something more designed and
  chart-like? The biggest identity decision, and a pure taste call. Best answered by
  seeing variants side by side rather than by discussing it.
- Below 0.31 m — the lowest tide any satellite pass caught — the raster has no data.
  Does that read as a flaw at spring lows, or does the channel network look fine as flat
  water?
- Does the piece ever show a number? An artwork probably shouldn't. But a viewer may want
  to know, once, what they are looking at. Perhaps on touch only, fading away after.
- Place names: enormous local credibility, at the cost of clutter. LINZ place names are
  open data.

## Status

- Imagery viability — **proven**, `research/FINDINGS.md`.
- Nine-step photo series — **built**, `research/series/`.
- Offline tide prediction — **built**, `tide/` (0.051 m RMSE on a held-out year).
- Drying-height raster — in progress.
- The piece itself — next.

## v2 build (2026-07-26)

- **Bathymetric contour lines removed** (ruled ugly). The live waterline glow stays.
- **iOS device frames**: iPad 4:3, iPad Pro 11", iPad mini, iPhone 19.5:9, iPhone 16:9,
  square — each in landscape or portrait, driving both the frame and the render aspect.
- **Manual tide** and **manual daylight** sliders, each falling back to live when parked
  below their minimum.
- **LINZ 0.1 m aerial integrated** (LDS layer 123991, BoP 2025) — fetched at z14, reprojected
  from Web Mercator to the raster's equirectangular grid, and composited over Sentinel-2 with
  the seam placed on the COASTLINE rather than the aerial's tile-edge staircase.
- **Dropdowns** for background imagery and colour presets (Bioluminescent / Deep water /
  Warm chart / Monochrome).

### Resolution ceiling — stated plainly
LINZ aerial is genuinely 0.1 m at source but is downsampled to 9.5 m to fit an embeddable
page. At whole-harbour framing that is not the binding constraint: an iPad Pro is 2732 px
wide, so ~4096 px across 38.8 km already exceeds what the screen can show. The aerial's real
advantage appears only when zoomed in, which the shipping app can stream live and a
self-contained page cannot. Separately, the **waterline is limited to ~15 m by the
drying-height raster** regardless of imagery.

### Key handling
The LINZ API key is used at BUILD time only (`LINZ_KEY` env var in `fetch-linz.mjs`) and is
asserted absent from the published page by `build-v2.mjs`.
