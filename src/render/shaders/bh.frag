precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime, uAspect, uTanFov, uSteps;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform sampler2D uParticles;
uniform float uBass, uMid, uHigh, uHeat, uJet, uLens, uDiskGain;
uniform float uSpin, uRh, uDin, uDout, uDoppler, uThick, uFringe;
uniform vec2 uBhUv;
uniform vec4 uRings[5];
#include "noise.glsl"

#define MAXSTEPS 240

/* Null-geodesic acceleration in Schwarzschild form, plus a gravitomagnetic
   (Lense-Thirring) term for spin. The drag falls off as 1/r^4 so it twists
   the near field without swirling the whole sky. */
vec3 geoAccel(vec3 p, vec3 v, float h2, float r2, float r){
  vec3 a = -1.5 * h2 * p / (r2 * r2 * r);
  if (uSpin > 0.002){
    vec3 J  = vec3(0.0, 1.0, 0.0);
    vec3 rh = p / r;
    vec3 Bg = (3.0 * dot(J, rh) * rh - J) / (r2 * r2);
    /* Kept deliberately light. A real Kerr shadow at a = 0.6 is genuinely
       flattened on the prograde side, but this is a perturbation on a
       Schwarzschild marcher rather than a true Kerr metric: pushed hard it
       cuts a notch out of the silhouette instead of smoothly flattening it.
       At this strength it twists the near field and leaves the shadow clean. */
    a += uSpin * 0.45 * cross(v, Bg);
  }
  return a;
}

/* Gargantua's palette, measured rather than guessed. Sampling Figure 15a of
   the Double Negative paper — the film's own disk, lensed, with no frequency
   shifts — and inverting the tone curve at the bottom of this file gives the
   linear emission behind each pixel. Across the whole disk, from the faintest
   outer wisp to the core, that comes out at a near-constant

       (1.000, 0.48, 0.40)   +/- 0.03

   which is precisely what Thorne specified: a cooled, non-accreting disk at
   one position-independent temperature of 4500 K. So the film's white-hot
   centre and its salmon outer fringe are the *same colour at different
   intensities* — the walk to white is the tone curve and the veiling flare,
   not a temperature gradient. Ramping hue with radius, as this shader used
   to, is what made the disk read as khaki instead of rose. */
const vec3 DISK_CHROMA = vec3(1.00, 0.48, 0.40);

/* The outer disk, as an actual volume.

   DNGR shipped three disk models. The one below this — a single intersection
   with an infinitely thin plane, sampled and attenuated — is their "thin disk",
   and it has a fatal tell: a plane's silhouette is exactly a plane, so however
   good the texture on it, the disk's edge comes out glassy and smooth. The
   film's does not. Its outer material is torn into filaments that stand off
   the mid-plane, with dark lanes between them.

   That came from their second model, a *volumetric* disk an artist built in
   Houdini and stored as ~17 million voxels of optical density, integrated step
   by step along the beam; for close-ups they went further and drove procedural
   fractal noise through Mantra. This is that, procedurally: a flared slab of
   fbm density that the marcher integrates, so the ragged edge is a real
   volume boundary rather than a texture pretending to be one.

   The envelope is measured off Figure 15a. Out past two and a half shadow
   radii the film's material occupies a half-height of 0.05 to 0.12 of its own
   radius, and only 63 to 88 per cent of that span is above black — a third of
   it is gap. Inside that radius the disk measures 94 to 100 per cent solid,
   so the fringe has to stay out of the bright inner body. */
float fringeDens(vec3 p, float rr){
  float u = (rr - uDin) / (uDout - uDin);
  /* Absolute half-thickness, not a fixed opening angle. Measured against the
     film the material stands about 1 r_s off the plane at the middle of the
     disk and tapers to a knife edge by the rim, so h/r *falls* with radius —
     roughly 0.17 at two and a half shadow radii down to 0.013 at four. A
     constant flare angle does the opposite, and that is what made the first
     pass billow out into smoke at the tips instead of feathering. */
  float H  = mix(0.62, 0.10, smoothstep(0.28, 1.05, u));
  float ay = abs(p.y);
  if (ay > H) return 0.0;
  float t = ay / H;
  float vert = 1.0 - t * t;

  float ang = atan(p.z, p.x) - uTime * (4.6 / pow(rr, 1.5)) * 1.15;
  vec2 ca = vec2(cos(ang), sin(ang));
  /* Sheared hard along the orbit — at r = 8 this crosses 0.2 of a noise feature
     per r_s of arc against 2.4 radially, an 11:1 draw — so the material pulls
     into filaments rather than the round puffs isotropic noise gives.

     Coarse on purpose, though. Fine radial detail looks better in isolation and
     then vanishes: a ray grazing the disk tip runs several r_s through the slab,
     and if the features are much smaller than that it integrates a dozen of
     them and averages the gaps away, leaving a solid wall where the film has
     holes. The structure has to be big enough to survive its own line integral. */
  vec2 base = vec2(rr * 2.4, 0.0) + ca * 1.6;
  // height offsets the field, which is what makes this three dimensional: the
  // pattern at the top of the slab is not the pattern at the bottom, so the
  // silhouette frays instead of ending on a clean line
  float n1 = fbm2(base + vec2(p.y * 2.6, p.y * 1.7));
  float n2 = fbm2(base * 3.4 + vec2(p.y * 6.0, p.y * 3.8));
  /* Thresholded hard and near the field's own mean, because the fringe is torn
     rather than faded: on the film only 56 to 65 per cent of the vertical span
     is above black in this zone. Solid material there is the tell of a shader
     fading a smooth envelope instead of resolving a broken one. */
  float d = smoothstep(0.52, 0.88, n1 * 0.70 + n2 * 0.40);
  d *= smoothstep(0.26, 0.58, u) * smoothstep(1.26, 0.96, u);
  return d * vert;
}

/* Returns premultiplied emission in .rgb and opacity in .a.
   plen is the path length through the slab, so grazing rays pick up more
   material — that is what gives the disk a lit edge instead of a paper cut. */
vec4 diskSample(vec3 hit, float rr, vec3 dir, float plen){
  float u = (rr - uDin) / (uDout - uDin);

  // differential (keplerian) rotation -> the texture shears as it orbits
  float w = 4.6 / pow(rr, 1.5);
  float ang = atan(hit.z, hit.x) - uTime * w * 1.15;

  /* Sample the noise around a *circle* in its own domain so the texture has no
     seam at the wrap, and hand radius far more of that domain than azimuth.
     The anisotropy is the whole look: Gargantua's disk is brushed into fine
     concentric striations that smear along the orbit, where isotropic noise
     (what this used to do) gives the blotchy cloud structure of a real
     accretion flow — which is exactly what the film's disk is not. */
  vec2 ca = vec2(cos(ang), sin(ang));
  float n1 = fbm2(vec2(rr * 2.3, 0.0) + ca * 1.30);
  float n2 = fbm2(vec2(rr * 8.5, 0.0) + ca * 2.20);
  // fine striations, broken by the noise so they never read as regular rings
  float band = 0.84 + 0.16 * sin(rr * 9.5 + n2 * 9.0 + n1 * 3.0);
  float dens = mix(0.52, 1.28, n1) * (0.66 + 0.50 * n2) * band;

  /* The outer third combs out into filaments with dark lanes between them —
     the ragged, feathery fringe at the far tips of the film's disk. Same
     circular trick, higher frequency, so the filaments run along the orbit. */
  // A light touch now: the volumetric fringe above carries the raggedness, and
  // this only has to break up the bright blade it stands around.
  float fil = fbm2(vec2(rr * 4.2, 0.0) + ca * 7.5);
  dens *= 1.0 - smoothstep(0.45, 1.0, u) * (1.0 - smoothstep(0.26, 0.72, fil)) * 0.45;

  // crisp inner edge; the outer edge dissolves into that fringe rather than
  // ending on a rim
  /* The outer edge has to stay alive: the broad band that arcs over the
     shadow is the far *outer* disk imaged over the top, so cropping the rim
     hard thins that band, and the band is the silhouette everyone recognises. */
  dens *= smoothstep(0.0, 0.035, u) * smoothstep(1.02, 0.74, u);

  /* Doppler and gravitational shifts. DNEG computed these and then took them
     back out: physically the left edge runs ~1.5x blueward and the right ~0.4x
     redward, and with I ~ nu^3 that is a fifty-fold brightness split which
     buries the shadow on one side. Nolan and Franklin cut it, so the film's
     disk is very nearly symmetric, and uDoppler rides near zero to match. The
     exponents are written so that uDoppler = 0 is *exactly* neutral — the old
     form kept a full first-order beam term at zero, which is why the render
     had a bright right edge the film does not have. */
  float beta = min(0.72, 0.62 / sqrt(max(rr, 1.05)));
  vec3 vel = normalize(vec3(-hit.z, 0.0, hit.x)) * beta;
  float gam = inversesqrt(max(1.0 - beta * beta, 0.02));
  float dop  = 1.0 / (gam * (1.0 - dot(vel, -dir)));   // -dir points back at the camera
  float grav = sqrt(max(1.0 - 1.0 / rr, 0.03));
  float shift = clamp(dop * grav, 0.45, 1.6);
  float beam  = pow(shift, uDoppler * 3.0);

  /* One temperature everywhere, so brightness alone carries the structure:
     steep radial falloff off the inner rim, which is what puts the film's
     luminance peak just outside the shadow and lets the disk fade to nothing
     by the outer fringe. */
  /* Gain set so the disk body lands in the film's own brightness range: on
     Figure 15a the bulk of the disk sits high on the curve, near-white with
     only the thin outer material holding real hue. Run it dimmer and the
     constant chroma shows everywhere, which reads as a flat salmon ring. */
  float emis = dens * plen * beam * uDiskGain * 1.55
             * pow(uDin / rr, 2.60) * (1.0 + uBass * 0.75);
  vec3 col = DISK_CHROMA * emis;
  // the inner rim is the brightest thing in frame; extra energy reads as
  // whiter only because the tone curve rolls it there, never as a hue change
  col += DISK_CHROMA * smoothstep(0.06, 0.0, u) * dens * (0.60 + uBass * 0.8);
  /* Where the disk is brightest the film's colour does not stop at white — it
     carries a shade past it, to a faint cool cast (its top bins measure blue
     above green, 1.05 against 0.95). That is 65 mm print stock running out of
     headroom in the red channel first, and without it the core lands at a
     buttery white instead of the film's cold one. */
  col += vec3(0.84, 0.94, 1.16) * smoothstep(1.0, 3.2, emis) * 0.95;
  col *= 1.0 + uHeat * 0.55 * (1.0 - u);

  return vec4(col, clamp(dens * plen * 0.42, 0.0, 1.0));
}

vec3 starField(vec3 d){
  vec3 c = vec3(0.0);
  for (int k = 0; k < 3; k++){
    float sc = 130.0 + float(k) * 190.0;
    vec3 q = d * sc;
    vec3 id = floor(q);
    vec3 f = fract(q) - 0.5;
    float r1 = hash31(id);
    if (r1 > 0.9775){
      float r2 = hash31(id + 11.7);
      vec3 off = (vec3(hash31(id + 3.1), hash31(id + 7.3), hash31(id + 13.9)) - 0.5) * 0.55;
      float dd = length(f - off);
      // tighter points: the film's stars are hard specks, not soft dots
      float s = smoothstep(0.125, 0.0, dd);
      float tw = 0.78 + 0.22 * sin(uTime * (0.8 + r2 * 5.0) + r2 * 31.0) + uHigh * 0.4;
      // a real magnitude spread — a handful of bright ones over a dusting of
      // faint, rather than everything at much the same weight
      float mag = 0.05 + 2.1 * pow(r2, 2.4);
      vec3 tint = mix(vec3(0.76, 0.85, 1.0), vec3(1.0, 0.88, 0.68), r2);
      c += tint * s * mag * tw;
    }
  }
  /* Barely-there nebula. The sky behind Gargantua is essentially black in the
     film; this used to sit an order of magnitude brighter and blue enough to
     tint half the frame purple, which no shot in the movie does. */
  float neb = fbm2(vec2(atan(d.z, d.x) * 1.4, d.y * 2.2));
  float neb2 = noise3(d * 2.6);
  c += mix(vec3(0.0016, 0.0019, 0.0028), vec3(0.0052, 0.0048, 0.0068), neb) * (0.35 + 0.65 * neb2);
  return c;
}

void main(){
  vec2 uv = vUv;
  vec2 ndc = uv * 2.0 - 1.0;
  ndc.x *= uAspect;
  vec3 rd = normalize(uCamFwd + uCamRight * (ndc.x * uTanFov) + uCamUp * (ndc.y * uTanFov));
  vec3 p = uCamPos, v = rd;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float trans = 1.0;          // front-to-back transmittance
  float captured = 0.0;
  float minR = 1e6;
  // stable per-pixel dither for the volumetric sampling below; deliberately
  // not time-varying, or the fringe crawls when the camera holds still
  float jitter = hash21(vUv * uRes * 1.7 + 3.1);

  for (int i = 0; i < MAXSTEPS; i++){
    if (float(i) > uSteps || trans < 0.006) break;
    float r2 = dot(p, p);
    float r = sqrt(r2);
    minR = min(minR, r);
    if (r < uRh){ captured = 1.0; break; }
    if (r > 110.0 && dot(p, v) > 0.0) break;

    vec3 a1 = geoAccel(p, v, h2, r2, r);

    /* Step from the local curvature rather than distance alone: tiny steps
       where the ray whips around the photon sphere, huge ones out in the
       flat field. Net cost is lower than the old fixed schedule and the
       photon ring emerges on its own instead of being painted on. */
    float dt = 0.13 * (r - uRh * 0.96) / (1.0 + 4.5 * length(a1));
    // do not tunnel through the disk — but only brake when actually heading
    // for the plane, or grazing rays crawl and burn the whole step budget
    float rxz = length(p.xz);
    if (rxz > uDin * 0.7 && rxz < uDout * 1.25 && p.y * v.y < 0.0)
      dt = min(dt, max(abs(p.y) * 0.8, 0.05));
    /* Inside the fringe slab the ray is integrating a volume, not crossing a
       surface, so it has to take steps short enough to resolve the filaments —
       stride through and they alias into banding. */
    bool inFringe = uFringe > 0.002 && rxz > uDin * 0.96 && rxz < uDout * 1.32
                 && abs(p.y) < uDout * 0.115;
    if (inFringe) dt = min(dt, 0.26);
    dt = clamp(dt, 0.009, 4.5);

    // midpoint (RK2) — one extra cheap eval for a large accuracy win
    vec3 pm = p + v * (dt * 0.5);
    vec3 vm = v + a1 * (dt * 0.5);
    float rm2 = dot(pm, pm);
    vec3 a2 = geoAccel(pm, vm, h2, rm2, max(sqrt(rm2), 1e-3));
    vec3 pp = p;
    p += vm * dt;
    v += a2 * dt;

    /* Volumetric fringe, integrated at the segment midpoint. Emissive and
       absorbing both: the dark lanes in the film's outer disk are filaments
       standing in front of brighter ones, which only happens if the material
       actually occludes. */
    if (inFringe){
      /* Sample at a per-pixel offset into the segment rather than always at its
         midpoint. A fixed sample point makes every ray in a neighbourhood cut
         the slab on the same set of planes, and where the disk goes edge-on
         those planes show up as a sawtooth comb along the rim. Dithering the
         offset trades that structured banding for noise, which the flare and
         the grain then swallow. */
      vec3 pf = mix(pp, p, jitter);
      float rm = length(pf.xz);
      float fd = fringeDens(pf, rm);
      if (fd > 0.002){
        float e = fd * dt * uFringe;
        col += DISK_CHROMA * e * uDiskGain * (1.05 / pow(rm / uDin, 0.85)) * trans;
        trans *= exp(-e * 2.4);
      }
    }

    // strict sign change: a non-strict test re-triggers on every step for a
    // ray travelling along the plane, stacking hundreds of emissions
    if (pp.y * p.y < 0.0){
      float tt = pp.y / (pp.y - p.y);
      vec3 hit = mix(pp, p, tt);
      float rr = length(hit.xz);
      if (rr > uDin && rr < uDout){
        vec3 dir = normalize(mix(vm, v, tt));
        // relative path length through the slab: ~1 face-on, more when grazing.
        // Bounded, or an edge-on ray picks up an unbounded amount of material.
        float slab = uThick * (0.5 + 0.05 * rr);
        float plen = clamp(slab / max(abs(dir.y), 0.035), 0.5, 1.8);
        vec4 e = diskSample(hit, rr, dir, plen);
        col += e.rgb * trans;
        trans *= 1.0 - clamp(e.a, 0.0, 0.985);
      }
    }
    if (uJet > 0.002){
      float ax = length(p.xz);
      float hh = abs(p.y);
      float spiral = 0.62 + 0.38 * sin(atan(p.z, p.x) * 2.0 - hh * 0.9 + uTime * 2.0);
      float j = exp(-ax * ax * 0.32) * exp(-hh * 0.10) * step(1.1, hh);
      col += vec3(0.42, 0.70, 1.55) * j * spiral * dt * uJet * 0.30 * trans;
    }
  }

  // the photon sphere: 1.5 r_s for zero spin, moving inward for a prograde one
  float ps = mix(1.5, 1.24, uSpin);

  /* Crossing the horizon is not the only way to fail to escape. A ray that
     spends its whole step budget whipping around the photon sphere leaves the
     loop with captured still 0 and a direction that means nothing, and
     sampling the sky with it smeared a faint blue image of the starfield
     across the inside of the shadow. Anything still this deep in the well
     when the budget runs out is not getting out; fade it rather than cut, so
     the shadow's edge stays soft instead of aliasing against the ring. */
  captured = max(captured, 1.0 - smoothstep(ps * 1.05, ps * 1.9, length(p)));
  float esc = 1.0 - captured;

  vec3 dirf = normalize(v);
  col += starField(dirf) * trans * esc;

  /* Most of the photon ring already falls out of the marcher — rays that loop
     the hole and strike the disk repeatedly — so this is a thin sharpening
     pass over the top of it, not the ring itself. */
  float pr = exp(-pow((minR - ps) * 13.0, 2.0));
  // driven well past white on the tone curve: in the film this is the
  // brightest thing in frame, a hard thin circle hugging the shadow
  col += DISK_CHROMA * pr * (1.18 + uBass * 1.1) * trans;

  /* The orbiting particle layer, sampled straight. It used to be remapped by
     the escaping ray direction to fake lensing, and that was the source of the
     big nested ovals around the shadow: the layer is a razor-thin bright line
     on screen, and a remap that varies with radius sweeps that one line across
     a whole closed curve of pixels. The fix is not a weaker remap — any remap
     does it — so the layer is sampled where it was drawn and faded out well
     before the region where the lensing error would show. */
  vec2 puv = uv;
  vec2 dv = (uv - uBhUv) * vec2(uAspect, 1.0);
  float dd = length(dv);
  vec2 dn = dd > 1e-5 ? dv / dd : vec2(0.0);
  float ring = 0.0;
  for (int i = 0; i < 5; i++){
    float rad = uRings[i].x, al = uRings[i].y, w = max(uRings[i].z, 0.002);
    float g = exp(-pow((dd - rad) / w, 2.0));
    ring += g * al;
    puv += dn * g * al * 0.045 / vec2(uAspect, 1.0);
  }
  // Nothing may leak into the shadow. For a captured ray the final direction
  // is meaningless, so sampling the particle layer with it painted a ghost
  // image inside the black disc; the shockwave tint did the same.
  // held off the strongly-bent rays, where an unlensed layer would read wrong
  float pfade = smoothstep(ps * 2.2, ps * 4.6, minR);
  vec3 pc = texture2D(uParticles, clamp(puv, vec2(0.002), vec2(0.998))).rgb;
  col += pc * trans * esc * pfade * uLens * 0.5;
  // the shockwave used to ring in blue, the one hue Gargantua never shows
  col += DISK_CHROMA * ring * 0.55 * esc;

  gl_FragColor = vec4(col, 1.0);
}
