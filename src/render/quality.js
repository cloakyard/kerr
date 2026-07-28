/* Adaptive quality.
   The raymarcher is the whole cost of a frame, so the two knobs that matter
   are how many steps each ray takes and how big the buffer is. Both are
   retuned once a second from measured fps.

   The bounds are the interesting part. 0.5x/96 is the floor at which the disk
   still reads — below that the fringe dissolves into stair-stepping and the
   photon ring goes dotted. 0.92x/220 is the ceiling: past it the gain is not
   visible at any framing this piece uses, so the headroom is better spent
   staying at 60. The gap between 42 and 57 is deliberately wide; a narrow one
   makes the scale oscillate audibly against the music. */
export const Q = { scale: 0.85, steps: 180, dpr: 1 };

const MIN_SCALE = 0.5, MAX_SCALE = 0.92;
const MIN_STEPS = 96,  MAX_STEPS = 220;

/** Retune from a measured frame rate. Returns true if the *buffers* must be
 *  reallocated — which is exactly when `scale` moved, since `steps` is only a
 *  uniform and costs nothing to change.
 *
 *  The gate tests both axes. It used to test `scale` alone, and because scale
 *  crosses its bound in five steps while `steps` needs six, the gate shut
 *  first and left the step count stranded at 100 on the way down and 200 on
 *  the way up — so the band documented everywhere as 0.5x/96 to 0.92x/220 was
 *  never actually reachable at either end. */
export function tuneQuality(fps){
  const was = Q.scale;
  if (fps < 42 && (Q.scale > MIN_SCALE || Q.steps > MIN_STEPS)){
    Q.scale = Math.max(MIN_SCALE, Q.scale - 0.08);
    Q.steps = Math.max(MIN_STEPS, Q.steps - 16);
  } else if (fps > 57 && (Q.scale < MAX_SCALE || Q.steps < MAX_STEPS)){
    Q.scale = Math.min(MAX_SCALE, Q.scale + 0.04);
    Q.steps = Math.min(MAX_STEPS, Q.steps + 10);
  }
  return Q.scale !== was;
}
