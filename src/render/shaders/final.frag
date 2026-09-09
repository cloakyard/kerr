precision highp float; varying vec2 vUv;
uniform sampler2D uScene, uBloom, uBloomWide, uFlare;
uniform vec2 uBhUv;
uniform float uAspect, uCA, uExposure, uFlash, uBloomAmt, uFlareAmt;
uniform float uStreak;
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
  c += (texture2D(uBloom, uv).rgb * 0.45 + texture2D(uBloomWide, uv).rgb * 0.55) * uBloomAmt;
  // A restrained horizontal optical streak, sourced from actual highlights.
  // This reuses the eighth-resolution flare instead of another full pass.
  vec3 streak = vec3(0.0);
  for (int i = -4; i <= 4; i++){
    float fi = float(i);
    streak += texture2D(uBloom, clamp(uv + vec2(fi * 0.022 / uAspect, 0.0), 0.0, 1.0)).rgb
            * exp(-abs(fi) * 0.7);
  }
  c += streak * uStreak * 0.13;

  // Broad veiling flare inspired by DNGR Figure 16. DNEG used measured lens
  // point-spread functions; our multiscale blur and neutral tint are an
  // affordable artistic approximation, not a calibrated IMAX lens model.
  vec3 fl = texture2D(uFlare, uv).rgb;
  fl = mix(fl, vec3(dot(fl, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.97, 0.99, 1.06), 0.45);
  c += fl * uFlareAmt;

  c *= uExposure * (1.0 + uFlash * 1.6);
  c = aces(c);
  // gentler falloff: the film's frames are lit corner to corner, and a heavy
  // vignette on top of the flare just reads as a dirty lens
  float vig = 1.0 - smoothstep(0.28, 1.32, length((uv - 0.5) * vec2(uAspect, 1.0)));
  c *= mix(0.88, 1.0, vig);
  // Three's exact transfer retains the sRGB linear toe in near-black space.
  // The old 1/2.2 approximation lifted the sky and flattened dark disk lanes.
  c = sRGBTransferOETF(vec4(max(c, 0.0), 1.0)).rgb;
  gl_FragColor = vec4(c, 1.0);
}
