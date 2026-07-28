# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

KERR is a single-page relativistic black hole visualiser: a geodesic raymarcher in GLSL scored by a four-minute piece synthesised live in Web Audio. No frameworks, no runtime assets — no video, no textures, no audio files. Deployed to Cloudflare Workers as static assets.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Static dev server on `:8080`, serving `src/index.html` straight from disk. No build step in development — edit, reload. |
| `npm run check` | The only test harness. Run before every push. |
| `npm run build` | Inline `vendor/three.bundle.js` into `src/index.html` → `dist/index.html`, copy `public/` alongside, print raw/gzip/brotli sizes. |
| `npm run preview` | Build, then serve `dist/`. |
| `npm run deploy` | Build + `wrangler deploy`. |
| `npm run vendor:three` | Re-bundle three.js. Only when bumping the dependency. |

There is no test runner and nothing type-checks this code. `npm run check` ([scripts/check.mjs](scripts/check.mjs)) is what catches breakage:

1. The inline `<script>` parses as JavaScript. **This is the important one** — all GLSL lives in template literals, so a stray backtick in a shader comment silently terminates the string and the page dies at load with nothing useful in the console.
2. `vendor/three.bundle.js` matches the pinned `THREE_SHA256`.
3. Every `THREE.*` symbol referenced in the page is exported by [src/three-entry.js](src/three-entry.js).
4. Nothing loads from an external origin (metadata URLs like `rel="canonical"` and `og:url` are exempt — see [scripts/external.mjs](scripts/external.mjs)).

Bumping three.js: `npm i -D three@latest` → `npm run vendor:three` → paste the new sha256 into `THREE_SHA256` in [scripts/check.mjs](scripts/check.mjs) → `npm run check`.

## Architecture

**Everything is [src/index.html](src/index.html)** — ~2,500 lines of CSS, HTML and one inline `<script>` holding the entire application. The script is divided into three commented sections; keep new code in the section it belongs to.

### 1. AUDIO (from `/* --- 1. AUDIO --- */`)

A single `Audio` object owns the Web Audio graph, the sequencer and the analyser.

- **Arrangement**: `SECTIONS` (ten named sections × bar counts = 120 bars = 4:00 at 120 BPM written in half-time), `PROG` (i–VI–III–VII in D minor), `ARP`, `LEAD`. Bar/step maths derives from `BPM`/`SPB`/`STEP`/`BAR`.
- **Sequencer**: `tick()` runs on a 25 ms `setInterval` with a 0.25 s lookahead, calling `scheduleStep()`, which branches on the section *type* (`intro`/`build`/`drop`/`break`/`bridge`/`drop2`/`final`/`outro`) to fire instrument methods (`pedal`, `strings`, `choir`, `arp`, `timpani`, `clock`, `boom`, `swell`, …). All voices are oscillators + biquads; every node goes through `reg()` so it self-disconnects on `onended`.
- **Signal path**: `sum → highpass ×2 → tone EQ → mid/side width → glue comp → saturator → limiter → master`. A parallel `subIn` bus splits into a clean lowpass path (`subDry`) and a harmonic exciter (`subWet`, an asymmetric waveshaper) that synthesises the harmonics of a fundamental small speakers cannot reproduce. The analyser taps post-tone, **pre-compression** — deliberately, so visuals track music rather than gain reduction.
- **Voicings**: `VOICINGS` holds three parameter sets (`laptop` / `monitors` / `phones`); `setVoicing()` ramps eleven `AudioParam`s. This is a real signal-path change, not a preset name. The UI layer in section 3 (`VOICE_ORDER`, `setVoice`, `detectOutput`) maps the four user-facing choices (auto + the three) onto it, persists to `localStorage['kerr.voicing']`, and while Auto is in charge re-runs detection on `devicechange`.
- **Two modes**: `mode === 'synth'` runs the sequencer; `mode === 'file'` (drag-and-drop) routes a `<audio>` element through the same `bus.sum` — so a dropped track gets the same voicing — and drives visuals from FFT bands plus an onset detector instead of scheduled events.
- **Event bus**: instruments push `{t, kind, v}` via `vis()`; `popEvents()` drains them **compensated for `ctx.outputLatency`** so visual hits land with the sound.

### 2. RENDER (from `/* --- 2. RENDER --- */`)

- Shaders are template-literal strings: `BH_FS` (the hero geodesic raymarch, by far the largest), `BRIGHT_FS`, `BLUR_FS`, `FINAL_FS`, sharing `QUAD_VS` and `GLSL_NOISE`.
- Pass chain each frame: particles → `rtP`; raymarch (`matBH`, sampling `rtP`) → `rtScene`; bright-pass → `rtA`; two separable blur pairs at half res for bloom; **six more** at eighth res through `rtC`/`rtD` for the wide veiling flare; `matFinal` composites scene + bloom + flare with chromatic aberration, ACES tonemap and gamma.
- `renderer.render` is only ever called via `pass(mat, target)`.
- **Colour management is off and the renderer is linear on purpose** (`ColorManagement.enabled = false`, `NoColorSpace`/`LinearSRGBColorSpace`): every shader already ends in its own ACES + gamma encode, so letting three convert would apply the transform twice.
- `BH` holds live simulation state (`spin`, `rh`, `isco`, `din`, `dout`); `setSpin(a)` recomputes the horizon and the Kerr ISCO and pushes them into `uBH`. The HUD reads these same values, so telemetry is genuinely the simulation state.
- **Adaptive quality**: `Q = {scale, steps, dpr}` is retuned once a second from measured fps between `0.5×/96` and `0.92×/220`, calling `allocRT()` to resize render targets.
- Physical constants are deliberately dialled away from exact physics — Doppler exponent at 0.15 instead of 3, frame dragging as a light perturbation on a Schwarzschild marcher. The shader comments explain why in each case; **read them before "fixing" a value**. Same for the disk chroma: `DISK_CHROMA = vec3(1.00, 0.48, 0.40)` is one fixed colour measured off the DNEG paper's published render, not a temperature ramp.

### 3. DIRECT (from `/* --- 3. DIRECT --- */`)

- `CAM` maps each section type to a full cinematic state (distance, elevation, fov, orbit rate, heat, lens, disk gain, chromatic aberration, exposure, hole spin, accretion flow). Every frame `cur` eases toward the active preset across `FIELDS`, so section changes are interpolations, not cuts. Elevations and FOVs are pinned near DNEG's own camera (3.4° above the disk plane) — that grazing angle is what folds the disk into a halo.
- `onEvent()` translates audio events into `shockwave`/`shake`/`flash`/`pull`/`roll` and section title cards. Camera fall is a damped spring (`pull`/`pullV`), not exponential decay.
- HUD: arrangement map (`buildMap`, scrubbable, `fitMapLabels` drops captions that don't fit their own segment), telemetry readout, spectrum canvas, voicing picker, shortcuts.
- `REDUCED` (from `prefers-reduced-motion`) scales shake, chromatic aberration and flash to 0.25.

### Build & deploy

[scripts/build.mjs](scripts/build.mjs) does one substitution — replacing the `<script src="../vendor/three.bundle.js">` tag with an inline copy (escaping `</script>` in the payload) — then copies `public/`. It fails loudly if the tag path changed or if any external load appears. Because everything is inlined, [public/_headers](public/_headers) can ship `default-src 'none'; connect-src 'none'` — the page cannot make a network request at all after load. `media-src blob:` is the single concession, for dropped audio files. **Any change that introduces an external origin breaks both `npm run check` and the CSP.**

`vendor/three.bundle.js` is committed, so building and deploying need no toolchain; esbuild only runs on `npm run vendor:three`.

## Conventions

- No framework, no bundler for the app, no new dependencies. One canvas, no routes, no components, no data fetching.
- Comments in this codebase explain *why a physically-wrong number is the right number* and what was measured off the film. They are load-bearing documentation — preserve them, and match their tone when adding to them.
- Keep [src/three-entry.js](src/three-entry.js) in sync when using a new `THREE.*` symbol (`grep -o "THREE\.[A-Za-z0-9_]*" src/index.html | sort -u`), or check 3 fails.
- Never use `import * as THREE` in the vendor entry — a namespace import defeats tree-shaking.
