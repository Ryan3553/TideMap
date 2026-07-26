# Getting it onto the iPad

## The short answer

**Add it to the home screen as a web app.** `prototype/ipad/` is a complete, installable app:
one self-contained HTML file, a manifest, an icon cut from the harbour itself, and a service
worker so it keeps running when the wifi doesn't. Tapping its icon launches it full-screen with
no browser chrome, in real time, holding the screen awake.

A *native* iOS app would be a `WKWebView` wrapped around exactly this same file. It buys nothing
for a prototype and it cannot be built on Windows — see [Native](#native-if-you-ever-want-it).

## Build it

```bash
cd prototype && node build-v2.mjs && node build-ipad.mjs
```

`build-ipad.mjs` does not contain a second renderer. `ipad/index.html` **is** `tidemap-v2.html`;
the page notices it was launched from the home screen and switches itself to kiosk — chrome
hidden, canvas filling the slab at the screen's own aspect, real-time playback, wake lock. The
`Controls` button in the bottom-left brings the studio panel back if you want to change
something on the device.

`prototype/ipad/` is **generated and gitignored**, like everything else derived. If it is not
there, you have not run the build. Rebuild it whenever the renderer changes — the service worker
keys its cache on the build's byte length, so a rebuild invalidates the copy already on the iPad.

## Stopping the server

`Ctrl-C` in the terminal running it. If it was started in the background, or something is
already holding the port:

```bash
netstat -ano | findstr :5179
```

then `taskkill /F /PID <pid>` on what it reports. There should be exactly one PID — see the
third bullet below for why two is worse than none.

## Route 1 — over your wifi, no hosting, two minutes

```bash
node prototype/serve.mjs
```

It prints one line per network adapter with the adapter's name, and marks the wifi one. On the
iPad, same wifi, open that address — **in Safari** — then **Share → Add to Home Screen**.

Three things that will waste your time if you get them wrong:

- **The port is 5179.** Not 5170. A wrong port gives `ERR_CONNECTION_TIMED_OUT`, which looks
  exactly like a firewall problem and isn't.
- **A downloaded `ipad.txt` means you reached the server.** It used to be what `/ipad` without a
  trailing slash produced: the server read a directory as a file, 404'd, and sent a body with no
  content type, which mobile browsers save instead of showing. Both are fixed — directories
  redirect, and errors are `text/plain` — but the general lesson stands: **a file downloading
  instead of rendering is a Content-Type problem, not a network problem.**
- **Safari, not Chrome.** Chrome on iOS cannot install a PWA; its "Add to Home Screen" makes a
  bookmark that opens in Chrome with full browser chrome, which is not the piece.
- **One server at a time.** Windows will happily let two `node serve.mjs` processes bind 5179
  at once and then route connections to either of them, so a stale copy running older code
  produces failures that come and go. `netstat -ano | findstr :5179` should show exactly one
  PID. The server now refuses to start on a busy port rather than joining it.

What you get: full screen, correct icon, no Safari chrome. What you don't: **offline**, and the
**wake lock**. Both need a secure context, and a plain `http://192.168…` address is not one, so
the service worker is skipped and `navigator.wakeLock` is unavailable. The PC must stay on and
serving. Good enough to judge how it looks on the actual glass, which is the point of a
prototype.

## Route 2 — a real URL, and then it is genuinely an appliance

Put the `ipad/` folder on any static HTTPS host — Netlify Drop, Cloudflare Pages, GitHub Pages,
whatever. Drag the folder in, get a URL, open it on the iPad, Add to Home Screen.

Over HTTPS the service worker registers and caches the whole app on first load, so from then on
it launches **with the wifi off and the PC off**, and `navigator.wakeLock` keeps the screen lit.
That is the always-on artwork described in `CONCEPT.md`, with no App Store and no developer
account.

There is no network call at runtime in either route: the tide, the sun and the moon are all
computed on device from bundled constants, and the imagery is inlined.

## Settings on the iPad worth knowing

- **Display & Brightness → Auto-Lock → Never** is the reliable belt-and-braces even with the
  wake lock, and it is what you want on a device that lives in the cabinet.
- **Guided Access** (Accessibility → Guided Access) locks the iPad into the app so a stray swipe
  cannot leave it. Triple-click the side button to start.
- Rotate the iPad and the piece re-frames itself; it does not need a device preset in kiosk.
- Add to Home Screen must be done from **Safari**. Chrome on iOS cannot install a PWA.

## What the prototype will and will not show you

It will show you the real thing: same shader, same 5120 px imagery, same drying-height surface,
at the real pixel density of the panel, with the real tide for the real time of day.

It will not show you streamed detail. The page carries a fixed 7.6 m/px basemap because it has
to be self-contained; a shipping app would stream the full 0.1 m LINZ layer as you zoom, which
is the single biggest visual difference between this and the finished piece.

## Native, if you ever want it

An iOS app here is a one-screen `WKWebView` loading the same bundled HTML. What it actually
requires:

- **A Mac.** Xcode does not run on Windows, and every cross-platform route (Capacitor, Cordova,
  React Native, Flutter) still needs macOS to produce an iOS build. Cloud builders — Codemagic,
  Expo EAS, Ionic Appflow — rent you a Mac, which works, but you are still signing.
- **Signing.** A free Apple ID gives 7-day builds installed from Xcode over a cable. The
  $99/year Apple Developer Program gives a year-long install and TestFlight.

What native would actually add, in order of worth:

1. **Streamed imagery** — the resolution ceiling above disappears; this is the real reason.
2. A guaranteed always-on screen without relying on Auto-Lock settings.
3. Bundled offline by construction rather than by service worker.

None of those matter for judging the look, so do the PWA first and only reach for Xcode if the
piece earns it.
