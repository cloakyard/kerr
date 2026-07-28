attribute vec4 aP; attribute vec3 aQ;
uniform float uTime, uOrbT, uFlowT, uBass, uMid, uHigh, uPull, uEcc, uIsco, uSizeScale;
uniform vec3 uEye;
varying vec3 vC; varying float vI;
float h11(float x){ return fract(sin(x * 127.1) * 43758.5453); }
void main(){
  float a0 = aP.x, seed = aQ.y, kind = aQ.z;

  // accretion cycle: inner material drains faster, the outer halo barely moves
  float rate = (0.010 + 0.022 * h11(seed * 13.7)) * mix(1.0, 0.30, kind);
  float u    = fract(seed * 7.13 + uFlowT * rate * pow(7.0 / max(a0, 3.0), 0.6));
  float aEnd = mix(uIsco * 1.02, a0 * 0.60, kind);
  float a    = mix(a0, aEnd, pow(u, 1.8));

  // keplerian mean motion, and the radial epicyclic frequency
  // kappa = w * sqrt(1 - 6M/r). kappa < w, so the ellipse precesses —
  // which is what makes real accretion streams braid instead of ring.
  float w   = 1.0 / pow(max(a, uIsco * 0.9), 1.5);
  float kap = w * sqrt(max(1.0 - 3.0 / max(a, 3.05), 0.04));
  float ecc = uEcc * (0.10 + 0.6 * h11(seed * 3.3));

  float lon = aP.y       + uOrbT * w   * 15.0 * aP.w;
  float ano = aP.y * 1.7 + uOrbT * kap * 15.0 * aP.w;
  float rad = a * (1.0 + ecc * cos(ano)) - uPull * 2.4 / max(a * 0.25, 1.0);
  rad = max(rad, uIsco * 0.9);

  // a real disk is puffy, so keep a scale height, and add the vertical
  // epicyclic term on top (frequency ~= w for schwarzschild) as a tilt
  float y = aP.z * (0.8 + 0.03 * rad)
          + aP.z * 0.5 * sin(lon + seed * 17.0)
          + sin(lon * 2.0 + uOrbT * 0.7) * (0.04 + uMid * 0.25) * (1.0 + kind * 3.0);

  vec3 pos = vec3(cos(lon) * rad, y, sin(lon) * rad);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  // doppler beaming toward the eye, so the particles agree with the disk
  vec3 vdir  = normalize(vec3(-sin(lon), 0.0, cos(lon)));
  vec3 toEye = normalize(uEye - pos);
  float beta = min(0.7, 0.62 / sqrt(max(rad, 1.1)));
  float dop  = clamp(1.0 / (1.0 - beta * dot(vdir, toEye)), 0.6, 1.7);

  float temp = pow(clamp(4.2 / rad, 0.04, 4.0), 0.75) * dop;
  vec3 c = mix(vec3(1.0, 0.30, 0.07), vec3(1.0, 0.66, 0.22), smoothstep(0.22, 0.70, temp));
  c = mix(c, vec3(1.0, 0.94, 0.84), smoothstep(0.66, 1.22, temp));
  c = mix(c, vec3(0.62, 0.80, 1.30), smoothstep(1.18, 2.10, temp));
  vC = mix(c, vec3(1.6, 1.35, 1.1), uBass * 0.25);

  // fade at both ends of the cycle hides the respawn; the radial fade
  // keeps the shimmer inside the disk so its outer edge stays clean
  // fades match the visible disk so the shimmer never extends past its rim
  float life = smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.86, u)
             * smoothstep(0.0, 0.5, rad - uIsco) * (1.0 - smoothstep(6.5, 10.0, rad));
  // a whisper at rest, shimmering with the music — the disk itself is
  // the subject, this layer only breathes with the score
  vI = (0.012 + 0.075 * uHigh + 0.035 * uBass) * dop * life;

  // small and clamped: a fine sheen over the raymarched disk, never dots
  float ps = aQ.x * uSizeScale * (55.0 / max(-mv.z, 1.0)) * (0.85 + 0.22 * dop);
  gl_PointSize = clamp(ps, 0.6, 5.0);
}
