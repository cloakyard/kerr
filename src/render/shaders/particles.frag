precision mediump float;
varying vec3 vC; varying float vI;
uniform float uFade;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 15.0);
  gl_FragColor = vec4(vC * a * vI * uFade, a);
}
