precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime, uAspect, uTanFov, uSteps;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform sampler2D uParticles;
uniform float uBass, uMid, uHigh, uHeat, uJet, uLens, uDiskGain;
uniform float uPulse, uEnergy;
uniform vec3 uChroma;
uniform float uSpin, uRh, uDin, uDout, uDoppler, uThick, uFringe;
uniform vec2 uBhUv;
uniform vec4 uRings[5];
#include "noise.glsl"
#define MAXSTEPS 240

// Schwarzschild geodesic acceleration plus a restrained spin perturbation.
// This is not the full Kerr metric used by DNGR. See the reference audit.
vec3 geoAccel(vec3 p, vec3 v, float h2, float r2, float r){
  vec3 a = -1.5 * h2 * p / (r2 * r2 * r);
  vec3 radial = p / r;
  vec3 field = (3.0 * radial.y * radial - vec3(0.0, 1.0, 0.0)) / (r2 * r2);
  return a + uSpin * 0.45 * cross(v, field);
}
vec3 acceleration(vec3 p, vec3 v, float h2){
  float r2 = max(dot(p, p), 0.04);
  return geoAccel(p, v, h2, r2, sqrt(r2));
}

// The default warm chroma is an artistic match, not a measured spectral model.
// DNGR's film treatment used a uniform-temperature disk without Doppler colour.
const vec3 DISK_CHROMA = vec3(1.00, 0.48, 0.40);

// Finite-lived Keplerian advection. Each population vanishes before its phase
// resets. Slow radial transport and independent evolution deform the material
// in addition to its orbit; it cannot behave like a rigid rotating photograph.
void flowCoords(vec2 xz, float rr, out vec2 ca, out vec2 cb, out float blend){
  float phase = fract(uTime / 18.0);
  float w = 3.5 / pow(rr, 1.5);
  float angle = atan(xz.y, xz.x) - uTime * 0.10;
  float a = angle - (w - 0.10) * phase * 18.0;
  float b = angle - (w - 0.10) * fract(phase + 0.5) * 18.0;
  ca = vec2(cos(a), sin(a)); cb = vec2(cos(b), sin(b));
  blend = 0.5 - 0.5 * cos(phase * 6.28318530718);
}

// Cylindrical material coordinates, with height contributing to every octave.
// Large eddies break the disk into streams; narrow ridges stretch along orbits.
vec3 flowMaterial(vec2 ca, float rr, float y){
  float inflow = rr + uTime * 0.024;
  vec3 q = vec3(ca * 4.0, inflow * 1.3);
  q += vec3(y * 1.7, y * 2.1, y * 1.4 + sin(uTime * 0.19) * 0.7);
  float eddy = noise3(q);
  vec3 fil = vec3(ca * 7.5, inflow * 12.0 + eddy * 3.5);
  fil += vec3(y * 3.2, y * 2.3, y * 3.1 + uTime * 0.043);
  float strand = noise3(fil);
  float ridge = pow(1.0 - abs(2.0 * strand - 1.0), 3.0);
  float lane = smoothstep(0.26, 0.76, eddy);
  return vec3((0.015 + lane * lane * 2.2) * (0.08 + ridge * 2.0),
              0.25 * eddy + 0.75 * ridge, eddy);
}

float diskHeight(float u){
  // Thin, tapered volume. These dimensions are visual tuning, not values
  // published by DNEG; the paper specifies no unique thickness profile.
  return (0.18 + 0.18 * sin(clamp(u, 0.0, 1.0) * 3.14159265))
       * (1.0 - 0.58 * smoothstep(0.55, 1.10, u));
}

vec2 fringeDens(vec3 p, float rr){
  float u = (rr - uDin) / (uDout - uDin);
  float h = diskHeight(u);
  if (u < -0.025 || u > 1.10 || abs(p.y) > h * 1.6) return vec2(0.0);
  vec2 ca, cb; float blend;
  flowCoords(p.xz, rr, ca, cb, blend);
  vec3 material = mix(flowMaterial(cb, rr, p.y), flowMaterial(ca, rr, p.y), blend);
  // Changing scale height and corrugation make the upper and lower faces
  // distinct 3D surfaces. A top-down ray sees their depth and self-absorption.
  float warp = (material.z - 0.5) * h * 0.60;
  float z = (p.y - warp) / h;
  float vertical = exp(-z * z * 3.2);
  float edge = smoothstep(-0.02, 0.035, u) * (1.0 - smoothstep(0.80, 1.10, u));
  float density = material.x * vertical * edge;
  // Vertical optical depth stays comparable as the disk tapers.
  return vec2(density / h, material.y);
}

// A source function and Beer-Lambert opacity for one physical path segment.
// There is no additional mid-plane texture, intersection flash, or drawn ring.
vec4 diskSample(vec3 p, float rr, vec3 dir, float ds){
  vec2 m = fringeDens(p, rr);
  if (m.x < 0.002) return vec4(0.0);
  float u = clamp((rr - uDin) / (uDout - uDin), 0.0, 1.0);
  float sigma = m.x * 0.72;
  float alpha = 1.0 - exp(-sigma * ds);
  float beta = min(0.72, 0.62 / sqrt(max(rr, 1.05)));
  vec3 vel = vec3(-p.z, 0.0, p.x) / max(rr, 0.01) * beta;
  float gam = inversesqrt(max(1.0 - beta * beta, 0.02));
  float dop = 1.0 / (gam * (1.0 - dot(vel, -dir)));
  float grav = sqrt(max(1.0 - 1.0 / rr, 0.03));
  float beam = pow(clamp(dop * grav, 0.45, 1.6), uDoppler * 3.0);
  float radial = pow(uDin / max(rr, uDin), 2.5);
  float pulse = exp(-pow((u - uPulse) * 7.0, 2.0)) * uPulse;
  // Gray emissivity varies at fixed chroma: an artistic filling-factor model,
  // not a solution for a uniform-temperature, optically thick LTE atmosphere.
  float source = uDiskGain * beam * radial * (0.55 + m.y * m.y * 7.5)
               * (1.0 + uBass * 0.20 + pulse * 0.26 + uHeat * 0.18);
  vec3 light = uChroma * source;
  // Fine highlights belong to material density, not a screen-space overlay.
  light += mix(uChroma, vec3(1.0), 0.32) * pow(m.y, 6.0) * uHigh * 0.22;
  return vec4(light * alpha, alpha);
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
      float footprint = max(0.025, sc * uTanFov / uRes.y);
      float size = 0.022 + r2 * 0.028;
      float s = (1.0 - smoothstep(size, size + footprint, dd))
              * min(1.0, size / footprint);
      float tw = 0.92 + 0.08 * sin(uTime * (0.3 + r2) + r2 * 31.0) + uHigh * 0.18;
      // a real magnitude spread — a handful of bright ones over a dusting of
      // faint, rather than everything at much the same weight
      float mag = 0.10 + 2.8 * pow(r2, 5.0);
      vec3 tint = mix(vec3(0.76, 0.85, 1.0), vec3(1.0, 0.88, 0.68), r2);
      c += tint * s * mag * tw;
    }
  }
  /* Barely-there nebula. The sky behind Gargantua is essentially black in the
     film; this used to sit an order of magnitude brighter and blue enough to
     tint half the frame purple, which no shot in the movie does. */
  // A distant dust lane is part of the ray-traced sky: it bends with the
  // starlight, giving otherwise empty space a quiet sense of scale.
  float neb = noise3(d * 7.0);
  float dust = noise3(d * 19.0);
  float lane = exp(-pow((dot(d, normalize(vec3(0.3, 0.85, 0.42))) + 0.12) * 9.0, 2.0));
  c += vec3(0.00018, 0.00024, 0.00036);
  c += mix(vec3(0.0013, 0.0016, 0.0021), vec3(0.0038, 0.0032, 0.0029), neb)
       * lane * smoothstep(0.24, 0.80, neb) * (0.3 + dust);
  return c;
}

void main(){
  vec2 uv = vUv;
  vec2 ndc = uv * 2.0 - 1.0;
  ndc.x *= uAspect;
  vec3 rd = normalize(uCamFwd + uCamRight * ndc.x * uTanFov + uCamUp * ndc.y * uTanFov);
  vec3 p = uCamPos, v = rd;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float trans = 1.0, minR = 1e6;
  bool captured = false, escaped = false;

  for (int i = 0; i < MAXSTEPS; i++){
    if (float(i) >= uSteps || trans < 0.004) break;
    float r2 = dot(p, p), r = sqrt(r2);
    minR = min(minR, r);
    if (r < uRh){ captured = true; break; }
    if (r > 110.0 && dot(p, v) > 0.0){ escaped = true; break; }
    vec3 a1 = geoAccel(p, v, h2, r2, r);
    float speed = max(length(v), 0.1);
    // RK4 permits useful angular progress near the photon orbit. The previous
    // RK2 schedule spent its entire budget there, hiding higher-order images.
    float dt = min(0.10 * r / speed, 0.11 / sqrt(max(length(a1) / r, 1e-6)));
    dt = min(dt, max(0.025, (r - uRh) * 0.30) / speed);
    // Conservative distance bound to the complete material volume, including
    // its tapered outer rim. It works for exact in-plane and face-on rays.
    float rr = length(p.xz);
    float gap = max(max(uDin * 0.975 - rr, rr - uDout * 1.10), abs(p.y) - 0.56);
    dt = min(dt, max(0.13, gap * 0.75) / speed);
    dt = clamp(dt, 0.008, 7.0);

    vec3 p2 = p + v * dt * 0.5, v2 = v + a1 * dt * 0.5;
    vec3 a2 = acceleration(p2, v2, h2);
    vec3 p3 = p + v2 * dt * 0.5, v3 = v + a2 * dt * 0.5;
    vec3 a3 = acceleration(p3, v3, h2);
    vec3 p4 = p + v3 * dt, v4 = v + a3 * dt;
    vec3 a4 = acceleration(p4, v4, h2);
    vec3 previous = p;
    p += dt / 6.0 * (v + 2.0 * v2 + 2.0 * v3 + v4);
    v += dt / 6.0 * (a1 + 2.0 * a2 + 2.0 * a3 + a4);

    if (gap < 0.18){
      // Two ordered Gauss samples resolve fine strands without stochastic
      // grain or flickering slice boundaries. Opacity uses physical distance.
      for (int j = 0; j < 2; j++){
        float t = 0.2113248654 + float(j) * 0.5773502692;
        vec3 samplePos = mix(previous, p, t);
        float radius = length(samplePos.xz);
        if (radius > uDin * 0.975 && radius < uDout * 1.10){
          vec4 material = diskSample(samplePos, radius, normalize(v2), length(p - previous) * 0.5);
          col += trans * material.rgb;
          trans *= 1.0 - material.a;
        }
      }
    }
  }
  // A ray may still be safely outgoing when its budget ends. Unresolved
  // near-hole rays get no background; they must never manufacture ring light.
  escaped = escaped || (!captured && length(p) > uDout * 2.0 && dot(p, v) > 0.0);
  if (escaped) col += starField(normalize(v)) * trans;

  // The optional particle field is masked away from the curved central rays.
  // The entire bright disk and its multiple images above come from the volume.
  vec2 dv = (uv - uBhUv) * vec2(uAspect, 1.0);
  float dd = length(dv), ring = 0.0;
  for (int i = 0; i < 5; i++){
    float width = max(uRings[i].z, 0.002);
    ring += exp(-pow((dd - uRings[i].x) / width, 2.0)) * uRings[i].y;
  }
  float visible = escaped ? 1.0 : 0.0;
  float pfade = smoothstep(5.0, 8.0, minR);
  vec3 pc = texture2D(uParticles, uv).rgb;
  col += pc * trans * visible * pfade * uLens * 0.25;
  col += uChroma * ring * 0.07 * visible;
  gl_FragColor = vec4(col, 1.0);
}
