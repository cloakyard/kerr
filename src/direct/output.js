/* What the platform will tell us about the audio output, and what it will not.

   enumerateDevices() returns a single entry with an empty label and an empty
   id until the page holds a microphone permission — so the make and model are
   off the table, and prompting for the mic to choose an EQ curve is not a
   trade worth making. Two honest signals are left:

     device class    from UA-CH and touch points, which separates a handheld
                     from a laptop or desktop
     outputLatency   ~10ms on a built-in output; a wireless link pushes it
                     past 100ms

   Wireless tells us the output is not the built-in speaker. It does not tell
   us whether it is earbuds or a pair of powered speakers. Earbuds are much the
   more common answer, so that is the guess — and the caption in the UI says
   which guess it made, rather than implying a certainty the browser cannot
   give. Powered speakers stay a deliberate choice; nothing on the web can spot
   a KEF LSX II on the other end of a cable.

   Pure on purpose: the caller reads navigator and the AudioContext, this
   decides. That is what makes the heuristic testable — see
   test/output.test.js, which pins the iPadOS case in particular. */

/** Anything past this and the link is not the built-in output. 60ms is well
 *  clear of a wired path (~10ms) and well under a Bluetooth one (>100ms). */
export const WIRELESS_LATENCY = 0.06;

/**
 * @param {{ua: string, uaMobile: boolean|undefined, maxTouchPoints: number, latency: number}} signals
 * @returns {{mode: 'phones'|'laptop', handheld: boolean, wireless: boolean, lat: number}}
 */
export function classifyOutput({ ua = '', uaMobile, maxTouchPoints = 0, latency = 0 }) {
  const mobile = typeof uaMobile === 'boolean' ? uaMobile : /Android|iPhone|iPod/i.test(ua);
  // iPadOS presents itself as a Mac; the touch points give it away
  const handheld = mobile || (maxTouchPoints > 1 && /Macintosh|iPad/.test(ua));
  const wireless = latency > WIRELESS_LATENCY;
  return { mode: wireless ? 'phones' : 'laptop', handheld, wireless, lat: latency };
}
