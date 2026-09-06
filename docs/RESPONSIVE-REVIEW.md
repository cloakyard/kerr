# Responsive experience and screenshot review

Reviewed 2026-09-06. This record covers the current README gallery and responsive
interface. The earlier `kerr-hero.jpg` and `kerr-interface.jpg` remain historical
artifacts used by the [renderer review](VISUAL-REVIEW.md); the README now uses
fresh PNGs from the current volume renderer. The gallery was refreshed again
after adopting the header's orbit mark as the official logo.

## UX audit and implemented improvements

The audit prioritized entering the experience, keeping the disk legible, and
preserving music controls as the viewport changes.

| Layout or flow | Issue identified | Implemented improvement |
| --- | --- | --- |
| Short landscape and small portrait entry | Introductory copy could push the start action out of reach. | Secondary copy contracts at short heights; the remaining entry content can scroll within the available viewport. Start and Own track remain reachable. |
| Landscape playback | A tall player consumed the viewing stage and crowded its controls. | A two-row layout groups track/actions above timeline/status; the spectrum and secondary readouts yield space. Camera framing reserves room above the player. |
| Tablet and intermediate desktop | Side panels and the player competed with the disk, with tips or lower material too close to the interface. | View controls collapse at width ≤1100px or height ≤560px, and secondary telemetry clears the stage. Camera fitting accounts for toolbar/player space; cinema recenters the subject. |
| Narrow phone toolbar | Branding and display actions competed for limited horizontal space. | Labels and spacing compact progressively; below 380px, the fullscreen icon is removed while View, Cinema and Help remain. The portrait player stacks its actions and constrains long track titles. |
| Compact scene controls | Permanently exposed controls covered the scene; a short panel also needed a reliable exit. | View opens a bounded, scrollable panel only when requested. Initial focus, Escape and focus restoration make it usable from the keyboard; the expanded state is announced. |
| Help and cinema | Scrolling help could lose its close action; cinema and reduced-motion visibility changes exposed focus-recovery problems. | Help keeps its heading and exit outside the scrolling, keyboard-focusable manual. Closing returns to the previous cinema state; exits restore control focus, including with reduced motion. |
| Touch and screen edges | Mouse/keyboard hints and small targets did not suit touch interaction; edge controls needed inset-aware spacing. | Coarse-pointer layouts show pinch guidance and enlarge controls. Safe-area variables offset the header, player and relevant edge controls; dynamic viewport heights bound scrolling panels. |

The open View panel deliberately trades some scene visibility for readable
controls. Cinema remains the direct route to an unobstructed view, with its
own visible exit. These are implemented layout choices; the physical-device
validation opportunities below remain separate from the emulated checks.

## Capture provenance

The [manifest](../screenshots/capture-manifest.json) records every image's exact
viewport, checksum, visible-control bounds, runtime telemetry and capture time.
All seven files were inspected locally after capture.

- Build SHA-256: `adba7e20e1b308ba7769372e1192393c2987a283f2e3802b21bd8d13f081f903`.
- Captured 2026-09-06, 11:26:00-11:26:35 UTC, in Chrome 152.0.7977.76.
- Capture build: 625.2 KB raw, 167.3 KB gzip and 139.0 KB brotli.
- Actual renderer: Apple M2 Max through ANGLE Metal. These are local Chrome
  captures with viewport/touch emulation, not physical-device measurements.
- Every capture: DPR 1, reduced motion off, Film view, Gargantua palette,
  response 100%, score display **0:35 / Ascent**. The clock remained live.
- Every capture used 220 ray steps at 0.92 resolution scale. The normal
  adaptive renderer selected these values.
- All captures recorded zero horizontal page overflow, successful center hit
  tests for visible controls, no browser errors and WebGL error zero.

The strengthened orbit mark remains distinct and aligned with the wordmark
in all six interface captures, including the smallest phone and open View
panel. It clears the display controls at each captured width. Cinema hides
the header as intended.

## Captured viewport matrix

Dimensions are CSS viewport pixels. Each linked image retains its original
aspect ratio and direct browser pixels.

| Capture | Viewport | Touch emulation | Visual finding |
| --- | --- | --- | --- |
| [Desktop cinema](../screenshots/kerr-desktop-cinema.png) | 1440 x 900 | No | Both tips fit; the scene fills the frame and Show controls remains visible. |
| [Desktop interface](../screenshots/kerr-desktop-interface.png) | 1440 x 900 | No | Observation controls and telemetry flank the subject; the full player fits below. |
| [Tablet portrait](../screenshots/kerr-tablet-portrait.png) | 768 x 1024 | Yes | Closed View panel leaves the scene clear; player and controls fit. |
| [Mobile portrait](../screenshots/kerr-mobile-portrait.png) | 390 x 844 | Yes | Complete disk and stacked player remain separate; toolbar labels fit. |
| [Mobile controls](../screenshots/kerr-mobile-controls.png) | 390 x 844 | Yes | Camera, palette, response and reset fit the open panel; player remains visible. |
| [Mobile landscape](../screenshots/kerr-mobile-landscape.png) | 844 x 390 | Yes | Subject sits above the compact two-row player; no vertical control collision is visible. |
| [Small mobile](../screenshots/kerr-mobile-small.png) | 360 x 640 | Yes | View, Cinema and Help remain; removing the fullscreen icon leaves room. |

The open View panel intentionally overlays part of the scene. Every recorded
visible phone/tablet control is at least 44px high, including both selects,
response and Reset inside the open panel. The fullscreen and Help buttons are
44 x 44px. These measurements follow a final correction to panel-specific CSS
that had overridden the general touch sizing.

## Interaction evidence

The [responsive suite](../test/responsive.test.js) exercises ten
layout scenarios: 320 x 568, 568 x 320, 390 x 844, 844 x 390, 689 x 943,
768 x 1024, 1024 x 768, 1280 x 720, 1920 x 1080 and 2560 x 1080.

| Check | Recorded result |
| --- | --- |
| Intro and live controls | Ten viewport cases passed overflow, reachability, target bounds, center-hit and control-collision checks. Short introductions may scroll. |
| Compact View disclosure | Opening, panel scrolling, initial focus and Escape/focus recovery passed. Touch targets in the panel and the fullscreen button meet the tested 44px dimensions. Compact means width at most 1100px or height at most 560px. |
| Help and cinema | Help remained reachable from cinema; closing help restored cinema and its exit; leaving cinema restored the original control focus. |
| Imported file and rotation | A long filename, duration, playing state and advancing clock survived 320 x 568 to 568 x 320. Score, Own track, Voicing and Volume stayed reachable. |
| Reduced motion | Layout/focus scenarios used reduced-motion emulation. Motion behavior is covered separately by the camera and smoke tests. |
| Touch guidance | Touch-emulated introductions show PINCH and hide SCROLL guidance. |

Before the logo-only branding update, the responsive integration run passed
**152 of 152 tests, zero skipped, in 228.8 seconds**, including all 12 responsive
checks and all 16 framebuffer/interaction checks. Static checks, the production
build and whitespace checks also passed. An additional live visual review
found all four open-panel controls readable at 568 x 320
and 390 x 844 with touch emulation.

The subsequent branding update passed **25 targeted checks: 12 build tests
and 13 PWA tests, zero skipped or failed**. These verify the shared logo
geometry, versioned icon references, PNG dimensions, favicon transparency,
install tiles and offline decoding. Static checks, build and whitespace also
passed. Before opening the pull request, the complete final build then passed
**154 of 154 tests, zero skipped or failed, in 198.4 seconds**. This includes
the branding checks together with the audio, camera, responsive and browser
framebuffer suites. Static checks, the production build and whitespace checks
also passed; all seven capture checksums match the final production build.

## Reproducing the gallery

Run `node scripts/capture-screenshots.mjs` to rebuild and capture the full set.
For a separate review, use
`node scripts/capture-screenshots.mjs --only mobile-portrait,mobile-controls --out /tmp/kerr-captures`.
`--software` selects SwiftShader. The [script](../scripts/capture-screenshots.mjs)
records the actual renderer and quality without replacing production uniforms.
Regenerate final images together so the manifest and gallery share one build.

The README leads with cinema, followed by the desktop interface and tablet/phone
portraits at comparable display heights. Images are linked for full-size review;
the additional compact states remain linked without crowding the gallery.

## Remaining review opportunities

- Check the same flows on a physical phone and tablet, including Safari,
  changing browser chrome, notches, rotation and sustained frame pacing.
  Safe-area support is implemented; these captures do not exercise real insets.
- Review screen-reader announcements and touch comfort during actual playback,
  and add entry/file-error captures to complement the seven live-state images.
  Geometry and focus tests establish reachability, not a complete accessibility
  or ergonomics audit.
