precision highp float; varying vec2 vUv;
uniform sampler2D uScene, uBloom, uFlare;
uniform vec2 uRes, uBhUv;
uniform float uAspect, uCA, uExposure, uTime, uGrain, uFlash, uBloomAmt, uFlareAmt;
#include "noise.glsl"
vec3 aces(vec3 x){
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}
void main(){
  vec2 uv = vUv;
  vec2 d = uv - uBhUv;
  float r = length(d * vec2(uAspect, 1.0));
  float amt = uCA * (0.0016 + r * 0.0075);
  vec3 c;
  c.r = texture2D(uScene, uv + d * amt).r;
  c.g = texture2D(uScene, uv).g;
  c.b = texture2D(uScene, uv - d * amt).b;
  c += texture2D(uBloom, uv).rgb * uBloomAmt;

  /* Veiling flare — the wide, soft glow that 65 mm IMAX glass throws around a
     bright source. DNEG convolved the Gargantua renders with the measured
     point spread function of Nolan's actual lenses for exactly this (their
     Figure 16), so the CG would cut against footage shot on real cameras; it
     is the single most "shot on film" thing about the image, and a tight
     threshold bloom does not stand in for it. Lens scatter is broadband, so it
     folds toward neutral instead of carrying the disk's amber — which is also
     what the film's own render does: measured against the disk body, its core
     drifts a shade *cooler* than white rather than warmer. */
  vec3 fl = texture2D(uFlare, uv).rgb;
  fl = mix(fl, vec3(dot(fl, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.97, 0.99, 1.06), 0.45);
  c += fl * uFlareAmt;

  c *= uExposure * (1.0 + uFlash * 1.6);
  c = aces(c);
  // gentler falloff: the film's frames are lit corner to corner, and a heavy
  // vignette on top of the flare just reads as a dirty lens
  float vig = smoothstep(1.32, 0.28, length((uv - 0.5) * vec2(uAspect, 1.0)));
  c *= mix(0.78, 1.0, vig);
  c += (hash21(uv * uRes + fract(uTime) * 173.0) - 0.5) * uGrain;
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(c, 1.0);
}
