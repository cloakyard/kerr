/* The Auto voicing heuristic.
   It is a guess, and the README spends several paragraphs being honest about
   that — but it is a guess with rules, and the rules are the kind that rot
   silently. The iPadOS case in particular exists because iPadOS reports itself
   as a Mac, and nothing on screen would tell you if that check stopped
   working: the mix would just be voiced for the wrong speaker. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutput, WIRELESS_LATENCY } from '../src/direct/output.js';

const UA = {
  mac:     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  ipad:    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
  iphone:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
};

test('a wired laptop gets the built-in voicing', () => {
  const r = classifyOutput({ ua: UA.mac, maxTouchPoints: 0, latency: 0.01 });
  assert.equal(r.mode, 'laptop');
  assert.equal(r.handheld, false);
  assert.equal(r.wireless, false);
});

test('high output latency means wireless, and wireless means headphones', () => {
  const r = classifyOutput({ ua: UA.mac, maxTouchPoints: 0, latency: 0.18 });
  assert.equal(r.wireless, true);
  assert.equal(r.mode, 'phones');
});

test('the wireless threshold sits between a wired and a Bluetooth path', () => {
  assert.ok(WIRELESS_LATENCY > 0.01, 'a ~10ms wired output must not read as wireless');
  assert.ok(WIRELESS_LATENCY < 0.10, 'a >100ms Bluetooth output must read as wireless');
  assert.equal(classifyOutput({ latency: WIRELESS_LATENCY }).wireless, false);
  assert.equal(classifyOutput({ latency: WIRELESS_LATENCY + 1e-6 }).wireless, true);
});

test('iPadOS presents as a Mac and is caught by touch points', () => {
  const desktop = classifyOutput({ ua: UA.ipad, maxTouchPoints: 0, latency: 0.01 });
  const tablet  = classifyOutput({ ua: UA.ipad, maxTouchPoints: 5, latency: 0.01 });
  assert.equal(desktop.handheld, false, 'a real Mac must not be called a handheld');
  assert.equal(tablet.handheld, true, 'iPad slipped through as a desktop');
  // both are still built-in — the class only changes the caption, not the mix
  assert.equal(tablet.mode, 'laptop');
});

test('UA-CH mobile wins over user-agent sniffing when present', () => {
  // a desktop string but the client hint says mobile — trust the hint
  assert.equal(classifyOutput({ ua: UA.windows, uaMobile: true, latency: 0 }).handheld, true);
  // an iPhone string but the hint says not mobile, and no touch points
  assert.equal(classifyOutput({ ua: UA.iphone, uaMobile: false, latency: 0 }).handheld, false);
});

test('phones and tablets are handheld without client hints', () => {
  for (const ua of [UA.iphone, UA.android]) {
    assert.equal(classifyOutput({ ua, latency: 0 }).handheld, true, ua);
  }
  for (const ua of [UA.mac, UA.windows]) {
    assert.equal(classifyOutput({ ua, latency: 0 }).handheld, false, ua);
  }
});

test('device class never decides the voicing on its own', () => {
  // A phone on wired earbuds is still built-in; a laptop on AirPods is still
  // headphones. Only the link decides — the class only writes the caption.
  assert.equal(classifyOutput({ ua: UA.iphone, latency: 0.01 }).mode, 'laptop');
  assert.equal(classifyOutput({ ua: UA.mac, latency: 0.2 }).mode, 'phones');
});

test('missing or zero signals fall back to built-in, never to silence', () => {
  for (const input of [{}, { ua: '' }, { latency: 0 }, { ua: undefined, latency: undefined }]) {
    const r = classifyOutput(input);
    assert.ok(['laptop', 'phones'].includes(r.mode));
    assert.equal(r.mode, 'laptop', 'no signal should mean the safe, most-compressed voicing');
  }
});

test('"monitors" is never chosen automatically', () => {
  // Nothing on the web can spot powered speakers; it stays a deliberate choice
  const inputs = [0, 0.01, 0.05, 0.06, 0.1, 0.5, 2];
  for (const latency of inputs) {
    for (const ua of Object.values(UA)) {
      assert.notEqual(classifyOutput({ ua, latency, maxTouchPoints: 5 }).mode, 'monitors');
    }
  }
});
