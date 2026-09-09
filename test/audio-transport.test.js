import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Audio } from '../src/audio/engine.js';
import { MusicFeatures } from '../src/audio/features.js';

function fixture(){
  const calls = { paused:0, resumed:0, suspended:0 };
  const analysis = new MusicFeatures();
  const audio = {
    ...Audio, ready:true, mode:'file', playing:true, playRequest:0,
    events:[], live:new Set(), bus:{}, analysis, features:analysis.data,
    ctx:{
      state:'running', currentTime:10,
      resume(){ calls.resumed++; return Promise.resolve(); },
      suspend(){ calls.suspended++; return Promise.resolve(); }
    },
    el:{
      currentTime:0, duration:180,
      pause(){ calls.paused++; },
      play(){ return Promise.resolve(); }
    }
  };
  return { audio, calls };
}

test('switching back to the score pauses the imported track and clears its metadata', async () => {
  const { audio, calls } = fixture();
  audio.trackName = 'Example.wav';
  audio.features.energy = 0.9;
  audio.start();
  clearInterval(audio.timer);
  assert.equal(calls.paused, 1);
  assert.equal(audio.mode, 'synth');
  assert.equal(audio.trackName, '');
  assert.equal(audio.playing, true);
  assert.equal(audio.features.energy, 0);
});

test('rapid pause and resume follows requested transport state while context state is pending', () => {
  const { audio, calls } = fixture();
  audio.mode = 'synth';
  assert.equal(audio.toggle(), false);
  assert.equal(audio.ctx.state, 'running', 'fixture intentionally leaves the async state pending');
  assert.equal(audio.toggle(), true);
  assert.equal(calls.suspended, 1);
  assert.equal(calls.resumed, 1);
});

test('a rejected media play request becomes a recoverable visible error', async () => {
  const { audio } = fixture();
  audio.el.play = () => Promise.reject({ name:'NotSupportedError' });
  assert.equal(await audio.playFile(), false);
  assert.equal(audio.playing, false);
  assert.equal(audio.loading, false);
  assert.match(audio.error, /could not be played/);
  audio.el.play = () => Promise.resolve();
  assert.equal(await audio.playFile(), true);
  assert.equal(audio.error, '');
  assert.equal(audio.playing, true);
});

test('an old aborted play cannot overwrite the state of a newly loaded track', async () => {
  const { audio } = fixture();
  let rejectOld;
  audio.el.play = () => new Promise((resolve, reject) => { rejectOld = reject; });
  const oldRequest = audio.playFile();
  audio.el.play = () => Promise.resolve();
  assert.equal(await audio.playFile(), true);
  rejectOld({ name:'AbortError' });
  assert.equal(await oldRequest, false);
  assert.equal(audio.playing, true);
  assert.equal(audio.loading, false);
  assert.equal(audio.error, '');
});

test('loading a replacement reuses the media source, releases the old URL and publishes its name', async t => {
  const { audio, calls } = fixture();
  const released = [];
  let nextUrl = 0;
  t.mock.method(URL, 'createObjectURL', () => `blob:track-${++nextUrl}`);
  t.mock.method(URL, 'revokeObjectURL', url => released.push(url));
  audio.elUrl = 'blob:previous';
  const originalElement = audio.el;
  audio.features.energy = 0.8;
  await audio.loadFile({ name:'Orbit.flac' });
  assert.equal(audio.el, originalElement, 'one media element must keep its one Web Audio source');
  assert.equal(audio.el.src, 'blob:track-1');
  assert.equal(audio.trackName, 'Orbit.flac');
  assert.deepEqual(released, ['blob:previous']);
  assert.equal(calls.paused, 1);
  assert.equal(audio.features.energy, 0);
  assert.equal(audio.playing, true);
  assert.equal(audio.loading, false);
});

test('pausing during initial load invalidates its pending play result', async () => {
  const { audio } = fixture();
  let rejectPlay;
  audio.el.play = () => new Promise((resolve, reject) => { rejectPlay = reject; });
  const pending = audio.playFile();
  audio.toggle();
  rejectPlay({ name:'AbortError' });
  await pending;
  assert.equal(audio.playing, false);
  assert.equal(audio.loading, false);
  assert.equal(audio.error, '');
});

test('seeking clamps to real file metadata, resets visual history and tolerates unloaded metadata', () => {
  const { audio } = fixture();
  audio.features.beatEnv = 1;
  audio.seek(240);
  assert.equal(audio.el.currentTime, 180);
  assert.equal(audio.features.beatEnv, 0);
  assert.equal(audio.progress(), 1);
  audio.el.duration = NaN;
  audio.el.currentTime = 0;
  audio.seek(200);
  assert.equal(audio.el.currentTime, 0);
  assert.equal(audio.duration(), 1);
  assert.equal(audio.progress(), 0);
});

test('reactivity stays in range and invalid settings recover to the default', () => {
  const { audio } = fixture();
  assert.equal(audio.setReactivity(-1), 0);
  assert.equal(audio.setReactivity(99), 2);
  assert.equal(audio.setReactivity(NaN), 1);
});

test('a delayed score resume error cannot stop a newer imported track', async t => {
  const { audio } = fixture();
  let rejectResume;
  audio.ctx.resume = () => new Promise((resolve, reject) => { rejectResume = reject; });
  audio.start();
  clearInterval(audio.timer);
  audio.ctx.resume = () => Promise.resolve();
  t.mock.method(URL, 'createObjectURL', () => 'blob:new-track');
  await audio.loadFile({ name:'New.wav' });
  rejectResume({ name:'NotAllowedError' });
  await Promise.resolve();
  assert.equal(audio.playing, true);
  assert.equal(audio.error, '');
  assert.equal(audio.trackName, 'New.wav');
});

test('a delayed suspend error cannot undo a newer resume', async () => {
  const { audio } = fixture();
  audio.mode = 'synth';
  let rejectSuspend;
  audio.ctx.suspend = () => new Promise((resolve, reject) => { rejectSuspend = reject; });
  audio.toggle();
  audio.toggle();
  rejectSuspend({ name:'InvalidStateError' });
  await Promise.resolve();
  assert.equal(audio.playing, true);
  assert.equal(audio.error, '');
});

test('a failed context resume stops the file transport as well as the UI', async () => {
  const { audio, calls } = fixture();
  audio.ctx.resume = () => Promise.reject({ name:'NotAllowedError' });
  assert.equal(await audio.playFile(), false);
  assert.equal(audio.playing, false);
  assert.equal(calls.paused, 1, 'a failed request must not leave the media timeline advancing');
});

test('a delayed scheduler skips missed notes instead of playing them all at once', () => {
  const { audio } = fixture();
  Object.assign(audio, { mode:'synth', startAt:0, nextStep:0 });
  audio.ctx.currentTime = 12.1;
  const scheduled = [];
  audio.scheduleStep = (step, time) => scheduled.push({step, time});
  audio.tick();
  assert.ok(scheduled.length > 0 && scheduled.length <= 3, 'missed score history was scheduled as a burst');
  assert.ok(scheduled.every(note => note.time >= 12.1 && note.time <= 12.35));
  assert.ok(scheduled.every(note => note.step >= 97), 'a note from before the current beat was replayed');
});

test('overdue visual beats expire instead of bursting when rendering resumes', () => {
  const { audio } = fixture();
  audio.events = [{t:2, kind:'impact'}, {t:9.9, kind:'kick'}, {t:10.2, kind:'snare'}];
  const received = [];
  audio.popEvents(event => received.push(event.kind));
  assert.deepEqual(received, ['kick']);
  assert.deepEqual(audio.events, [{t:10.2, kind:'snare'}]);
});

test('visual events arriving in the same frame retain their musical order', () => {
  const { audio } = fixture();
  audio.events = [{t:9.8, kind:'section'}, {t:9.9, kind:'impact'}];
  const received = [];
  audio.popEvents(event => received.push(event.kind));
  assert.deepEqual(received, ['section', 'impact']);
});
