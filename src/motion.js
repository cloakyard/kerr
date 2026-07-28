/* One number, read once, used by both the camera and the post chain.
   It lives on its own because it belongs to neither: it is the visitor's
   stated preference, not a property of the shot or of the renderer. */
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;
