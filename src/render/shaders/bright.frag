precision mediump float; varying vec2 vUv;
uniform sampler2D tDiffuse; uniform float uThresh;
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  /* Threshold on luminance and scale, rather than subtracting the threshold
     from each channel. On a warm source the per-channel form is a saturation
     pump: take (1.00, 0.50, 0.41) and subtract 0.32 and what comes out is
     (1.00, 0.26, 0.13), so the glow around the disk came back far redder than
     the disk itself and dragged the whole mid-tone toward rust. */
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * (max(l - uThresh, 0.0) / max(l, 1e-4)), 1.0);
}
