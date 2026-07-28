/* The Web Audio graph, the sequencer and the analyser.
   Depends on the arrangement and on nothing else — no DOM, no renderer, no
   camera. That independence is why the whole audio layer can be reasoned
   about, and replaced, on its own. */
import {
  SPB, STEP, BAR, SECTIONS, TOTAL_STEPS, DURATION,
  PROG, ARP, LEAD, mtof, frand
} from './arrangement.js';

export const Audio = {
  ctx:null, ready:false, playing:false, mode:'synth',
  startAt:0, nextStep:0, timer:null, live:new Set(),
  events:[], bus:{}, analyser:null, freq:null, wave:null,
  el:null, elSrc:null, voicing:'laptop', vol:0.8,
  bass:0, low:0, mid:0, high:0, level:0, beat:0, beatEnv:0,
  hist:[], lastBeat:0,

  init(){
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint:'interactive' });
    const c = this.ctx, B = this.bus;

    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.72;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Uint8Array(this.analyser.frequencyBinCount);

    /* ---- master chain -------------------------------------------------
       sum -> rumble filter -> tone -> glue -> saturation -> limiter -> out
       Everything below ~30 Hz is inaudible on a laptop but still costs
       headroom and speaker excursion, so it goes first.                  */
    B.sum = c.createGain(); B.sum.gain.value = 1;

    B.hp1 = c.createBiquadFilter(); B.hp1.type = 'highpass'; B.hp1.frequency.value = 44; B.hp1.Q.value = 0.6;
    B.hp2 = c.createBiquadFilter(); B.hp2.type = 'highpass'; B.hp2.frequency.value = 44; B.hp2.Q.value = 0.6;

    // tone: warmth where small drivers live, minus the 3 kHz shriek and the brittle top
    B.eqLow   = c.createBiquadFilter(); B.eqLow.type   = 'peaking';   B.eqLow.frequency.value   = 155;  B.eqLow.Q.value = 0.8;  B.eqLow.gain.value = 2.4;
    B.eqMud   = c.createBiquadFilter(); B.eqMud.type   = 'peaking';   B.eqMud.frequency.value   = 420;  B.eqMud.Q.value = 1.0;  B.eqMud.gain.value = -2.0;
    B.eqHarsh = c.createBiquadFilter(); B.eqHarsh.type = 'peaking';   B.eqHarsh.frequency.value = 3100; B.eqHarsh.Q.value = 1.1; B.eqHarsh.gain.value = -3.5;
    B.eqAir   = c.createBiquadFilter(); B.eqAir.type   = 'highshelf'; B.eqAir.frequency.value   = 9000; B.eqAir.gain.value = -2.5;

    // gentle glue rather than the old brutal 12:1 pump
    B.glue = c.createDynamicsCompressor();
    B.glue.threshold.value = -21; B.glue.knee.value = 14; B.glue.ratio.value = 2.4;
    B.glue.attack.value = 0.018; B.glue.release.value = 0.20;

    // soft saturation buys loudness without peaks — much kinder than clipping
    B.sat = c.createWaveShaper(); B.sat.oversample = '4x';
    B.satTrim = c.createGain(); B.satTrim.gain.value = 0.84;

    B.limiter = c.createDynamicsCompressor();
    B.limiter.threshold.value = -2.5; B.limiter.knee.value = 1;
    B.limiter.ratio.value = 20; B.limiter.attack.value = 0.002; B.limiter.release.value = 0.13;

    B.master = c.createGain(); B.master.gain.value = this.vol;

    B.sum.connect(B.hp1); B.hp1.connect(B.hp2);
    B.hp2.connect(B.eqLow); B.eqLow.connect(B.eqMud);
    B.eqMud.connect(B.eqHarsh); B.eqHarsh.connect(B.eqAir);
    /* Mid/side width stage. Decodes to M and S, scales the side signal, and
       re-encodes. Bass is already mono so it stays anchored centre; only the
       ambient and formant content spreads. Nearfield monitors want more of
       this than headphones do, where hard separation just fatigues. */
    const split = c.createChannelSplitter(2);
    const negR = c.createGain(); negR.gain.value = -1;
    const mid  = c.createGain(); mid.gain.value  = 0.5;
    const side = c.createGain(); side.gain.value = 0.5;
    B.width    = c.createGain(); B.width.gain.value = 1;
    const negS = c.createGain(); negS.gain.value = -1;
    const wL = c.createGain(), wR = c.createGain();
    const merge = c.createChannelMerger(2);
    B.eqAir.connect(split);
    split.connect(mid, 0); split.connect(mid, 1);
    split.connect(side, 0); split.connect(negR, 1); negR.connect(side);
    side.connect(B.width);
    mid.connect(wL); mid.connect(wR);
    B.width.connect(wL); B.width.connect(negS); negS.connect(wR);
    wL.connect(merge, 0, 0); wR.connect(merge, 0, 1);

    merge.connect(B.glue); B.glue.connect(B.sat); B.sat.connect(B.satTrim);
    B.satTrim.connect(B.limiter); B.limiter.connect(B.master);
    B.master.connect(c.destination);

    // The analyser taps post-tone but pre-compression. Pre-tone would see the
    // organ pedal's sub-octave drone and pin the bass band at ~0.9 forever;
    // post-limiter would make the visuals track gain reduction instead of music.
    B.eqAir.connect(this.analyser);

    B.drums = c.createGain(); B.drums.gain.value = 0.9; B.drums.connect(B.sum);
    B.duck  = c.createGain(); B.duck.gain.value = 1.0;  B.duck.connect(B.sum);
    B.music = c.createGain(); B.music.gain.value = 0.8; B.music.connect(B.duck);

    /* ---- sub bus ------------------------------------------------------
       Clean low end for headphones, plus a parallel harmonic generator.
       A laptop cannot move air at 40 Hz, but the ear reconstructs the
       missing fundamental from its harmonics — so we synthesise them.    */
    B.subIn = c.createGain(); B.subIn.gain.value = 1;

    B.subLp  = c.createBiquadFilter(); B.subLp.type = 'lowpass'; B.subLp.frequency.value = 150; B.subLp.Q.value = 0.6;
    B.subDry = c.createGain(); B.subDry.gain.value = 0.5;
    B.subIn.connect(B.subLp); B.subLp.connect(B.subDry); B.subDry.connect(B.duck);

    const subDrive = c.createGain(); subDrive.gain.value = 3.4;
    B.subSat = c.createWaveShaper(); B.subSat.oversample = '4x';
    const subHp = c.createBiquadFilter(); subHp.type = 'highpass'; subHp.frequency.value = 105; subHp.Q.value = 0.7;
    const subBp = c.createBiquadFilter(); subBp.type = 'lowpass';  subBp.frequency.value = 900; subBp.Q.value = 0.6;
    B.subWet = c.createGain(); B.subWet.gain.value = 1.0;
    B.subIn.connect(subDrive); subDrive.connect(B.subSat);
    B.subSat.connect(subHp); subHp.connect(subBp); subBp.connect(B.subWet); B.subWet.connect(B.duck);

    // reverb — shorter and band-limited so the drop never turns to soup
    const conv = c.createConvolver();
    conv.buffer = this.impulse(2.6, 3.0);
    B.revIn = c.createGain(); B.revIn.gain.value = 1;
    const revHp = c.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 320;
    const revLp = c.createBiquadFilter(); revLp.type = 'lowpass';  revLp.frequency.value = 6200;
    const revOut = c.createGain(); revOut.gain.value = 0.8;
    B.revIn.connect(revHp); revHp.connect(conv); conv.connect(revLp); revLp.connect(revOut); revOut.connect(B.duck);

    // dotted-eighth delay
    const dl = c.createDelay(1.5); dl.delayTime.value = SPB * 0.75;
    const fb = c.createGain(); fb.gain.value = 0.36;
    const dlf = c.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2400;
    const dlh = c.createBiquadFilter(); dlh.type = 'highpass'; dlh.frequency.value = 300;
    B.delIn = c.createGain(); B.delIn.gain.value = 1;
    B.delIn.connect(dl); dl.connect(dlh); dlh.connect(dlf); dlf.connect(fb); fb.connect(dl);
    const dOut = c.createGain(); dOut.gain.value = 0.46;
    dlf.connect(dOut); dOut.connect(B.duck);

    // shared assets
    this.noise = this.noiseBuf(2);
    this.curve = this.shaper(2.6);
    this.curveHard = this.shaper(5.5);
    this.curveSoft = this.shaper(1.4);
    B.sat.curve = this.shaper(1.7);
    B.subSat.curve = this.exciter();
    this.ready = true;
    this.setVoicing(this.voicing);
  },

  /* Three mixes from one engine.

     laptop   — tiny sealed drivers, no output below ~150 Hz worth speaking
                of. Trade sub energy for the harmonics that imply it, push
                the low mids, and compress harder because there is no
                headroom to play with.
     monitors — powered nearfields (KEF LSX II and the like): a real 4.5"
                woofer good to roughly 50 Hz. Genuine low end, so the
                exciter mostly steps aside, but still filtered below ~33 Hz
                because feeding a small woofer infrasound only costs
                excursion. Least compression of the three and the widest
                image, since there is physical speaker separation to use.
     phones    — full extension, flattest response, and a slightly narrowed
                image because hard L/R separation is fatiguing in-head. */
  VOICINGS: {
    laptop:   { hp:48, subDry:0.34, subWet:1.25, low: 2.8, mud:-2.4, harsh:-3.5, air:-1.8, glue:-22, drums:0.86, width:1.00 },
    monitors: { hp:33, subDry:0.85, subWet:0.45, low: 1.0, mud:-1.3, harsh:-2.0, air: 0.6, glue:-15, drums:0.95, width:1.35 },
    phones:   { hp:25, subDry:1.00, subWet:0.30, low: 0.8, mud:-1.2, harsh:-2.0, air: 0.4, glue:-18, drums:0.94, width:0.90 }
  },
  setVoicing(mode){
    if (!this.VOICINGS[mode]) mode = 'laptop';
    this.voicing = mode;
    if (!this.ready) return;
    const B = this.bus, v = this.VOICINGS[mode];
    const t = this.ctx.currentTime, S = (p, x) => p.setTargetAtTime(x, t, 0.04);
    S(B.hp1.frequency, v.hp);  S(B.hp2.frequency, v.hp);
    S(B.subDry.gain, v.subDry); S(B.subWet.gain, v.subWet);
    S(B.eqLow.gain, v.low);     S(B.eqMud.gain, v.mud);
    S(B.eqHarsh.gain, v.harsh); S(B.eqAir.gain, v.air);
    S(B.glue.threshold, v.glue); S(B.drums.gain, v.drums);
    S(B.width.gain, v.width);
  },
  setVolume(v){
    this.vol = Math.max(0, Math.min(1, v));
    if (this.bus.master) this.bus.master.gain.setTargetAtTime(this.vol, this.ctx.currentTime, 0.02);
  },

  noiseBuf(sec){
    const c = this.ctx, len = (c.sampleRate * sec) | 0;
    const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  },
  impulse(dur, decay){
    const c = this.ctx, len = (c.sampleRate * dur) | 0;
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++){
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++){
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return b;
  },
  shaper(k){
    const n = 2048, cv = new Float32Array(n), den = Math.tanh(k);
    for (let i = 0; i < n; i++){ const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(x * k) / den; }
    return cv;
  },
  // Deliberately asymmetric: the squared term throws off even harmonics
  // (octave up), the tanh throws off odd ones. Feed it a 40 Hz sine and you
  // get a 80/120/160 Hz stack a laptop can actually push.
  exciter(){
    const n = 2048, cv = new Float32Array(n);
    for (let i = 0; i < n; i++){
      const x = i / (n - 1) * 2 - 1, t = Math.tanh(x * 2.8);
      cv[i] = (t + 0.5 * t * t - 0.167) / 1.28;
    }
    return cv;
  },
  reg(node){
    this.live.add(node);
    node.onended = () => { this.live.delete(node); try { node.disconnect(); } catch(e){} };
    return node;
  },
  src(buf){ const s = this.ctx.createBufferSource(); s.buffer = buf; return this.reg(s); },
  osc(type, f, t, dur){
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.start(t); o.stop(t + dur);
    return this.reg(o);
  },

  /* ---- instruments ---- */
  // Two-stage recovery: a fast release for the pump, then a slow tail, so the
  // sidechain breathes instead of chopping.
  duckAt(t, amt){
    const g = this.bus.duck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(1 - amt, t + 0.012);
    g.linearRampToValueAtTime(1 - amt * 0.3, t + 0.11);
    g.linearRampToValueAtTime(1, t + 0.30);
  },
  pan(node, amount){
    if (!this.ctx.createStereoPanner) return node;
    const p = this.ctx.createStereoPanner(); p.pan.value = amount;
    node.connect(p); return p;
  },
  /* ---- instruments ------------------------------------------------------
     A cinematic set: pipe organ, string ensemble, choir, bell arpeggio,
     timpani and a clock tick. There is no drum kit and no bass synth. All
     the weight comes from organ pedal tone and timpani fundamentals, which
     sit in a band small speakers can actually reproduce, and their
     sub-octaves go through the exciter rather than raw excursion. */

  // Pipe organ. Drawbar-style rank stack — the sound is entirely in the
  // ratios between the partials, so plain sines do the job.
  organ(t, dur, midi, v, bright){
    const c = this.ctx;
    const g = c.createGain(); g.connect(this.bus.music);
    const rv = c.createGain(); rv.gain.value = v * 1.6; g.connect(rv); rv.connect(this.bus.revIn);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
    lp.frequency.value = 1300 + bright * 3000;
    lp.connect(g);
    const f = mtof(midi);
    // 8', 4', 2 2/3', 2', 1 1/3', 1'
    for (const [mult, amp] of [[1, 1.0], [2, 0.52], [3, 0.30], [4, 0.20], [6, 0.11], [8, 0.06]]){
      if (f * mult > 12000) continue;
      const o = this.osc('sine', f * mult, t, dur + 0.4);
      o.detune.value = (mult % 2 ? 3.5 : -3.5);        // rank spread = natural chorus
      const og = c.createGain(); og.gain.value = amp * (mult > 3 ? bright : 1);
      o.connect(og); og.connect(lp);
    }
    // pipe chiff on the attack
    const n = this.src(this.noise), nf = c.createBiquadFilter(), ng = c.createGain();
    nf.type = 'bandpass'; nf.frequency.value = Math.min(f * 4, 9000); nf.Q.value = 1.2;
    n.connect(nf); nf.connect(ng); ng.connect(g);
    ng.gain.setValueAtTime(v * 0.08 * bright, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
    n.start(t); n.stop(t + 0.1);

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.06);
    g.gain.setValueAtTime(v, t + dur - 0.14);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.1);
  },

  // 16' pedal rank — the floor of the whole piece.
  pedal(t, dur, midi, v){
    const c = this.ctx;
    const g = c.createGain(); g.connect(this.bus.music);
    const f = mtof(midi);
    for (const [mult, amp] of [[1, 0.85], [2, 0.5], [3, 0.2], [4, 0.1]]){
      const o = this.osc('sine', f * mult, t, dur + 0.35);
      const og = c.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(g);
    }
    // sub-octave via the exciter, so laptops get harmonics instead of nothing
    const s = this.osc('sine', f * 0.5, t, dur + 0.35);
    const sg = c.createGain(); s.connect(sg); sg.connect(this.bus.subIn);
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(v * 0.7, t + 0.14);
    sg.gain.setValueAtTime(v * 0.7, t + dur - 0.18);
    sg.gain.linearRampToValueAtTime(0, t + dur);

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.12);
    g.gain.setValueAtTime(v, t + dur - 0.18);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.1);
  },

  // String ensemble: slow bloom, wide, heavily reverbed.
  strings(t, dur, notes, v){
    const c = this.ctx;
    const g = c.createGain(); g.connect(this.bus.music);
    const rv = c.createGain(); rv.gain.value = v * 2.4; g.connect(rv); rv.connect(this.bus.revIn);
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 0.9;
    flt.frequency.setValueAtTime(520, t);
    flt.frequency.linearRampToValueAtTime(2100, t + dur * 0.6);
    flt.frequency.linearRampToValueAtTime(820, t + dur);
    flt.connect(g);
    const L = c.createGain(), R = c.createGain();
    this.pan(L, -0.6).connect(flt); this.pan(R, 0.6).connect(flt);
    for (const m of notes){
      for (const [d, side, amp] of [[-8, L, 0.5], [8, R, 0.5], [0, flt, 0.55]]){
        const o = this.osc('sawtooth', mtof(m), t, dur + 0.55);
        o.detune.value = d;
        const og = c.createGain(); og.gain.value = amp;
        o.connect(og); og.connect(side);
      }
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + dur * 0.45);
    g.gain.setValueAtTime(v, t + dur * 0.76);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
  },

  // Bell arpeggio — the ticking figure. The 4.2x partial is deliberately
  // inharmonic, which is what makes struck metal sound struck.
  arp(t, midi, v){
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 1;
    this.pan(g, (frand(t * 31.7) - 0.5) * 0.6).connect(this.bus.music);
    const dl = c.createGain(); dl.gain.value = v * 0.75; g.connect(dl); dl.connect(this.bus.delIn);
    const rv = c.createGain(); rv.gain.value = v * 0.9;  g.connect(rv); rv.connect(this.bus.revIn);
    const f = mtof(midi);
    for (const [mult, amp, dec] of [[1, 1.0, 0.95], [2, 0.38, 0.55], [3, 0.16, 0.3], [4.2, 0.08, 0.2], [6.8, 0.05, 0.13]]){
      if (f * mult > 13000) continue;
      const o = this.osc('sine', f * mult, t, dec + 0.06);
      const og = c.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(amp * v, t + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0005, t + dec);
      o.connect(og); og.connect(g);
    }
  },

  // Choir "aah" — saw pairs through three vowel formants, with vibrato.
  choir(t, dur, notes, v){
    const c = this.ctx;
    const g = c.createGain(); g.connect(this.bus.music);
    const rv = c.createGain(); rv.gain.value = v * 2.8; g.connect(rv); rv.connect(this.bus.revIn);
    const src = c.createGain(); src.gain.value = 1;
    for (const [fr, q, gn, pv] of [[720, 3.2, 1.0, -0.25], [1180, 4.0, 0.55, 0.25], [2600, 5.0, 0.18, 0]]){
      const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = fr; b.Q.value = q;
      const bg = c.createGain(); bg.gain.value = gn;
      src.connect(b); b.connect(bg); this.pan(bg, pv).connect(g);
    }
    for (const m of notes){
      for (const d of [-6, 6]){
        const o = this.osc('sawtooth', mtof(m), t, dur + 0.45);
        o.detune.value = d;
        const lfo = this.osc('sine', 4.6 + frand(m + d) * 1.4, t, dur + 0.45);
        const lg = c.createGain(); lg.gain.value = 5;
        lfo.connect(lg); lg.connect(o.detune);
        const og = c.createGain(); og.gain.value = 0.42;
        o.connect(og); og.connect(src);
      }
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + dur * 0.35);
    g.gain.setValueAtTime(v, t + dur * 0.72);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
  },

  // Solo line — bowed rather than plucked, with a slow vibrato.
  lead(t, dur, midi, v){
    const c = this.ctx;
    const g = c.createGain(); g.connect(this.bus.music);
    const rv = c.createGain(); rv.gain.value = v * 1.8; g.connect(rv); rv.connect(this.bus.revIn);
    const dd = c.createGain(); dd.gain.value = v * 0.55; g.connect(dd); dd.connect(this.bus.delIn);
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 2500; flt.Q.value = 1.1;
    flt.connect(g);
    const f = mtof(midi);
    for (const [type, mult, amp] of [['triangle', 1, 0.7], ['sawtooth', 1, 0.28], ['sine', 2, 0.14]]){
      const o = this.osc(type, f * mult, t, dur + 0.25);
      const lfo = this.osc('sine', 5.2, t, dur + 0.25);
      const lg = c.createGain(); lg.gain.value = 6;
      lfo.connect(lg); lg.connect(o.detune);
      const og = c.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(flt);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.1);
    g.gain.setValueAtTime(v, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.15);
  },

  // Timpani. Soft felt mallet, inharmonic membrane modes, a slight pitch
  // drop as the head relaxes. This is the piece's only percussive accent.
  timpani(t, midi, v){
    const c = this.ctx;
    const g = c.createGain(); g.connect(this.bus.drums);
    const rv = c.createGain(); rv.gain.value = v * 1.8; g.connect(rv); rv.connect(this.bus.revIn);
    const f = mtof(midi);
    for (const [mult, amp, dec] of [[1, 1.0, 1.1], [1.5, 0.28, 0.5], [2.0, 0.16, 0.34]]){
      const o = this.osc('sine', f * mult, t, dec + 0.1);
      o.frequency.exponentialRampToValueAtTime(f * mult * 0.86, t + dec * 0.7);
      const og = c.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(v * amp, t + 0.009);      // soft front, no click
      og.gain.exponentialRampToValueAtTime(0.0006, t + dec);
      o.connect(og); og.connect(g);
    }
    const n = this.src(this.noise), nf = c.createBiquadFilter(), ng = c.createGain();
    nf.type = 'lowpass'; nf.frequency.value = 850;
    n.connect(nf); nf.connect(ng); ng.connect(g);
    ng.gain.setValueAtTime(v * 0.28, t);
    ng.gain.exponentialRampToValueAtTime(0.0006, t + 0.06);
    n.start(t); n.stop(t + 0.09);
    const s = this.osc('sine', f * 0.5, t, 0.95);
    const sg = c.createGain(); s.connect(sg); sg.connect(this.bus.subIn);
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(v * 0.5, t + 0.014);
    sg.gain.exponentialRampToValueAtTime(0.0006, t + 0.85);
    this.vis(t, 'kick', v);
  },

  // The clock. Quiet, dry, slightly off-centre — it marks time without
  // ever becoming a drum.
  clock(t, v){
    const c = this.ctx, n = this.src(this.noise);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2300; bp.Q.value = 2.2;
    const g = c.createGain();
    n.connect(bp); bp.connect(g);
    this.pan(g, (frand(t * 17.3) - 0.5) * 0.7).connect(this.bus.drums);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.028);
    n.start(t); n.stop(t + 0.05);
  },

  // A crescendo, not a white-noise riser: it opens a band upward and stops
  // well short of the frequencies that hurt on small speakers.
  swell(t, dur, v){
    const c = this.ctx;
    const n = this.src(this.noise); n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.3;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(3000, t + dur);
    const g = c.createGain(); g.connect(this.bus.music);
    const rv = c.createGain(); rv.gain.value = v * 1.6; g.connect(rv); rv.connect(this.bus.revIn);
    n.connect(bp); bp.connect(g);
    g.gain.setValueAtTime(0.0006, t);
    g.gain.exponentialRampToValueAtTime(v * 0.55, t + dur * 0.92);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.start(t); n.stop(t + dur + 0.05);
    this.vis(t, 'riser', dur);
  },

  // Distant thunder for section starts — felt rather than hit, with a
  // 60 ms front so it never reads as an impact.
  boom(t, v){
    const c = this.ctx;
    const n = this.src(this.noise);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1300, t);
    lp.frequency.exponentialRampToValueAtTime(170, t + 2.2);
    const g = c.createGain(); g.connect(this.bus.drums);
    const rv = c.createGain(); rv.gain.value = v * 2.6; g.connect(rv); rv.connect(this.bus.revIn);
    n.connect(lp); lp.connect(g);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.7, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 2.4);
    n.start(t); n.stop(t + 2.5);
    const o = this.osc('sine', 70, t, 1.6);
    o.frequency.exponentialRampToValueAtTime(37, t + 1.3);
    const og = c.createGain(); o.connect(og); og.connect(this.bus.subIn);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(v * 0.85, t + 0.055);
    og.gain.exponentialRampToValueAtTime(0.0006, t + 1.5);
    this.vis(t, 'impact', v);
  },

  vis(t, kind, v){ this.events.push({ t, kind, v }); },

  /* ---- sequencer ---- */
  sectionOfBar(bar){
    for (let i = SECTIONS.length - 1; i >= 0; i--) if (bar >= SECTIONS[i].s) return SECTIONS[i];
    return SECTIONS[0];
  },

  scheduleStep(gs, t){
    const bar = (gs / 16) | 0, st = gs % 16;
    const sec = this.sectionOfBar(bar), lb = bar - sec.s, T = sec.t;
    const ch = PROG[((bar >> 1) % 4)];
    // progress through the section, 0..1 — every section swells across this
    const p = (lb * 16 + st) / (sec.b * 16);

    if (st === 0 && lb === 0) this.vis(t, 'section', SECTIONS.indexOf(sec));

    // the ticking arpeggio runs almost throughout; sections vary its density
    const arpAt = (dens, vel, oct) => {
      if (st % 2) return;                                   // eighth-note grid
      const e = st >> 1;
      if (frand(bar * 31.7 + e * 7.3) > dens) return;
      this.arp(t, ch.notes[ARP[bar % 2][e]] + (oct || 0) * 12, vel);
      if (e === 0) this.vis(t, 'snare', vel * 1.6);         // gives the visuals a pulse
    };
    const leadAt = (vel) => {
      if (st % 2) return;
      const m = LEAD[(((lb % 8) * 8) + (st >> 1)) % 64];
      if (m) this.lead(t, BAR * 0.5, m, vel);
    };

    /* DRIFT — organ pedal in the dark, the clock starting up */
    if (T === 'intro'){
      if (st === 0 && lb === 0) this.boom(t, 0.4);
      if (st === 0 && lb % 4 === 0) this.pedal(t, BAR * 4, ch.root, 0.15 + p * 0.06);
      if (st === 0 && lb % 2 === 0) this.strings(t, BAR * 2, ch.notes.slice(0, 4), 0.045 + p * 0.05);
      if (lb >= 2) arpAt(0.3 + p * 0.55, 0.10 + p * 0.04);
      if (lb >= 4 && st === 0) this.clock(t, 0.05);
      if (lb >= 6 && st === 8) this.clock(t, 0.035);
      if (lb >= 8 && st === 0 && lb % 4 === 0) this.timpani(t, ch.root, 0.3);
      if (lb === sec.b - 1 && st === 0) this.swell(t, BAR, 0.18);
    }

    /* ASCENT — everything tightens and rises into the next horizon */
    else if (T === 'build'){
      const nb = sec.b;
      if (lb === 0 && st === 0) this.swell(t, nb * BAR, 0.3);
      if (st === 0 && lb % 2 === 0){
        this.pedal(t, BAR * 2, ch.root, 0.17 + p * 0.09);
        this.strings(t, BAR * 2, ch.notes, 0.065 + p * 0.085);
      }
      arpAt(0.6 + p * 0.4, 0.10 + p * 0.06);
      if (st === 0) this.clock(t, 0.05 + p * 0.025);
      if (st === 8) this.clock(t, 0.04 + p * 0.025);
      // the timpani pulse doubles, then doubles again
      const div = p < 0.4 ? 16 : (p < 0.72 ? 8 : 4);
      if (st % div === 0) this.timpani(t, ch.root, 0.2 + 0.36 * p);
      if (lb >= nb - 2 && st % 4 === 2) this.arp(t, ch.notes[4] + 12, 0.055 + 0.05 * p);
    }

    /* EVENT HORIZON / INGRESS / SINGULARITY — the peaks. These bloom over
       their full length rather than slamming in: layers arrive in turn and
       the whole section keeps rising until it resolves. */
    else if (T === 'drop' || T === 'drop2' || T === 'final'){
      const big = T !== 'drop';
      const peak = T === 'final';
      const I = 0.55 + 0.45 * Math.min(1, p * 1.55);        // the swell envelope
      if (st === 0 && lb === 0){ this.boom(t, big ? 0.6 : 0.5); this.duckAt(t, 0.2); }
      if (st === 0 && lb % 2 === 0){
        this.pedal(t, BAR * 2, ch.root, 0.2 * I);
        this.organ(t, BAR * 2, ch.notes[0], 0.13 * I, big ? 0.85 : 0.6);
        this.organ(t, BAR * 2, ch.notes[2], 0.09 * I, big ? 0.8 : 0.55);
        this.strings(t, BAR * 2, ch.notes, 0.125 * I);
      }
      if (big && st === 0 && lb % 4 === 0)
        this.choir(t, BAR * 4, [ch.notes[1], ch.notes[3], ch.notes[4]], 0.085 * I);
      arpAt(1.0, 0.105 * I, peak ? 1 : 0);
      if (st === 0) this.timpani(t, ch.root, 0.6 * I);
      if (st === 8) this.timpani(t, ch.root, 0.38 * I);
      if (peak && (st === 4 || st === 12)) this.timpani(t, ch.root + 7, 0.26 * I);
      if (st === 4 || st === 12) this.clock(t, 0.045);
      if (big) leadAt(0.1 * I);
      if (peak && st === 0 && lb % 4 === 2) this.arp(t, ch.notes[4] + 12, 0.09);
    }

    /* FALLING — strips back to arpeggio and voices */
    else if (T === 'break'){
      if (st === 0 && lb % 4 === 0) this.pedal(t, BAR * 4, ch.root, 0.14);
      if (st === 0 && lb % 2 === 0) this.strings(t, BAR * 2, ch.notes.slice(0, 4), 0.085);
      if (st === 0 && lb % 4 === 2) this.choir(t, BAR * 2, [ch.notes[1], ch.notes[3]], 0.07);
      arpAt(0.55 + p * 0.35, 0.105);
      if (st === 0) this.clock(t, 0.05);
      if (lb >= 6 && st === 0 && lb % 2 === 0) this.timpani(t, ch.root, 0.26);
      if (lb === sec.b - 1 && st === 0) this.swell(t, BAR, 0.2);
    }

    /* DILATION — half-time, wide, the solo line carries it */
    else if (T === 'bridge'){
      if (st === 0 && lb % 2 === 0){
        this.pedal(t, BAR * 2, ch.root, 0.18);
        this.strings(t, BAR * 2, ch.notes, 0.115);
        this.organ(t, BAR * 2, ch.notes[0], 0.08, 0.5);
      }
      if (st === 0 && lb % 4 === 0) this.choir(t, BAR * 4, [ch.notes[2], ch.notes[4]], 0.075);
      arpAt(0.85, 0.10);
      if (st === 0) this.timpani(t, ch.root, 0.34);
      if (st === 8) this.clock(t, 0.05);
      leadAt(0.11);
    }

    /* HORIZON — everything recedes until only the pedal is left */
    else if (T === 'outro'){
      const fade = Math.max(0, 1 - lb / sec.b);
      if (st === 0 && lb === 0) this.boom(t, 0.5);
      if (st === 0 && lb % 4 === 0) this.pedal(t, BAR * 4, ch.root, 0.17 * fade + 0.03);
      if (st === 0 && lb % 2 === 0) this.strings(t, BAR * 2, ch.notes.slice(0, 4), 0.1 * fade + 0.02);
      if (lb < 8) arpAt(0.5 * fade + 0.12, 0.1 * fade + 0.02);
      if (lb < 6 && st === 0) this.clock(t, 0.045 * fade);
      if (lb < 5 && st === 0 && lb % 2 === 0) this.timpani(t, ch.root, 0.24 * fade);
    }
  },

  tick(){
    if (this.mode !== 'synth' || !this.playing) return;
    const c = this.ctx, ahead = 0.25;
    while (this.nextStep < TOTAL_STEPS){
      const t = this.startAt + this.nextStep * STEP;
      if (t > c.currentTime + ahead) break;
      this.scheduleStep(this.nextStep, Math.max(t, c.currentTime));
      this.nextStep++;
    }
    if (this.nextStep >= TOTAL_STEPS && c.currentTime > this.startAt + DURATION + 5) this.seek(0);
  },

  start(){
    if (!this.ready) this.init();
    this.ctx.resume();
    this.mode = 'synth';
    this.startAt = this.ctx.currentTime + 0.12;
    this.nextStep = 0;
    this.playing = true;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 25);
  },
  killLive(){
    for (const n of Array.from(this.live)){ try { n.stop(); } catch(e){} }
    this.live.clear();
    this.events.length = 0;
    if (this.bus.duck){ this.bus.duck.gain.cancelScheduledValues(this.ctx.currentTime); this.bus.duck.gain.value = 1; }
  },
  seek(sec){
    if (this.mode === 'file'){ if (this.el) this.el.currentTime = Math.max(0, Math.min(sec, this.el.duration || 0)); return; }
    sec = Math.max(0, Math.min(sec, DURATION - 0.5));
    this.killLive();
    this.startAt = this.ctx.currentTime + 0.06 - sec;
    this.nextStep = Math.floor(sec / STEP);
  },
  toggle(){
    if (!this.ctx) return this.playing;
    if (this.ctx.state === 'running'){ this.ctx.suspend(); if (this.el) this.el.pause(); this.playing = false; }
    else { this.ctx.resume(); if (this.el && this.mode === 'file') this.el.play(); this.playing = true; }
    return this.playing;
  },
  time(){
    if (this.mode === 'file') return this.el ? this.el.currentTime : 0;
    return this.ctx ? Math.max(0, Math.min(this.ctx.currentTime - this.startAt, DURATION)) : 0;
  },
  duration(){ return this.mode === 'file' ? (this.el && this.el.duration ? this.el.duration : 1) : DURATION; },

  loadFile(f){
    if (!this.ready) this.init();
    this.ctx.resume();
    clearInterval(this.timer);
    this.killLive();
    this.mode = 'file';
    if (!this.el){
      this.el = new window.Audio();
      this.el.crossOrigin = 'anonymous';
      // the synth arrangement loops at the end; a loaded track used to stop
      // dead and leave the visualiser sitting on a silent frame
      this.el.loop = true;
      this.elSrc = this.ctx.createMediaElementSource(this.el);
      const g = this.ctx.createGain(); g.gain.value = 0.95;
      // into the sum, so a loaded track gets the same speaker voicing
      this.elSrc.connect(g); g.connect(this.bus.sum);
    }
    if (this.elUrl) URL.revokeObjectURL(this.elUrl);
    this.elUrl = URL.createObjectURL(f);
    this.el.src = this.elUrl;
    this.el.play().catch(() => {});
    this.playing = true;
  },

  update(){
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freq);
    const f = this.freq, n = f.length;
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += f[i]; return s / (b - a) / 255; };
    // bands shifted up: with no kick drum the useful low energy lives in the
    // organ/timpani fundamentals around 60-250 Hz, not down at 20
    const tgt = {
      bass: Math.pow(avg(2, 12), 1.25),
      low:  avg(12, 32),
      mid:  avg(32, 120),
      high: avg(120, Math.min(430, n))
    };
    const k = (cur, t, up, dn) => t > cur ? cur + (t - cur) * up : cur + (t - cur) * dn;
    this.bass = k(this.bass, tgt.bass, 0.55, 0.10);
    this.low  = k(this.low,  tgt.low,  0.45, 0.10);
    this.mid  = k(this.mid,  tgt.mid,  0.35, 0.09);
    this.high = k(this.high, tgt.high, 0.40, 0.10);
    this.level = (this.bass * 1.3 + this.low + this.mid * 0.8 + this.high * 0.5) / 3.6;

    // beat detection (used for user-loaded audio)
    const e = tgt.bass;
    this.hist.push(e); if (this.hist.length > 45) this.hist.shift();
    let m = 0; for (const v of this.hist) m += v; m /= this.hist.length || 1;
    const t = performance.now();
    this.beat = 0;
    if (this.mode === 'file' && e > m * 1.42 && e > 0.16 && t - this.lastBeat > 190){
      this.lastBeat = t; this.beat = Math.min(1, e * 1.6);
    }
  },

  popEvents(cb){
    const lat = (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    const now = this.ctx.currentTime - lat;
    for (let i = this.events.length - 1; i >= 0; i--){
      const ev = this.events[i];
      if (ev.t <= now){ cb(ev); this.events.splice(i, 1); }
      else if (ev.t > now + 6) this.events.splice(i, 1);
    }
  }
};
