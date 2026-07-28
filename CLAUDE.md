# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

KERR is a single-page relativistic black hole visualiser: a geodesic raymarcher in GLSL scored by a four-minute piece synthesised live in Web Audio. No frameworks, no runtime assets — no video, no textures, no audio files. Deployed to Cloudflare Workers as static assets.

**The source is a module tree; the artefact is one self-contained HTML file.** Those are separate decisions and both are deliberate. Do not collapse either into the other.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Rebuild on change and serve `dist/` on `:8080`. Dev and production run the same builder — the only difference is minification. |
| `npm run check` | Six static gates. Fast; run constantly. |
| `npm test` | The real suite, including a real browser. Run before every push. |
| `npm run build` | Bundle `src/main.js`, inline it plus `styles.css` and `vendor/three.bundle.js` into `dist/index.html`, copy `public/`, print raw/gzip/brotli sizes. |
| `npm run preview` | Production build, then serve `dist/`. |
| `npm run deploy` | Check + test + build + `wrangler deploy`. |
| `npm run icons` | Re-rasterise `public/icons/*.png` from the SVG sources. macOS only; the PNGs are committed. |
| `npm run vendor:three` | Re-bundle three.js. Only when bumping the dependency. |

`npm run check` ([scripts/check.mjs](scripts/check.mjs)) is the fast gate:

1. **The whole module tree bundles** — esbuild fails on a syntax error and on an unresolved `#include`, naming a file and a line.
2. `vendor/three.bundle.js` matches the pinned `THREE_SHA256`.
3. Every `THREE.*` symbol referenced anywhere in `src/` is exported by [src/three-entry.js](src/three-entry.js).
4. Nothing in the **built page** loads from an external origin (metadata URLs like `rel="canonical"` and `og:url` are exempt — see [scripts/external.mjs](scripts/external.mjs)).
5. **The layering holds** — nothing in `audio/` or `render/` imports from `direct/`. See Architecture below; this is the invariant the whole structure rests on.
6. Every shader resolves to a whole program. Deliberately *not* glslangValidator — the shaders use `uv`, `position` and `modelViewMatrix`, which three.js injects, so validating one standalone reports a screenful of undeclared identifiers unless you keep a copy of three's prologue here to rot. The browser test compiles them in a real driver instead.

Bumping three.js: `npm i -D three@latest` → `npm run vendor:three` → paste the new sha256 into `THREE_SHA256` in [scripts/check.mjs](scripts/check.mjs) → `npm run check`.

## Tests

`npm test` runs [`node:test`](https://nodejs.org/api/test.html) over `test/*.test.js`. **No test dependencies** — the browser tests drive whatever Chrome is on the machine over DevTools Protocol via Node's global `WebSocket` ([test/helpers/browser.mjs](test/helpers/browser.mjs)), and skip with a note when there is none.

| File | Covers |
| --- | --- |
| [arrangement.test.js](test/arrangement.test.js) | 120 bars, 4:00, contiguous sections, chord shapes, `mtof`, `frand` |
| [kerr.test.js](test/kerr.test.js) | horizon and ISCO against published Kerr values |
| [quality.test.js](test/quality.test.js) | the adaptive controller's bounds, dead band and recovery |
| [output.test.js](test/output.test.js) | the Auto voicing heuristic, including iPadOS-as-Mac |
| [glsl.test.js](test/glsl.test.js) | `#include` resolution: nesting, diamonds, cycles, once-only |
| [build.test.js](test/build.test.js) | the built artefact: balanced tags, nothing external, size budget |
| [structure.test.js](test/structure.test.js) | layering, cycles, orphans, dead exports |
| [smoke.test.js](test/smoke.test.js) | boots the real page under the real headers; pixels out of the GL buffer |
| [pwa.test.js](test/pwa.test.js) | manifest, icons, worker, offline, and that the page still cannot `fetch` |

**When adding logic, put the arithmetic somewhere a test can reach it.** [render/kerr.js](src/render/kerr.js) and [direct/output.js](src/direct/output.js) exist because the code they hold used to be welded to uniform writes and to `navigator`, and neither could be imported in Node.

## Architecture

Three layers, and **the dependency arrows all point one way**:

```
audio/    imports nothing            the piece, and the machine that plays it
render/   imports nothing above it   the picture
direct/   imports both               choreography, event translation, the HUD
main.js   imports everything         the composition root, and the frame loop
```

`audio/` has no DOM access, no renderer, no camera. `render/` has no idea a HUD exists. Only [src/main.js](src/main.js) knows about all three. Check 5 enforces this — **the moment `render/` imports from `direct/`, the layering is decoration.**

### audio/

- [audio/arrangement.js](src/audio/arrangement.js) — the score as data, no behaviour. `SECTIONS` (ten named sections × bar counts = 120 bars = 4:00 at 120 BPM written in half-time), `PROG` (i–VI–III–VII in D minor), `ARP`, `LEAD`, and the `BPM`/`SPB`/`STEP`/`BAR` maths. **Edit this file to change the shape of the piece; edit engine.js to change how it sounds.**
- [audio/engine.js](src/audio/engine.js) — the `Audio` singleton: Web Audio graph, sequencer, analyser.
  - **Sequencer**: `tick()` runs on a 25 ms `setInterval` with a 0.25 s lookahead, calling `scheduleStep()`, which branches on the section *type* (`intro`/`build`/`drop`/`break`/`bridge`/`drop2`/`final`/`outro`) to fire instrument methods (`pedal`, `strings`, `choir`, `arp`, `timpani`, `clock`, `boom`, `swell`, …). All voices are oscillators + biquads; every node goes through `reg()` so it self-disconnects on `onended`.
  - **Signal path**: `sum → highpass ×2 → tone EQ → mid/side width → glue comp → saturator → limiter → master`. A parallel `subIn` bus splits into a clean lowpass path (`subDry`) and a harmonic exciter (`subWet`, an asymmetric waveshaper) that synthesises the harmonics of a fundamental small speakers cannot reproduce. The analyser taps post-tone, **pre-compression** — deliberately, so visuals track music rather than gain reduction.
  - **Voicings**: `VOICINGS` holds three parameter sets (`laptop` / `monitors` / `phones`); `setVoicing()` ramps eleven `AudioParam`s. This is a real signal-path change, not a preset name. [direct/voicing.js](src/direct/voicing.js) maps the four user-facing choices (auto + the three) onto it, persists to `localStorage['kerr.voicing']`, and while Auto is in charge re-runs detection on `devicechange`.
  - **Two modes**: `mode === 'synth'` runs the sequencer; `mode === 'file'` (drag-and-drop) routes an `<audio>` element through the same `bus.sum` — so a dropped track gets the same voicing — and drives visuals from FFT bands plus an onset detector instead of scheduled events.
  - **Event bus**: instruments push `{t, kind, v}` via `vis()`; `popEvents()` drains them **compensated for `ctx.outputLatency`** so visual hits land with the sound.

### render/

- [render/shaders/](src/render/shaders/) — real `.glsl`/`.vert`/`.frag` files, resolved by the esbuild plugin in [scripts/glsl.mjs](scripts/glsl.mjs), which handles `#include "…"` relative to the including file and pulls each include in once. `bh.frag` is the hero geodesic raymarch and by far the largest.
- [render/gl.js](src/render/gl.js) — context, canvas, and the two decisions that must be made before any material exists. **Colour management is off and the renderer is linear on purpose** (`ColorManagement.enabled = false`, `NoColorSpace`/`LinearSRGBColorSpace`): every shader already ends in its own ACES + gamma encode, so letting three convert would apply the transform twice.
- [render/scene.js](src/render/scene.js) — the compositor. Owns every render target, every material, and `renderFrame({ cam, look, audio, rings, time, dt })`. **`renderer.render` is only ever called via `pass(mat, target)`, and `pass()` is only ever called from `renderFrame()`.** Pass chain: particles → `rtP`; raymarch (`matBH`, sampling `rtP`) → `rtScene`; bright-pass → `rtA`; two separable blur pairs at half res for bloom; **six more** at eighth res through `rtC`/`rtD` for the wide veiling flare; `matFinal` composites scene + bloom + flare with chromatic aberration, ACES tonemap and gamma.
- [render/quality.js](src/render/quality.js) — `Q = {scale, steps, dpr}` and the policy: retuned once a second from measured fps between `0.5×/96` and `0.92×/220`. `tuneQuality()` decides; `scene.retune()` reallocates; `main.js` measures. Three files because those are three different concerns. It returns *whether the buffers need reallocating*, which is only when `scale` moved — `steps` is a uniform and costs nothing.
- [render/kerr.js](src/render/kerr.js) — the horizon and ISCO expressions, pure and importable in Node. No state, no uniforms, no imports.
- [render/bh.js](src/render/bh.js) — `BH` holds live simulation state (`spin`, `rh`, `isco`, `din`, `dout`); `setSpin(a)` calls into kerr.js and pushes the results into `uBH`/`uP`. The HUD reads these same values, so telemetry is genuinely the simulation state.
- [render/particles.js](src/render/particles.js) — the orbiting field, rendered to its own target so the grains are lensed with everything else. It takes its radii from the caller rather than reading `BH`, which is what keeps it below `bh.js` in the graph.

Physical constants are deliberately dialled away from exact physics — Doppler exponent at 0.15 instead of 3, frame dragging as a light perturbation on a Schwarzschild marcher. The shader comments explain why in each case; **read them before "fixing" a value**. Same for the disk chroma: `DISK_CHROMA = vec3(1.00, 0.48, 0.40)` in `bh.frag` is one fixed colour measured off the DNEG paper's published render, not a temperature ramp.

### direct/

- [direct/camera.js](src/direct/camera.js) — `CAM` maps each section type to a full cinematic state (distance, elevation, fov, orbit rate, heat, lens, disk gain, chromatic aberration, exposure, hole spin, accretion flow). Every frame `cur` eases toward the active preset across `FIELDS`, so section changes are interpolations, not cuts. Elevations and FOVs are pinned near DNEG's own camera (3.4° above the disk plane) — that grazing angle is what folds the disk into a halo. `view` is the mutable bag of everything the shot carries between frames; `updateCamera()` returns a plain description of the shot and never touches a uniform.
- [direct/events.js](src/direct/events.js) — `onEvent()` translates audio events into `shockwave`/`shake`/`flash`/`pull`/`roll` and section title cards. Camera fall is a damped spring (`view.pull`/`view.pullV`), not exponential decay.
- [direct/hud.js](src/direct/hud.js) — arrangement map (`buildMap`, scrubbable, `fitMapLabels` drops captions that don't fit their own segment), telemetry, spectrum canvas, title cards, toast. Everything that writes to the DOM every frame is behind `updateHud()`.
- [direct/input.js](src/direct/input.js), [direct/shortcuts.js](src/direct/shortcuts.js), [direct/voicing.js](src/direct/voicing.js), [direct/dropzone.js](src/direct/dropzone.js) — pointer, keyboard, the output picker, and file drop.
- [motion.js](src/motion.js) — `REDUCED` (from `prefers-reduced-motion`) scales shake, chromatic aberration and flash to 0.25. It sits at the root because it belongs to neither the camera nor the renderer, and both read it.

### Build & deploy

[scripts/build.mjs](scripts/build.mjs) bundles `src/main.js` with esbuild (IIFE, es2020, the GLSL plugin) and folds three exact tags in `src/index.html` into inline content: the stylesheet, the vendored three.js, and the app. `</script>` inside a payload is escaped. It fails loudly if any tag stopped matching or if an external load appears.

Because everything is inlined, the page ships `default-src 'none'; connect-src 'none'` — it cannot make a network request at all after load. **Any change that introduces an external origin breaks `npm run check`, `npm test` and the CSP at once.**

**The CSP lives in two places, and that is deliberate.** Cloudflare *appends* when two `_headers` rules set the same header, and browsers enforce the intersection of every policy they get — so a blanket `connect-src 'none'` on `/*` also lands on `/sw.js` and leaves the service worker unable to reach the network. That was measured: the worker took control and then answered everything with a 503. So [public/_headers](public/_headers) grants `connect-src 'self'` for the worker's sake, and a `<meta http-equiv="Content-Security-Policy">` in the document intersects it back to `'none'` for the page. `frame-ancestors` stays in the header, the only place it works. **Do not "simplify" this into one header** — [test/pwa.test.js](test/pwa.test.js) will fail, and it should.

`vendor/three.bundle.js` is committed and hash-pinned, so a build never resolves, downloads or re-shakes the dependency. [src/three.js](src/three.js) is the single seam that reads it; nothing else touches the global.

### PWA

Manifest, icons and a network-first service worker in `public/`. **Network-first on purpose**: the document must revalidate every load, and a cache-first worker would quietly serve yesterday's build to someone who reloaded to get today's. The cache is consulted only when the network is not there — pure upside, and the app works on a plane because "the app" is one document with no runtime assets to miss. Registration is fire-and-forget in [src/pwa.js](src/pwa.js); a browser that refuses the worker must get the visualiser unchanged.

## Conventions

- No framework, no new dependencies. One canvas, no routes, no components, no data fetching. esbuild is the only build tool and it is already here.
- **Respect the layering.** New code goes in the layer it belongs to, and if it seems to need an import that points upward, the design is wrong, not the rule.
- Comments in this codebase explain *why a physically-wrong number is the right number* and what was measured off the film. They are load-bearing documentation — preserve them, and match their tone when adding to them.
- Keep [src/three-entry.js](src/three-entry.js) in sync when using a new `THREE.*` symbol (`grep -rho "THREE\.[A-Za-z0-9_]*" src --include=*.js | sort -u`), or check 3 fails.
- Never use `import * as THREE` in the vendor entry — a namespace import defeats tree-shaking.
