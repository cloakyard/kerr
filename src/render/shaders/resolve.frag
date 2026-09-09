precision highp float; varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uTexel, uRes;
uniform float uTime, uGrain;
#include "grain.glsl"

// Contrast-adaptive spatial resolve in display space. The scene texel size
// follows adaptive quality; no history is retained across drag or music motion.
vec3 resolveEdge(vec2 uv){
  vec3 center = texture2D(tDiffuse, uv).rgb;
  vec3 weights = vec3(0.299, 0.587, 0.114);
  float m = dot(center, weights);
  float nw = dot(texture2D(tDiffuse, uv + uTexel * vec2(-1.0, 1.0)).rgb, weights);
  float ne = dot(texture2D(tDiffuse, uv + uTexel).rgb, weights);
  float sw = dot(texture2D(tDiffuse, uv - uTexel).rgb, weights);
  float se = dot(texture2D(tDiffuse, uv + uTexel * vec2(1.0, -1.0)).rgb, weights);
  float lo = min(m, min(min(nw, ne), min(sw, se)));
  float hi = max(m, max(max(nw, ne), max(sw, se)));
  if (hi - lo < max(0.035, hi * 0.125)) return center;
  // An isolated point has no edge direction; keep its stellar magnitude.
  vec2 direction = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  float reduce = max((nw + ne + sw + se) * 0.03125, 0.0078125);
  direction = clamp(direction / (min(abs(direction.x), abs(direction.y)) + reduce), -4.0, 4.0) * uTexel;
  vec3 a = 0.5 * (texture2D(tDiffuse, uv - direction / 6.0).rgb
                + texture2D(tDiffuse, uv + direction / 6.0).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv - direction * 0.5).rgb
                           + texture2D(tDiffuse, uv + direction * 0.5).rgb);
  float l = dot(b, weights);
  return l < lo || l > hi ? a : b;
}
void main(){
  vec3 c = resolveEdge(vUv);
  // Grain comes last, so edge detection never mistakes it for scene detail.
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += (hash21(vUv * uRes + floor(uTime * 24.0) * 173.0) - 0.5)
     * uGrain * smoothstep(0.015, 0.14, luma);
  gl_FragColor = vec4(c, 1.0);
}
