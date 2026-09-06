# Gargantua visual and interaction review

Review date: 2026-09-06. This document separates observations of the starting
implementation from acceptance criteria for the upgrade. It is a review record,
not a claim of scientific accuracy or a measured hardware benchmark.

## Evidence and starting point

The review examined the source renderer, camera, audio analysis, interaction
modules, existing automated tests, and the committed `screenshots/kerr-hero.jpg`
and `screenshots/kerr-interface.jpg` images. Those images are historical repository
artifacts; they do not establish the state of a freshly rendered build.

The starting renderer already has the essential silhouette: a dark central
shadow, a bright foreground disk, the far disk bent above and below it, and a
thin inner ring. Its modular, self-contained WebGL/Web Audio implementation and
tested horizon/ISCO arithmetic are useful foundations to preserve.

| Area | Observation in the starting implementation | Improvement opportunity |
| --- | --- | --- |
| Disk structure | The committed hero image has long, smooth, similarly weighted pink bands; broad arcs read as polished ribbons. | Establish distinct scales of structure: turbulent dark lanes, fine filaments, a bright inner rim, and broken outer material. Preserve the over/under silhouette. |
| Brightness hierarchy | In the interface image the central disk approaches a razor-thin white line, while the broad arcs have relatively uniform brightness. | Protect the shadow and retain structure through the highlights. Use localized emission and controlled flare to give material depth. |
| Background | Sparse RGB-fringed stars and conspicuous grain occupy a nearly uniform black field. | Improve stellar magnitude and color hierarchy, reduce distracting grain, and give the distant field restrained spatial depth. |
| Camera | Score presets vary distance and elevation; continuous orbit, breathing, roll, shake, and pull run together. | Give users legible shot choices, steadier composition, and a clean way to recover the default framing. |
| Music mapping | Bass affects several global effects at once. File onset detection compares bass energy with a 45-frame history. | Distinguish low-end mass, midrange material motion, high-frequency detail, and transient accents; make sensitivity adjustable and time-based. |
| Interface | Tiny telemetry and outlined controls sit over the scene; own-track playback and keyboard controls exist but are visually understated. | Strengthen hierarchy and controls, expose visual direction, and provide an immersive mode with an obvious exit. |
| Accessibility | The initial reduced-motion multiplier lowers selected shake, chromatic aberration, and flash to 25%; it does not govern all continuous motion. | Apply the preference consistently to camera movement and transients; retain explicit user control and usable keyboard focus. |
| Frame pacing | Adaptive quality is measured using the simulation timestep after its 50 ms clamp. | Measure frame rate from real elapsed time, while retaining the clamp for integration stability. |
| Transients | The ring array is spliced while iterating forward, so a shifted ring can miss one update. | Age and remove transients without skipping entries or retaining stale uniforms. |

## Scientific scope

This is an artist-directed relativistic visualization. `render/kerr.js` uses
closed-form Kerr expressions for the horizon and prograde ISCO in units where
the Schwarzschild radius is one. Those scalar calculations are independently
tested.

The current ray shader uses a Schwarzschild-style acceleration and adaptive
RK4 integration, with a restrained gravitomagnetic spin perturbation. It is
**not a full Kerr metric null-geodesic solver**. It integrates a single emitting
and absorbing volume along each ray and adds no synthetic photon-ring outline.
The earlier midpoint integrator, plane-crossing source and added ring described
in the historical review below have been replaced. Finite ray budgets, the spin
perturbation, material density and emissivity, color grading, optical flare, and
music-driven changes remain approximations. Testing the scalar Kerr expressions
does not validate the integrated ray paths.

The starting particle field is rendered in screen space and attenuated near
strongly bent rays; it is not individually traced through the metric. This is an
intentional rendering compromise and should not be described as fully lensed
particle motion. The shader and any public explanation should agree on this.

An actual scientific-accuracy claim would additionally require independent Kerr
reference trajectories, conserved-quantity error measurements, convergence
studies across ray and volume step sizes, and comparisons of shadow boundaries
at multiple inclinations and spins. The limited zero-spin CPU experiment below
helps select a ray step policy; it does not meet this broader acceptance gate.

## Verification criteria

### Rendering and numerical behavior

- Build and compile the actual production GLSL in a browser; no WebGL errors,
  uncaught exceptions, or missing uniforms after boot and interaction.
- Confirm a nonblack output and a warm default disk using real framebuffer
  readback. Such checks detect blank frames and broad regressions; they do not
  judge aesthetics or prove physical correctness.
- Inspect fresh desktop and narrow-screen captures, including each shot and
  palette, a quiet passage, a peak passage, and immersive mode. The main shadow
  must remain readable and control panels must not clip or trap an exit.
- Check quality at both its floor and ceiling; the image must remain coherent
  while the controller stays bounded and avoids repeated target allocation at
  the bounds. Report measurements against the specific browser and hardware.
- Preserve the separate analytical horizon/ISCO tests and do not replace them
  with assertions that merely repeat an implementation expression.
- Keep `smoothstep` edges ordered. Reversed or equal edges are undefined by
  GLSL; use a complemented ascending fade for decreasing transitions.
  See the [Khronos GLSL specification](https://registry.khronos.org/OpenGL/specs/gl/GLSLangSpec.4.60.pdf).

### Music and interaction

- Silence should settle without false continual impacts. A transient should
  produce a short, recoverable accent; sustained energy should produce a
  sustained response rather than repeated indistinguishable flashes.
- Verify frequency and transient descriptors are finite and bounded, recover
  after silence and seek, and behave consistently under different frame rates.
- A reaction amount of zero should remove audio-driven visual modulation.
  Increasing it should change response strength without changing volume.
- File loading should report a useful error on failure and release replaced
  media resources. Transport, duration, and source labels should track the
  selected source; switching back to the score should restore its arrangement.
- Shot and palette controls should update their visible state and affect the
  scene. Native inputs must retain their keys; global shortcuts must not hijack
  a focused select or slider.
- Immersive mode must expose a keyboard-accessible exit. Help must manage focus,
  close with Escape, and restore focus to its opener.
- With reduced motion enabled, automatic camera movement and transient motion
  should be deliberately subdued. Do not describe a reduced multiplier as a
  complete animation pause.

### Delivery and operational constraints

- Run `npm run check`, `npm test`, and a production build after integration.
- Preserve the self-contained runtime, production CSP, PWA/offline behavior,
  and the existing audio/render/direct dependency boundaries.
- Keep payload claims synchronized with the measured build; an upgrade should
  not pass a stale size claim by weakening the assertion.
- A successful automated suite is a regression gate. A visual benchmark claim
  requires comparison material and measured frame pacing on representative
  hardware; it should not be inferred from a software-rendered smoke test.

## Validation record

The first `npm test` run completed with 98 of 100 passing, zero skipped, in
approximately 120 seconds. All renderer, framebuffer, playback, CSP, offline,
analytical geometry, and adaptive-quality checks passed. The two failures were
the module reachability and unused-export gates: another worker added
`audio/features.js` during the run, before connecting it to the engine. This is
a mixed-worktree run, so it establishes no preexisting baseline failure and is
not the final acceptance result.

Browser smoke tests use headless Chrome with SwiftShader, so their timings are
not representative of the user's GPU. Upgrade-specific results should be read
alongside the final integration run.

The new production-camera tests pass all three checks: automatic movement stays
suppressed through a loud peak under reduced motion; explicit close-shot and
zoom control remain available; portrait framing retains a finite, orthonormal
camera basis. The GLSL suite passes all 11 checks, including a new guard against
undefined literal `smoothstep` edges. These checks run without WebGL and are
complementary to the browser compile and rendering checks.

The integrated `npm test` run passed **126 of 126 tests, with zero skipped**, in
103.5 seconds. This includes all 15 browser smoke checks and the offline PWA
suite. New browser coverage verifies sensitivity/volume separation, native
keyboard control isolation, cinema and help focus management, and a generated
two-second PCM WAV imported through the file input and restored to the score.
That run caught and drove fixes to overlay visibility transitions that prevented
their initial focus from landing. The telemetry check now waits for the first
live update rather than relying on a fixed delay under software rendering.

After the zero-response camera behavior was tightened, two additional production
camera tests passed with ordinary motion enabled: score sections cannot redirect
the camera at zero response, while ambient drift and explicit shot selection
remain available. Following the final shader refinement, all **39 targeted
build, GLSL, camera-response, and browser smoke tests passed**, with zero skipped,
in 51.4 seconds. The first upgrade concluded with 128 tests in the suite.
`npm run check` also passed. That production build measured 627.4 KB raw, 169.2 KB gzip, and
141.0 KB brotli; README payload claims and all existing size budgets pass.

The final live CUA review inspected desktop and 390 × 844 layouts, including
the introduction and active controls. No control clipping was observed. The
portrait composition places the black hole higher for the introductory copy
and centers it between the active controls and player during playback. At the
56-second Event Horizon passage, the final material flow no longer showed the
fine woven moiré seen during the earlier long-running shear implementation.
The final portrait inspection at 1:47 retained reachable controls. Close-passage
with Ember and orbit with Polar were also inspected, and cinema exit focus and
Escape recovery were exercised through CUA. Browser logs were empty.

A brief in-app-browser frame sample at 1280 × 720 recorded **55.46 fps average**
and **25.2 ms p95 frame interval**, at 220 ray steps and 0.92 resolution scale.
The sample collected 90 requestAnimationFrame observations and discarded the
first five; test processes were active concurrently. This is a specific local
observation, not a comparison with the starting build, a sustained-load result,
or a cross-device performance benchmark.

## All-angle follow-up

The next review identified a structural limitation in the first upgrade: most
disk emission still depended on a sign change across the y = 0 plane. Exact
in-plane rays stay in that plane, so the principal source never ran. A clamped
path-length multiplier also flattened the difference between shallow and steep
viewing angles. The surrounding volume could conceal these limitations at the
Film angle without fixing them from above, below or directly within the disk.

The previous synthetic ring emitted according to a ray's minimum radius even
when the ray had encountered no luminous material. Its interaction with the
end-of-budget capture heuristic could fill missing integration detail with an
unjustified outline. Capture must prevent background leakage while preserving
foreground emission accumulated before a ray enters the horizon; multiplying
the entire accumulated color by an escape mask would erase the foreground disk.

The replacement uses a single emitting and absorbing volume. Each segment
accumulates `transmittance × source × (1 − exp(−sigma × segmentLength))`, then
attenuates transmittance. The geometric segment length is used, and empty space
is rejected before material noise is evaluated. Two ordered Gauss samples per
segment replace stochastic sampling to reduce grain. The plane-crossing emission and
synthetic photon outline have been removed. RK4 advances the rays; uncertain
near-hole paths receive no background, while accumulated material emission is
retained. These changes improve angle consistency without making this a full
Kerr solver. The [primary-reference audit](INTERSTELLAR-REFERENCE.md) records
which film properties are documented and which material choices remain artistic.
The source function uses fixed chroma and gray emissivity variation; it is not
thermal radiative transfer. Doppler and gravitational shift modulation are
disabled in the default film treatment. The blur-based flare is artist-tuned,
not calibrated to the measured IMAX lens response used by DNEG.

### Independent vacuum-ray check

A separate double-precision CPU experiment evaluated the zero-spin Cartesian
ODE used by the shader, with an initial radius R = 40 and unit initial speed.
It omitted the disk and the spin perturbation. For this setup the conserved
quantity is `|v|² − h²/r³ = 1 − h²/R³`, where `h = |p × v|`. The independent
critical-impact condition at r = 1.5 is therefore
`h_critical² = 1 / (4/27 + 1/R³)`, giving h_critical = 2.5979392143.

The reference used fine RK4 steps, at most 0.004, with conserved-energy error
below 2 × 10⁻¹⁰ for the tested capture and escape trajectories. An experimental
coarse RK4 policy combined `0.10r`, a curvature cap of
`0.11 / sqrt(|acceleration|/r)`, and a horizon-distance limit. Its geometric cap
had not yet been divided by speed; the production shader's later policy is
more conservative. The following observations establish the old budget problem
and inform a useful step range; they are not a validation of final GPU rays.

| Impact above the critical value | Old RK2 after 220 steps | Coarse RK4 escape steps | Coarse outgoing-angle error versus fine reference |
| --- | --- | --- | --- |
| +0.1% | Unresolved | 124 | 0.00130 rad |
| +0.01% | Unresolved | 145 | 0.0124 rad |
| +0.001% | Unresolved | 167 | 0.131 rad |

The earlier `0.18r` RK4 candidate was faster but incorrectly captured the
+0.001% ray. The old RK2 policy left every tested ray within ±1% of the critical
impact unresolved after 220 steps. Near the unstable orbit, small numerical
errors have large effects on outgoing direction; success on a coarse capture
boundary should not be reported as scientific convergence of higher-order
images. A true Kerr comparison, disk quadrature convergence, and GPU floating
point error remain separate work.

The adaptive quality floor is 96 ray steps. Near-critical paths can require more
steps to reach the far disk or escape, so higher-order images may be incomplete
at this floor even when the main disk and shadow remain recognizable. Neither
the CPU experiment nor the structural browser tests establish convergence at
every quality level.

### All-angle regression criteria

The added camera tests exercise exact 0° and ±90° cuts, finite orthonormal
camera frames at both poles, continuity through pole crossings, complete manual
turns, persistent underside orientation, and portrait framing. They also caught
an introductory horizontal offset leaking into an explicit top-down cut; reset
now discards that old composition immediately. All six new camera tests and the
five existing camera/reduced-motion tests pass.

Browser framebuffer coverage checks a luminous foreground band at exact edge-on
incidence, a dark axial center inside a visible polar annulus, broadly circular
polar geometry, and comparable exposure above and below. These are structural
rendering invariants, not screenshot resemblance scores. The first volume build
passed all 16 browser smoke checks, including these views and local audio
roundtrip. Its edge-on strip measured 235/255 average brightness, highlighting
the need to inspect optical-depth saturation visually even when structural
tests pass.

### Final all-angle validation

The final `npm test` integration run passed **135 of 135 tests, with zero
skipped**, in 115.2 seconds. `npm run check` and `git diff --check` passed.
The production build measured **617.8 KB raw, 165.4 KB gzip, and 137.5 KB brotli**;
the README's rounded 618 KB / 138 KB claims and the existing payload budgets
passed without changing their limits.

The final browser run passed all 16 smoke checks, including the exact cardinal
views and imported-audio roundtrip, with no console or WebGL errors. The polar
disk's second-moment ratios were 1.046 from above and 1.051 from below, consistent
with a roughly circular face rather than the earlier oblique appearance. Average
maximum RGB channel values in the axial center were 10.8 and 6.1 out of 255,
against 88.3 and 109.4 in the annular region. The exact edge-on foreground strip
remained luminous at 227.7 out of 255; its high brightness still warrants visual
judgment of texture and saturation. These are framebuffer regression statistics,
not photometric measurements or film-similarity scores.

The final live CUA review inspected Film, close, oblique, exact edge-on, top and
underside views at 1280 × 720, plus the Film view at 390 × 844. A real half-turn
drag checked the opposite azimuth, and manual orbit reached below the disk.
Controls remained reachable and the narrow-screen hints fit. Browser logs were
empty. A brief 85-frame requestAnimationFrame sample reported a mean interval
of 8.43 ms and p95 of 9.6 ms at 220 steps and 0.92 resolution scale. This is a
short local in-app-browser observation, not a sustained benchmark or a measured
performance improvement over the earlier build.

The last 689 × 943 live review caught Film tips clipping during Ascent despite
the introductory framing passing. A final camera correction fits the actual
horizontal ray cone after score FOV, breathing and impact pull, with manual zoom
applied proportionally. Three added tests cover every frame of the four-minute
score under strong impacts, proportional zoom, and isolation of Close passage.
All 25 targeted build and camera checks passed after this correction, alongside
`npm run check`, the production build and whitespace checks. The suite now
contains 138 tests; the full 135-test run above preceded these three additions.
The final live check through Event Horizon at 0:57 retained both disk tips in
the normal 689 × 943 app panel.
