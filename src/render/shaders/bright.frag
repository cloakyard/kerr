precision mediump float; varying vec2 vUv;
uniform sampler2D tDiffuse; uniform float uThresh;
uniform vec2 uTexel;
void main(){
  // Integrate the four source texels before extracting highlights. A thin
  // moving filament should not blink when it crosses a half-resolution pixel.
  vec2 d = uTexel * 0.5;
  vec3 c = (texture2D(tDiffuse, vUv + vec2(-d.x, -d.y)).rgb
          + texture2D(tDiffuse, vUv + vec2(d.x, -d.y)).rgb
          + texture2D(tDiffuse, vUv + vec2(-d.x, d.y)).rgb
          + texture2D(tDiffuse, vUv + d).rgb) * 0.25;
  /* Threshold on luminance and scale, rather than subtracting the threshold
     from each channel. On a warm source the per-channel form is a saturation
     pump: take (1.00, 0.50, 0.41) and subtract 0.32 and what comes out is
     (1.00, 0.26, 0.13), so the glow around the disk came back far redder than
     the disk itself and dragged the whole mid-tone toward rust. */
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = uThresh * 0.5;
  float soft = clamp(l - uThresh + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  gl_FragColor = vec4(c * (max(l - uThresh, soft) / max(l, 1e-4)), 1.0);
}
