# Interstellar reference audit

Inspected 2026-09-06: James, von Tunzelmann, Franklin and Thorne, *Classical and Quantum Gravity* 32 (2015) 065001, sections 4.1-4.3 and A.6; rendered PDF pages 24-29, including Figures 13, 15 and 16. [Primary paper](https://arxiv.org/pdf/1502.03808).

## Documented constraints

| Property | Reference |
| --- | --- |
| Visual spin | a/M = 0.6 |
| Disk radii | 9.26M-18.70M = 4.63-9.35 Schwarzschild radii |
| Comparison camera | 74.1M; 86.56 degrees from the axis |
| Material | Physically thin; marginally optically thick; uniform 4500 K; not currently accreting |
| Film treatment | Frequency and brightness shifts omitted; veiling flare added |
| Color pipeline | 6500 K white balance; nonlinear film-layer interactions explicitly **not** modeled |

DNGR supported an attenuated plane, a roughly 17-million-voxel volume, and procedural close-up material. Volume sampling accumulated emission and extinction at a footprint-selected resolution. The paper supplies no numerical thickness profile, opacity map, or film texture-animation speed. [Sections 4 and A.6](https://arxiv.org/pdf/1502.03808).

Visual inspection: Figure 15a contains a nearly complete **very thin** inner luminous circle, subordinate to the broad disk arcs. The reference does not justify a thick, uniformly bright outline. Figure 16 adds substantial soft flare, including inside the apparent shadow. No RGB ratios or thickness measurements are asserted here. [Figures 15-16](https://arxiv.org/pdf/1502.03808#page=27).

## Viewpoint

DNEG's chief scientist explicitly explains the difference between the familiar horizontal crossing and a roughly circular black-hole image through observer viewpoint. The linked video was not available in the text browser; this audit does not claim to have inspected it. [DNEG, 2020](https://www.dneg.com/news/new-black-hole-imagery).

For KERR, retain one three-dimensional material at every inclination. An overhead view should expose the annulus; the broad folded arcs should emerge continuously toward the equatorial view. Test 0, 3.44, 15, 35, 60 and 85 degrees above the disk. These are proposed coverage angles, not six documented film shots.

## Implementation proposals, not measured film parameters

- Start with a vertical Gaussian scale height H = 0.02-0.035r, tapered at both radial boundaries. This is a thin-volume tuning range, not a recovered production setting.
- Set an initial vertical optical-depth target of 0.7-1.5. Normalize density by H so changing thickness does not accidentally change column brightness. Use `rho = tau * exp(-0.5 * (y/H)^2) / (sqrt(2*pi)*H)` and `alpha = 1-exp(-rho*ds)`; accumulate `transmittance * sourceColor * alpha`, then attenuate transmittance.
- Put coherent, orbiting density variation at multiple heights. Separate sparse absorbing lanes from bright emissive strands; increasing absorption alone makes both darker.
- Remove the dominant planar emission while evaluating the volume. Otherwise its unchanging sharp crossing can conceal the material's depth and motion. Keep narrow higher-order disk images if the ray integration resolves them.
- Inspect fixed-camera sequences at 0, 30, 90 and 240 seconds. Persistent material displacement, shape evolution and changing occlusion should remain visible without camera movement or global exposure pumping. Bounded flow is an approximation; do not label it an exact orbital solution.
- Validate line-integral convergence by halving the disk sampling step at identical time and pose. Large changes in brightness, apparent thickness or striping indicate a sampling issue, not a need for additional bloom.
- Do not increase the physical density to imitate lens flare. First verify the unbloomed volume, then apply the optical spread in postprocessing.

No production files were changed for this audit.
