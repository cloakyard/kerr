/* Active-output classification: attached devices and transport timing must
   never masquerade as proof of what the listener is using. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutput } from '../src/direct/output.js';

const output = (label, deviceId = 'default') => ({ kind:'audiooutput', deviceId, label });
const detect = label => classifyOutput({ devices:[output(label)] });

test('wired and wireless headphones use their label, not their latency', () => {
  for (const label of ['Headphones (USB Audio)', 'Default - AirPods Pro', 'Bluetooth Headset', 'Wired Earbuds', 'Earphones']) {
    for (const latency of [0, .01, .2]) {
      const result = classifyOutput({ devices:[output(label)], latency });
      assert.equal(result.mode, 'phones', label);
      assert.equal(result.source, 'label');
    }
  }
});

test('clearly named external speakers can select the speaker mix', () => {
  for (const label of ['External Speakers', 'Powered Speakers', 'Bluetooth Speaker', 'Speakers (USB Audio Device)', 'HomePod mini']) {
    assert.equal(detect(label).mode, 'monitors', label);
    assert.equal(detect(label).source, 'label');
  }
});

test('built-in output labels win regardless of platform or buffering', () => {
  for (const label of ['Built-in Speakers', 'Internal Speakers', 'MacBook Pro Speakers', 'iPad Speakers']) {
    const result = classifyOutput({ devices:[output(label)], latency:.2, uaMobile:true });
    assert.equal(result.mode, 'laptop', label);
    assert.equal(result.source, 'label');
  }
});

test('only the active default is classified, not another connected output or input', () => {
  const devices = [
    { ...output('AirPods', 'default'), kind:'audioinput' },
    output('USB Speakers', 'usb'), output('AirPods', 'bluetooth'), output('Built-in Speakers')
  ];
  assert.equal(classifyOutput({ devices }).mode, 'laptop');
  assert.equal(classifyOutput({ devices, sinkId:'bluetooth' }).mode, 'phones');
  assert.equal(classifyOutput({ devices, sinkId:'usb' }).mode, 'monitors');
});

test('missing explicit sinks and silent sinks never fall through to another output', () => {
  for (const sinkId of ['unavailable', { type:'none' }]) {
    assert.deepEqual(classifyOutput({ devices:[output('AirPods')], sinkId }),
      { mode:'laptop', source:'fallback', label:'' });
  }
});

test('an attached output without a default marker is not assumed to be playing', () => {
  assert.equal(classifyOutput({ devices:[output('AirPods', 'bluetooth')] }).source, 'fallback');
});

test('generic audio ports do not reveal the device at the other end', () => {
  for (const label of ['Speakers (Realtek(R) Audio)', 'USB Audio DAC', 'HDMI', 'DisplayPort', 'Default', 'Bluetooth Audio', 'Speaker / Headphone', '']) {
    const result = detect(label);
    // A combined speaker/headphone endpoint is ambiguous, even with a keyword.
    assert.equal(result.source, 'fallback', label);
    assert.equal(result.mode, 'laptop', label);
  }
});

test('unknown output timing cannot identify Bluetooth or headphones', () => {
  for (const latency of [0, .01, .06, .061, .18, 2, NaN, Infinity, -1, undefined]) {
    assert.deepEqual(classifyOutput({ latency }), { mode:'laptop', source:'fallback', label:'' });
  }
  assert.deepEqual(classifyOutput(), { mode:'laptop', source:'fallback', label:'' });
});

test('redacted lists and microphone-only metadata remain a safe fallback', () => {
  for (const devices of [[], [output('', '')], [{ ...output('Headphones'), kind:'audioinput' }]]) {
    assert.equal(classifyOutput({ devices }).source, 'fallback');
  }
});

test('label normalization retains readable names without control characters', () => {
  assert.equal(detect('  Default - ＵＳＢ Speakers\u0000 ').label, 'Default - USB Speakers');
  assert.equal(detect('  Default - ＵＳＢ Speakers\u0000 ').mode, 'monitors');
});
