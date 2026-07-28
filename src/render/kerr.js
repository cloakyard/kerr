/* The Kerr geometry, as pure functions.
   Everything in r_s = 1 units, so M = 0.5 and the spin parameter `a` is in
   units of M. No imports, no uniforms, no side effects — this is the one part
   of the renderer that is arithmetic all the way down, and keeping it that way
   is what lets test/kerr.test.js check it against the closed forms rather than
   against a screenshot.

   render/bh.js owns the live state and pushes the results at the GPU. */

/** Spin is clamped below extremal. At a -> 1 the ISCO expression's inner
 *  radical goes to zero and the horizon becomes degenerate; 0.96 keeps both
 *  well conditioned, and nothing in the piece asks for more. */
export const SPIN_MAX = 0.96;

/* The film's disk, converted. DNEG put Gargantua's between r = 9.26M and
   18.70M; at r_s = 2M that is 4.63 to 9.35. */
export const DISK_IN = 4.63;
export const DISK_OUT = 9.35;

export const clampSpin = (a) => Math.max(0, Math.min(SPIN_MAX, a));

/** Outer event horizon, r_h = M + sqrt(M^2 - a^2).
 *  With M = 0.5 this is 0.5(1 + sqrt(1 - a^2)): exactly 1 r_s at a = 0, as the
 *  Schwarzschild radius must be, shrinking toward 0.5 as a -> 1. */
export function horizonRadius(a) {
  a = clampSpin(a);
  return 0.5 * (1 + Math.sqrt(Math.max(0, 1 - a * a)));
}

/** Innermost stable circular orbit, prograde, Bardeen–Press–Teukolsky.
 *  6M at a = 0 — 3.0 in r_s — falling toward M as a -> 1. */
export function iscoRadius(a) {
  a = clampSpin(a);
  const cb = Math.cbrt;
  const Z1 = 1 + cb(1 - a * a) * (cb(1 + a) + cb(1 - a));
  const Z2 = Math.sqrt(3 * a * a + Z1 * Z1);
  return 0.5 * (3 + Z2 - Math.sqrt(Math.max(0, (3 - Z1) * (3 + Z1 + 2 * Z2))));
}

/** Where the rendered disk actually starts.
 *  Held at the film's geometry rather than tracking the ISCO, with the ISCO
 *  only as a floor so a wound-up spin can never put the disk inside it.
 *  Thorne's disk has finished accreting and cooled, so its inner edge is an
 *  artistic choice, not the last stable orbit — at a/M = 0.6 the ISCO
 *  (1.9 r_s) is nowhere near it. */
export const diskInner = (a) => Math.max(iscoRadius(a), DISK_IN);
