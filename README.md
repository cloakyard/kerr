<div align="center">

  <h1>KERR</h1>

  <p><strong>A relativistic black hole, rendered by tracing light through curved spacetime.</strong></p>
  <p>Scored by a cinematic piece that is generated live in your browser — no audio file is ever downloaded.</p>

  <p><a href="https://kerr.cloakyard.com/">kerr.cloakyard.com</a></p>

  <p>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/platform-Web-blue" alt="Platform: Web" />
    <img src="https://img.shields.io/badge/dependencies-1-brightgreen" alt="One dependency" />
    <img src="https://img.shields.io/badge/payload-141%20KB%20br-brightgreen" alt="141 KB brotli" />
  </p>

</div>

<p align="center">
  <img src="screenshots/kerr-hero.jpg" alt="KERR — seen almost edge-on: the far side of the disk lensed up over the shadow and wrapped into a full ring beneath it, the near side cutting across in front, and the photon ring hugging the horizon" width="960">
</p>

---

## ✨ What it is

A single page that draws a spinning black hole the way light actually arrives at a camera near one, and plays a four-minute piece written for it. Everything is computed at runtime — there is no video, no texture, and no audio asset.

- **🌀 Geodesic raymarching** — every pixel integrates a null geodesic through Schwarzschild spacetime with an adaptive midpoint scheme. The photon ring, the Einstein ring and the disk's over-and-under lensed images are not drawn; they are what the integrator produces.
- **🔥 A disk built to _Interstellar_'s own numbers** — DNEG's geometry (`r = 9.26M` to `18.70M`, `a/M = 0.6`), Thorne's position-independent 4500 K, Keplerian shear, and front-to-back opacity so the disk occludes its own far side. The colour is one fixed chroma measured off the film's published render, not a temperature ramp — see below.
- **🎼 A live score** — pipe organ, string ensemble, choir formants, a bell arpeggio, timpani and a clock tick, sequenced through ten sections in D minor by a Web Audio graph built from oscillators and filters.
- **🎚️ Three output voicings, picked for you** — the same performance re-mixed for built-in speakers, powered monitors, or headphones, chosen automatically and overridable in one tap. This is a real signal-path change, not a preset name.
- **🎧 Bring your own audio** — drop any file on the page and the visualiser drives itself from an FFT and onset detector instead.

---

## 🌌 Why "Kerr"

Einstein published his field equations in 1915. Karl Schwarzschild solved them for a non-rotating mass within months, from a trench on the Russian front. Then the problem stalled: rotation breaks spherical symmetry, and the spinning case resisted everyone who tried it for the next forty-seven years.

Roy Kerr, a New Zealand mathematician, found it in 1963 — barely two pages in *Physical Review Letters*, giving the exact geometry of spacetime around a spinning mass. Chandrasekhar later described encountering it as among the most profound experiences of his scientific life.

It matters because black holes form from collapsing stars, stars rotate, and angular momentum is conserved all the way down. Essentially every black hole in the universe is a Kerr black hole; Schwarzschild's is the idealised special case that never quite occurs.

Everything that makes this simulation more than a black circle comes from Kerr's solution — the horizon shrinking as spin rises, the innermost stable orbit migrating inward from `6M` toward `M`, and frame dragging, where spacetime itself is hauled around with the hole. Gargantua is a Kerr black hole too: Kip Thorne set its spin just shy of maximal, which is the only reason an hour on Miller's planet can cost seven years back home.

---

## 🔭 The physics

Distances are in Schwarzschild radii (`r_s = 1`, so `M = 0.5`). The HUD reports the live state of the simulation.

| Quantity | Behaviour |
| --- | --- |
| Null geodesics | `a = −1.5 h² r⃗ / r⁵`, integrated with adaptive-step RK2. Step size falls out of local curvature, so rays crawl around the photon sphere and stride across flat space. |
| Frame dragging | A gravitomagnetic Lense–Thirring term, `a += a_spin · (v⃗ × B⃗_g)`, falling off as `1/r⁴`. |
| Horizon | `r_h = M + √(M² − a²)` — shrinks as spin rises. |
| ISCO | The full Kerr expression, `6M` at `a = 0` falling toward `M` as `a → 1`. |
| Photon sphere | `1.5 r_s` at zero spin, moving inward for a prograde orbit. |
| Doppler | `δ = 1 / (γ(1 − β·n̂))`. Physically `I_obs ∝ δ³`; the exponent here runs at 0.15, so the beaming is present but ±6% — see below. |
| Redshift | `√(1 − 1/r)`, folded into the same shift factor. |
| Disk | `r = 9.26M … 18.70M`, one temperature throughout, exactly as specified for the film. |
| Disk particles | Precessing ellipses driven by the relativistic epicyclic frequency `κ = ω√(1 − 6M/r)`, on a slow inspiral. |

**Where it departs from physics, and why.** The Doppler asymmetry is dialled almost out. DNEG implemented it correctly for _Interstellar_ and then removed it, because a physically-exact render has one blindingly bright edge that reads on screen as a mistake — the two sides differ by a factor of roughly fifty once `I ∝ δ³` is applied, and the shadow disappears into the bright one. The spin is the same kind of compromise, and the reason the two figures above disagree: Gargantua has to turn at `a/M ≈ 1` for an hour on Miller's planet to cost seven years, but at that spin the shadow goes visibly lopsided and its left edge flattens, so Nolan and Franklin slowed it to `0.6` for the camera. The frame-dragging term is likewise kept light: it is a perturbation on a Schwarzschild marcher rather than a true Kerr metric, and pushed hard it cuts a notch out of the silhouette instead of smoothly flattening it.

**Where the colour comes from.** Not a black-body curve. Thorne specified a disk that has stopped accreting and cooled to one temperature everywhere, so its colour cannot vary with radius — and sampling the film's own published render bears that out. Inverting this renderer's tone curve on Figure 15a of the DNEG paper gives the linear emission behind each pixel, and from the faintest outer wisp to the core it comes back at a near-constant `(1.00, 0.48, 0.40)`. The white-hot centre and the salmon fringe are the same colour at two intensities; the walk to white is the tone curve and the veiling flare doing their jobs. Ramping hue with radius — which is the obvious thing to do, and what this used to do — is what makes a render of Gargantua come out khaki instead of rose.

**Why the outer disk is a volume.** DNGR shipped three disk models, and the obvious one — a single intersection with an infinitely thin plane — has a tell you cannot texture your way out of: a plane's silhouette is exactly a plane, so the disk's edge comes out glassy no matter how good the map on it. The film's outer material is torn into filaments that stand off the mid-plane with dark lanes between them, and that came from their second model, a *volumetric* disk an artist built in Houdini as ~17 million voxels of optical density, integrated step by step along the beam. For close-ups they went further still and drove procedural fractal noise through Mantra.

So the outer disk here is a real volume: a slab of fbm density the marcher integrates, emissive and absorbing both, because the dark lanes are filaments standing in front of brighter ones and that only happens if the material occludes. Two things were measured off the film rather than guessed. Its half-thickness is roughly 1 r_s at mid-disk falling to a knife edge at the rim — so `h/r` *falls* with radius, where a constant flare angle would make it rise and the fringe billow into smoke. And only 56–65% of the vertical span reads as material; the rest is gap. The noise also has to be kept coarse: a ray grazing the disk tip runs several r_s through the slab, and finer features get averaged away by their own line integral, leaving a solid wall where the film has holes.

**Where the camera goes.** DNEG shot Gargantua from `r_c = 74.1M` and `θ_c = 86.56°` — 3.4° above the disk plane. That grazing angle is not incidental: it is what folds the disk's over-and-under images into a closed halo around the shadow. Lift the camera much past ten degrees and the arcs peel apart into an ordinary ringed planet, which is why every framing here sits near the plane. The fields of view are long for the same reason. On the film's own plates the shadow spans about an eighth of the frame width; at a sixteenth the halo, the photon ring and the ragged rim all shrink below the size at which anyone can read them, and the image stops being Gargantua and starts being a bright speck.

**Veiling flare.** A wide, soft, near-neutral glow, run as a second blur chain at an eighth resolution so it can reach a couple of hundred pixels. DNEG convolved their renders with the measured point spread function of the actual IMAX lenses for this, so the CG would cut against photographed footage. It is the most "shot on film" thing about the image and a tight threshold bloom is no substitute — but it is kept well below the strength of their own flared plate, which fills the shadow to a pale grey. In the film the shadow reads black.

---

## 🔊 Why there are three output modes

The first version of this piece was unlistenable on a laptop. The bass sat around **18 Hz** — inaudible on any built-in speaker, but loud enough to dominate the waveform, drive the limiter and rattle the drivers.

Small speakers cannot move air below roughly 150 Hz, so the fix is not to boost the bass; it is to synthesise the harmonics of a fundamental the speaker cannot produce and let the ear reconstruct the missing tone. Each mode is a different bargain:

| | High-pass | Sub-bass 15–35 Hz | Weight 55–100 Hz | Stereo width | Compression |
| --- | --- | --- | --- | --- | --- |
| **Built-in** | 48 Hz | −37.8 dB | −25.8 dB | 1.00 | most |
| **Speakers** | 33 Hz | −32.5 dB | −30.8 dB | 1.35 | least |
| **Headphones** | 25 Hz | −30.3 dB | −29.3 dB | 0.90 | middle |

Built-in mode trades sub energy for the harmonics that imply it, and covers laptop and phone speakers alike — both are small drivers with nothing under ~150 Hz. Speakers mode assumes a real woofer, so the exciter mostly steps aside — but it still filters below 33 Hz, because feeding a small driver infrasound only costs excursion. It gets the widest image and the least compression, since there is physical speaker separation and a real amplifier to use. Bass stays mono in every mode; only the mid/side stage widens.

### What Auto can and cannot know

Auto is the default, and it is honest about being a guess. The browser will tell you two things:

- **Device class**, from User-Agent Client Hints and touch points — a phone or tablet versus a laptop or desktop.
- **`AudioContext.outputLatency`** — about 10 ms on a built-in output, past 100 ms once the signal is going over a wireless link.

It will not tell you what is on the other end. `enumerateDevices()` returns a single entry with an empty label and an empty id until the page holds a **microphone** permission, and prompting for the mic just to choose an EQ curve is not a trade worth making. So nothing on the web can spot a KEF LSX II on the end of a cable.

Auto therefore picks **built-in** by default and **headphones** when it sees a wireless link, since earbuds are much the more common wireless output — and the line under the buttons says which guess it made and why, rather than implying a certainty the browser cannot give. **Powered speakers stay a deliberate choice.** Pick any mode yourself and Auto stands down: the choice is remembered, and a later device change will not second-guess it. While Auto _is_ in charge it re-checks whenever the output device changes, so plugging in headphones re-voices the mix on the spot.

---

## 🧰 Tech stack

| Area | Technology |
| --- | --- |
| Rendering | WebGL via [three.js r185](https://threejs.org/) (vendored, tree-shaken) |
| Shading | GLSL — geodesic raymarch, volumetric disk fringe, bloom and veiling flare, ACES tonemap |
| Audio | [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — oscillators, biquads, convolution reverb, waveshaping |
| Build | ~60 lines of Node. No framework. |
| Deployment | Deployed to [Cloudflare Workers](https://workers.cloudflare.com/) as static assets, at [kerr.cloakyard.com](https://kerr.cloakyard.com/) |

**Why no framework.** One canvas, no routes, no components, no data fetching, and nothing in the DOM but a HUD. React and a bundler would add a build graph and a runtime to a page that renders roughly forty elements. The build step exists only to fold three.js into the document — which is also what lets the CSP name no external origin at all.

**The one dependency.** three.js is used for about twenty symbols: the renderer, render targets, two cameras, `Points`, and some vectors. Everything else is hand-written GLSL. [`src/three-entry.js`](src/three-entry.js) imports exactly those by name and `npm run vendor:three` tree-shakes them into `vendor/three.bundle.js`. Since three ships ESM only, the vendored artefact is a bundle rather than a copied file — and because it is committed, building and deploying needs no toolchain at all; esbuild runs only when the dependency is bumped.

Colour management is switched off and the renderer left in linear: every shader here already ends in an ACES tonemap and a gamma encode, so letting three convert as well would apply the transform twice.

---

## 🚀 Getting started

```bash
git clone https://github.com/cloakyard/kerr.git
cd kerr
npm install
npm run dev     # http://localhost:8080
```

There is no build step in development — `src/index.html` runs straight from disk. Edit it, reload, done.

| Command | Description |
| --- | --- |
| `npm run dev` | Static dev server on `:8080` |
| `npm run build` | Inline three.js into `dist/index.html` |
| `npm run preview` | Build, then serve `dist/` |
| `npm run check` | Parse the inline script, verify the pinned dependency, check for external origins |
| `npm run deploy` | Build and publish to Cloudflare |
| `npm run vendor:three` | Re-bundle three.js — only needed when bumping it |

Bumping three.js: `npm i -D three@latest`, `npm run vendor:three`, then paste the new hash into `THREE_SHA256` in [`scripts/check.mjs`](scripts/check.mjs) and re-run `npm run check`.

`npm run check` is worth running before you push. The GLSL lives in template literals, so a stray backtick in a shader comment silently terminates the string and the page dies at load with nothing useful in the console — the check catches exactly that.

---

## 🛡️ Privacy

There is no server to talk to, no analytics, no cookies and no accounts. Because the build inlines everything, the shipped [`_headers`](public/_headers) can forbid every external origin outright — `default-src 'none'`, and `connect-src 'none'`, which means the page cannot make a network request at all once it has loaded. That is enforced by the browser, not merely promised.

`media-src blob:` is the single concession: a dropped audio file becomes an object URL. It is decoded locally and never leaves the device.

---

## ⚙️ Performance

The whole application is one 630 KB document — **141 KB over the wire** after brotli — served in a single request with no dependency waterfall.

The renderer measures its own frame rate and trades resolution scale against march step count to hold 60 fps, between `0.5×/96` steps and `0.92×/220`. On an M2 Max it sits at the ceiling. `prefers-reduced-motion` damps camera shake, chromatic aberration and flash.

---

## 🎹 Controls

<p align="center">
  <img src="screenshots/kerr-interface.jpg" alt="The interface: live simulation telemetry at top left, transport and output voicing at top right, spectrum and the ten-section arrangement map along the bottom" width="900">
</p>

Live telemetry sits at top left — spin, horizon, ISCO, the disk's inner edge, current orbital radius and the adaptive quality the renderer has settled on. The arrangement map along the bottom is scrubbable, and its captions drop out as the window narrows rather than colliding.

| | |
| --- | --- |
| Drag | Orbit |
| Scroll / pinch | Fall in and pull back |
| Space | Pause |
| ← → | Skip 10 s |
| ↑ ↓ | Volume |
| `R` | Restart |
| `V` | Cycle voicing: auto / built-in / speakers / headphones |
| `F` | Fullscreen |
| `H` or `?` | Shortcuts |
| Drop a file | Visualise your own audio |

---

## 🙏 Acknowledgements

None of this was built from nothing.

[**three.js**](https://threejs.org/) does the WebGL heavy lifting — context and state management, render targets, the points pipeline — which is what leaves the interesting parts free to be hand-written GLSL. It is bundled here under its own MIT license, and the project would not exist in this form without it. [**esbuild**](https://esbuild.github.io/) tree-shakes it down to only what is used. [**Cloudflare Workers**](https://workers.cloudflare.com/) serves the result. And the score exists at all because the [**Web Audio API**](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) will happily build a pipe organ out of oscillators and biquad filters.

The physics is borrowed from the people who worked it out:

- **R. P. Kerr**, *Gravitational Field of a Spinning Mass as an Example of Algebraically Special Metrics* — Physical Review Letters **11**, 237. The solution this project is named for.
- **J. M. Bardeen, W. H. Press & S. A. Teukolsky**, *Rotating Black Holes: Locally Nonrotating Frames, Energy Extraction, and Scalar Synchrotron Radiation* — Astrophysical Journal **178**, 347. Source of the ISCO expression used here.
- **O. James, E. von Tunzelmann, P. Franklin & K. S. Thorne**, *Gravitational lensing by spinning black holes in astrophysics, and in the movie Interstellar* — Classical and Quantum Gravity **32**, 065001. The DNEG paper behind Gargantua, and where the decision to drop the Doppler asymmetry is explained.
- **K. S. Thorne**, *The Science of Interstellar*.

---

## 🤝 Contributing & license

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under the [MIT License](LICENSE).

<p align="center">Built with ❤️ by <a href="https://github.com/sumitsahoo">Sumit Sahoo</a></p>
