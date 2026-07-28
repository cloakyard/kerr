/* Every pass is a full-screen quad. Position goes through untouched in clip
   space — no projection matrix, no view matrix, nothing to get wrong. */
varying vec2 vUv;

void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
