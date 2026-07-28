precision mediump float; varying vec2 vUv;
uniform sampler2D tDiffuse; uniform vec2 uDir;
void main(){
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
  s += (texture2D(tDiffuse, vUv + uDir*1.3846).rgb + texture2D(tDiffuse, vUv - uDir*1.3846).rgb) * 0.316216;
  s += (texture2D(tDiffuse, vUv + uDir*3.2308).rgb + texture2D(tDiffuse, vUv - uDir*3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(s, 1.0);
}
