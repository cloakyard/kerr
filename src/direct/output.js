/* Output identity, not transport timing. outputLatency is a delivery estimate:
   wired devices can buffer audio and Bluetooth can carry speakers or phones.
   Only classify the active sink's exposed label. Never infer that an attached
   device is in use, or request microphone access to find out. */

/**
 * @param {{devices?: Array<{kind:string, deviceId:string, label:string}>, sinkId?: string|object}} signals
 * @returns {{mode: 'laptop'|'phones'|'monitors', source: 'label'|'fallback', label:string}}
 */
export function classifyOutput({ devices = [], sinkId = '' } = {}) {
  const outputs = devices.filter(d => d.kind === 'audiooutput');
  // The empty sink follows the system default. An explicit sink must match
  // its own ID; falling through to the default would describe another device.
  const active = typeof sinkId === 'string'
    ? outputs.find(d => d.deviceId === (sinkId || 'default')) : null;
  const label = (active?.label || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const headphones = /\b(headphones?|headsets?|earphones?|earbuds?|airpods?)\b/i.test(label);
  if (headphones && /\bspeakers?\b/i.test(label)) return { mode:'laptop', source:'fallback', label };
  let mode;
  if (headphones) mode = 'phones';
  else if (/\b(?:built[ -]?in|internal)\s+(?:speakers?|audio|output)\b|\b(?:macbook|imac|iphone|ipad)\b.*\bspeakers?\b/i.test(label)) mode = 'laptop';
  else if (/\b(?:external|powered|usb|bluetooth|wireless)\b.*\bspeakers?\b|\bspeakers?\b.*\b(?:external|powered|usb|bluetooth|wireless)\b|\bhomepods?\b/i.test(label)) mode = 'monitors';
  // "Speakers (Realtek Audio)", HDMI and a USB DAC do not reveal what is on
  // the other end. Unknown labels and permission-redacted lists stay explicit.
  return { mode:mode || 'laptop', source:mode ? 'label' : 'fallback', label };
}
