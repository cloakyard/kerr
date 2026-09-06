import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicFeatures } from '../src/audio/features.js';

const RATE = 48000, FFT = 4096;
function signal(hz, amplitude = 0.14, sampleRate = RATE){
  const spectrum = new Float32Array(FFT / 2).fill(-Infinity);
  // A narrow tone with its FFT neighbours, plus the corresponding waveform.
  const bin = Math.round(hz * FFT / sampleRate);
  spectrum[bin] = 20 * Math.log10(amplitude);
  spectrum[bin - 1] = spectrum[bin + 1] = spectrum[bin] - 6;
  const wave = Float32Array.from({ length:FFT }, (_, i) =>
    amplitude * Math.sin(2 * Math.PI * hz * i / sampleRate));
  return { spectrum, wave };
}
const silence = { spectrum:new Float32Array(FFT / 2).fill(-Infinity), wave:new Float32Array(FFT) };
function run(analysis, input, seconds, fps = 60, options = {}){
  let hits = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++){
    const f = analysis.update(input.spectrum, input.wave, 1 / fps, options);
    if (f.onset > 0) hits++;
  }
  return hits;
}

test('frequency bands distinguish a pedal, a bass note, voices and fine detail at either sample rate', () => {
  for (const rate of [44100, 48000]){
    for (const [hz, name] of [[48,'sub'], [140,'bass'], [400,'low'], [1200,'mid'], [6500,'high']]){
      const analysis = new MusicFeatures({ sampleRate:rate, fftSize:FFT });
      run(analysis, signal(hz, 0.14, rate), 0.8);
      const strongest = ['sub','bass','low','mid','high'].sort((a, b) => analysis.data[b] - analysis.data[a])[0];
      assert.equal(strongest, name, `${hz} Hz at ${rate} Hz is in the wrong visual band`);
      assert.ok(analysis.data[name] > 0.3, `${name} fails to respond`);
    }
  }
});

test('a sustained note does not keep triggering beats; a new attack does', () => {
  const analysis = new MusicFeatures();
  const tone = signal(130);
  run(analysis, silence, 0.5);
  assert.equal(run(analysis, tone, 3), 1);
  run(analysis, silence, 0.5);
  assert.equal(run(analysis, tone, 0.5), 1);
});

test('high-frequency attacks are audible to the onset detector too', () => {
  const analysis = new MusicFeatures();
  run(analysis, silence, 0.5);
  assert.equal(run(analysis, signal(6500, 0.4), 0.3), 1);
  assert.equal(analysis.data.bass, 0);
});

test('silence stays silent after adaptation, including very quiet noise', () => {
  const analysis = new MusicFeatures();
  run(analysis, signal(130), 1);
  assert.equal(run(analysis, silence, 12), 0);
  assert.ok(analysis.data.energy < 1e-6);
  assert.ok(analysis.data.bass < 1e-6);
  assert.equal(run(analysis, signal(120, 0.0002), 15), 0);
  assert.ok(analysis.data.energy < 1e-6, 'normalization amplified the noise floor');
});

test('attack and release follow elapsed seconds across 30, 60 and 120 Hz rendering', () => {
  const outputs = [30,60,120].map(fps => {
    const analysis = new MusicFeatures();
    run(analysis, signal(140), 1, fps);
    const attack = analysis.data.bass;
    run(analysis, silence, 0.4, fps);
    return { attack, release:analysis.data.bass, energy:analysis.data.energy };
  });
  for (const key of ['attack','release','energy']){
    assert.ok(Math.max(...outputs.map(x => x[key])) - Math.min(...outputs.map(x => x[key])) < 0.012,
      `${key} changes with display refresh rate: ${JSON.stringify(outputs)}`);
  }
});

test('regular attacks build a usable pulse estimate and the score uses its exact clock', () => {
  const analysis = new MusicFeatures();
  const tone = signal(140);
  run(analysis, silence, 0.5);
  for (let i = 0; i < 12; i++){
    run(analysis, tone, 0.1);
    run(analysis, silence, 0.4);
  }
  assert.ok(Math.abs(analysis.data.bpm - 120) < 2);
  assert.ok(analysis.data.beatConfidence > 0.8);
  const score = analysis.update(tone.spectrum, tone.wave, 1 / 60, { knownPeriod:0.5, position:12.625 });
  assert.equal(score.bpm, 120);
  assert.equal(score.beatConfidence, 1);
  assert.equal(score.beatPhase, 0.25);
});

test('pause releases visual energy instead of freezing a stale analyser frame', () => {
  const analysis = new MusicFeatures();
  const tone = signal(140);
  run(analysis, tone, 1);
  run(analysis, tone, 3, 60, { playing:false });
  assert.ok(analysis.data.energy < 0.01);
  assert.ok(analysis.data.bass < 0.001);
  assert.equal(analysis.data.onset, 0);
  assert.equal(analysis.data.rms, 0);
});

test('reactivity affects visual strength without changing pulse estimates or raw loudness', () => {
  const analysis = new MusicFeatures();
  const tone = signal(140);
  run(analysis, tone, 1);
  const rms = analysis.data.rms;
  const f = analysis.update(tone.spectrum, tone.wave, 1 / 60,
    { reactivity:0, knownPeriod:0.5, position:1.125 });
  for (const key of ['sub','bass','low','mid','high','energy','brightness','onset','beatEnv','flux'])
    assert.equal(f[key], 0, key);
  assert.equal(f.rms, rms);
  assert.equal(f.beatPhase, 0.25);
});

test('reset keeps the feature object stable and discards the previous track history', () => {
  const analysis = new MusicFeatures();
  const reference = analysis.data;
  run(analysis, signal(140), 1);
  analysis.reset();
  assert.equal(analysis.data, reference);
  assert.equal(analysis.data.energy, 0);
  assert.equal(analysis.data.onset, 0);
  assert.equal(analysis.data.beatConfidence, 0);
  assert.equal(run(analysis, signal(140), 0.5), 0, 'first FFT must establish a baseline');
});
