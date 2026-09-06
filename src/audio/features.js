/* Musical motion, independent of Web Audio and of the render loop.
   The analyser supplies decibels and a waveform; this layer keeps the slow
   energy of a passage separate from the attacks inside it. All timing is in
   seconds, so a 30 Hz display and a 120 Hz display hear the same music. */
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const follow = (value, target, dt, attack, release) =>
  target + (value - target) * Math.exp(-dt / (target > value ? attack : release));

const BANDS = Object.freeze([
  { name:'sub',  from:25,   to:80,    floor:0.018, attack:0.045, release:0.42 },
  { name:'bass', from:80,   to:250,   floor:0.015, attack:0.035, release:0.32 },
  { name:'low',  from:250,  to:600,   floor:0.009, attack:0.060, release:0.38 },
  { name:'mid',  from:600,  to:2500,  floor:0.004, attack:0.050, release:0.26 },
  { name:'high', from:2500, to:12000, floor:0.001, attack:0.022, release:0.18 }
]);

export function emptyFeatures(){
  return { sub:0, bass:0, low:0, mid:0, high:0, energy:0, brightness:0,
    flux:0, onset:0, beatEnv:0, beatPhase:0, bpm:120, beatConfidence:0,
    rms:0, crest:0 };
}

export class MusicFeatures {
  constructor({ sampleRate = 48000, fftSize = 4096 } = {}){
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.data = emptyFeatures();
    this.previous = new Float32Array(fftSize / 2);
    this.ranges = BANDS.map(b => ({ ...b,
      lo: Math.max(1, Math.ceil(b.from * fftSize / sampleRate)),
      hi: Math.min(fftSize / 2, Math.ceil(b.to * fftSize / sampleRate))
    }));
    this.reset();
  }

  reset(){
    Object.assign(this.data, emptyFeatures());
    this.previous.fill(0);
    this.references = BANDS.map(b => b.floor * 2);
    this.envelopes = BANDS.map(() => 0);
    this.energyReference = 0.12;
    this.energy = 0;
    this.clock = 0;
    this.lastOnset = -10;
    this.period = 0.5;
    this.intervals = [];
    this.fluxMean = 0;
    this.fluxDeviation = 0;
    this.initialized = false;
    this.beatEnvelope = 0;
    this.brightness = 0;
  }

  /* spectrum: linear FFT bins in dBFS; waveform: samples in [-1, 1].
     knownPeriod/position lock the built-in score to its actual audio clock.
     An imported track gets a conservative estimate, with confidence exposed
     so its first few unrelated attacks need not be presented as a tempo. */
  update(spectrum, waveform, dt, {
    playing = true, reactivity = 1, knownPeriod = 0, position = 0
  } = {}){
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.5) : 1 / 60;
    if (dt === 0) { this.data.onset = 0; return this.data; }
    reactivity = Number.isFinite(reactivity) ? clamp(reactivity, 0, 2) : 1;
    this.clock += dt;
    const d = this.data;
    let power = 0, peak = 0;
    if (playing && waveform?.length){
      for (let i = 0; i < waveform.length; i++){
        const sample = Number.isFinite(waveform[i]) ? waveform[i] : 0;
        power += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    const rms = Math.sqrt(power / (waveform?.length || 1));
    // An absolute floor prevents adaptive gain from turning silence into a
    // storm. This gate precedes normalization, not the other way around.
    const gate = clamp((rms - 0.0008) / 0.006);
    this.energyReference = Math.max(0.035,
      follow(this.energyReference, rms, dt, 0.25, 9));
    const energyTarget = gate * clamp(Math.pow(rms / (this.energyReference * 1.5), 0.7));
    this.energy = follow(this.energy, energyTarget, dt, 0.07, 0.65);

    let flux = 0, spectralPower = 0, highPower = 0;
    for (let b = 0; b < this.ranges.length; b++){
      const band = this.ranges[b];
      let sum = 0, rise = 0;
      const hi = Math.min(band.hi, spectrum?.length || 0);
      for (let i = band.lo; i < hi; i++){
        const db = playing ? spectrum[i] : -Infinity;
        const amplitude = Number.isFinite(db) ? Math.pow(10, clamp(db, -120, 6) / 20) : 0;
        sum += amplitude * amplitude;
        // Log compression lets a hi-hat and a low note both contribute.
        // Positive differences detect new sound, never a sustained drone.
        const compressed = Math.log1p(amplitude * 80);
        rise += Math.max(0, compressed - this.previous[i]);
        this.previous[i] = compressed;
      }
      const count = Math.max(1, hi - band.lo);
      const amplitude = Math.sqrt(sum / count);
      this.references[b] = Math.max(band.floor,
        follow(this.references[b], amplitude, dt, 0.30, 8));
      const target = gate * clamp(Math.pow(amplitude / (this.references[b] * 1.45), 0.7));
      this.envelopes[b] = follow(this.envelopes[b], target, dt, band.attack, band.release);
      d[band.name] = clamp(this.envelopes[b] * reactivity);
      // Root-count weighting avoids drowning a narrow bell or hat attack in
      // the hundreds of otherwise empty bins of the high-frequency band.
      flux += rise / Math.sqrt(count * 12) * (b < 2 ? 0.28 : b === 4 ? 0.16 : 0.14);
      spectralPower += sum;
      if (b >= 3) highPower += sum * (b === 4 ? 1 : 0.3);
    }

    const threshold = Math.max(0.004, this.fluxMean * 1.65 + this.fluxDeviation * 1.8);
    let onset = 0;
    if (playing && this.initialized && gate > 0.15 && flux > threshold && this.clock - this.lastOnset > 0.20){
      onset = clamp(0.28 + (flux - threshold) / (threshold * 3.5));
      const interval = this.clock - this.lastOnset;
      if (interval > 0.27 && interval < 2){
        // Fold subdivisions into a useful pulse range, then use a median so
        // a fill or a missed hit cannot instantly throw the orbit off time.
        let candidate = interval;
        while (candidate < 0.34) candidate *= 2;
        while (candidate > 1.0) candidate *= 0.5;
        this.intervals.push(candidate);
        if (this.intervals.length > 9) this.intervals.shift();
        const ordered = [...this.intervals].sort((a, b) => a - b);
        const median = ordered[Math.floor(ordered.length / 2)];
        this.period += (median - this.period) * 0.22;
        const agreed = this.intervals.filter(v => Math.abs(v - median) < median * 0.12).length;
        d.beatConfidence = clamp((agreed - 1) / 5) * agreed / this.intervals.length;
      }
      this.lastOnset = this.clock;
    }
    this.fluxDeviation = follow(this.fluxDeviation, Math.abs(flux - this.fluxMean), dt, 0.6, 1.5);
    this.fluxMean = follow(this.fluxMean, flux, dt, 0.55, 1.8);
    this.initialized = playing;
    if (!playing || this.clock - this.lastOnset > 2.5)
      d.beatConfidence *= Math.exp(-dt / 2);

    this.beatEnvelope *= Math.exp(-dt / 0.32);
    this.beatEnvelope = Math.max(this.beatEnvelope, onset);
    if (knownPeriod > 0){
      d.beatPhase = ((position / knownPeriod) % 1 + 1) % 1;
      d.bpm = 60 / knownPeriod;
      d.beatConfidence = playing ? 1 : 0;
    } else {
      d.beatPhase = ((this.clock - this.lastOnset) / this.period) % 1;
      d.bpm = 60 / this.period;
    }
    this.brightness = follow(this.brightness,
      gate * Math.sqrt(highPower / Math.max(1e-12, spectralPower)), dt, 0.12, 0.45);
    d.energy = clamp(this.energy * reactivity);
    d.brightness = clamp(this.brightness * reactivity);
    d.flux = clamp(flux / Math.max(0.025, threshold * 4) * reactivity);
    d.onset = clamp(onset * reactivity);
    d.beatEnv = clamp(this.beatEnvelope * reactivity);
    d.rms = rms;
    d.crest = rms > 0.0008 ? peak / rms : 0;
    return d;
  }
}
