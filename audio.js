/** Lightweight synthesized game audio — no asset downloads, one AudioContext. */

const RADIO_STATIONS = [
  { name: 'VICE FM', step: 0.17, leadType: 'sawtooth',
    bass: [0, null, 0, 7, null, 0, 3, null], lead: [12, 15, 19, 15, 12, 10, 15, 19], pad: [0, 7, 3, 10] },
  { name: 'WAVE 103', step: 0.23, leadType: 'triangle',
    bass: [0, null, 5, null, 7, null, 5, null], lead: [19, null, 22, null, 24, null, 19, null], pad: [7, 12, 15, 12] },
  { name: 'LOS SANTOS', step: 0.19, leadType: 'square',
    bass: [0, 0, null, 0, 7, null, 0, 5], lead: [12, null, 15, null, 17, null, 15, null], pad: [0, 3, 7, 10] }
];

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.siren = null;
    this.noise = null;
    this.radio = { station: -1, step: 0, next: 0, gain: null };
  }

  /** Create (or resume) the context after the first user gesture. */
  init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      this.ctx = new Ctx();
    } catch (_) {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(ctx.destination);

    const engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 260;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter).connect(engineGain).connect(this.master);
    engineOsc.start();
    this.engine = { osc: engineOsc, filter: engineFilter, gain: engineGain };

    const sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'sine';
    sirenOsc.frequency.value = 600;
    const sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain).connect(this.master);
    sirenOsc.start();
    this.siren = { osc: sirenOsc, gain: sirenGain };

    const length = Math.floor(ctx.sampleRate * 0.4);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    const radioGain = ctx.createGain();
    radioGain.gain.value = 0;
    radioGain.connect(this.master);
    this.radio.gain = radioGain;
  }

  state() { return this.ctx ? this.ctx.state : 'uninitialized'; }

  silence() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.engine.gain.gain.setTargetAtTime(0, now, 0.05);
    this.siren.gain.gain.setTargetAtTime(0, now, 0.05);
    if (this.radio.gain) this.radio.gain.gain.setTargetAtTime(0, now, 0.05);
  }

  update(game, dt) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const ratio = Math.min(1, Math.abs(game.player.speed) / game.player.maxSpeed);
    this.engine.gain.gain.setTargetAtTime(
      game.player.inVehicle && !game.paused ? 0.05 + ratio * 0.13 : 0, now, 0.12
    );
    this.engine.osc.frequency.setTargetAtTime(55 + ratio * 155, now, 0.09);
    this.engine.filter.frequency.setTargetAtTime(260 + ratio * 900, now, 0.09);
    this.siren.gain.gain.setTargetAtTime(game.wanted > 0 ? 0.045 : 0, now, 0.2);
    this.siren.osc.frequency.setTargetAtTime(620 + Math.sin(now * 7) * 190, now, 0.03);
    this.updateRadio(game);
  }

  tone(freq, duration = 0.12, type = 'sine', volume = 0.18, delay = 0, bus = null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(bus || this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  burst(volume = 0.28, cutoff = 900, delay = 0, bus = null) {
    if (!this.ctx || !this.noise) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    src.connect(filter).connect(gain).connect(bus || this.master);
    src.start(now);
    src.stop(now + 0.4);
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  /** Cycle OFF → station 1 → station 2 → station 3 → OFF. */
  cycleRadio() {
    this.radio.station = (this.radio.station + 2) % (RADIO_STATIONS.length + 1) - 1;
    this.radio.step = 0;
    if (this.ctx) this.radio.next = this.ctx.currentTime;
    return this.radio.station < 0 ? 'OFF' : RADIO_STATIONS[this.radio.station].name;
  }

  radioName() {
    return this.radio.station < 0 ? 'RADIO OFF' : RADIO_STATIONS[this.radio.station].name;
  }

  /** Schedule a short lookahead of notes so the beat stays steady under frame dips. */
  updateRadio(game) {
    if (!this.ctx || !this.radio.gain) return;
    const now = this.ctx.currentTime;
    const station = RADIO_STATIONS[this.radio.station];
    const on = !!station && game.player.inVehicle && !game.paused;
    this.radio.gain.gain.setTargetAtTime(on ? 0.9 : 0, now, 0.12);
    if (!on) { this.radio.next = now; return; }
    // After a long frame stall, restart the bar instead of dumping a burst of late notes.
    if (this.radio.next < now - 0.5) this.radio.next = now;
    const bus = this.radio.gain;

    while (this.radio.next < now + 0.3) {
      const s = this.radio.step++;
      const delay = Math.max(0, this.radio.next - now);
      const hz = (semi) => 55 * Math.pow(2, semi / 12);
      const bass = station.bass[s % station.bass.length];
      if (bass !== null && bass !== undefined) {
        this.tone(hz(bass), station.step * 1.7, 'triangle', 0.15, delay, bus);
      }
      const lead = station.lead[s % station.lead.length];
      if (lead !== null && lead !== undefined) {
        this.tone(hz(lead), station.step * 0.9, station.leadType, 0.06, delay, bus);
      }
      if (s % 8 === 0) {
        const pad = station.pad[(s / 8 | 0) % station.pad.length];
        this.tone(hz(pad + 24), station.step * 7, 'sine', 0.035, delay, bus);
      }
      if (s % 4 === 0) this.burst(0.04, 2400, delay, bus);
      if (s % 8 === 4) this.burst(0.055, 1200, delay, bus);
      this.radio.next += station.step;
    }
  }

  explosion() {
    this.burst(0.55, 320);
    this.tone(60, 0.6, 'sawtooth', 0.26);
    this.tone(110, 0.35, 'triangle', 0.16, 0.05);
  }
  shoot() { this.burst(0.13, 3800); this.tone(190, 0.06, 'square', 0.07); }
  enemyShot() { this.burst(0.08, 2800); this.tone(140, 0.05, 'sawtooth', 0.045); }
  reload() {
    this.tone(430, 0.05, 'square', 0.05, 0);
    this.tone(620, 0.05, 'square', 0.05, 0.18);
  }
  impact() { this.burst(0.05, 2100); }
  crash() { this.burst(0.3, 750); this.tone(90, 0.22, 'triangle', 0.16); }
  hit() { this.burst(0.22, 1400); this.tone(180, 0.14, 'square', 0.08); }
  repair() { this.tone(520, 0.1, 'sine', 0.12); this.tone(780, 0.16, 'sine', 0.12, 0.09); }
  checkpoint() { this.tone(740, 0.1, 'sine', 0.15); this.tone(1100, 0.18, 'sine', 0.15, 0.08); }
  complete() {
    [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.14, i * 0.09));
  }
  wanted() { this.tone(440, 0.1, 'square', 0.1); this.tone(660, 0.14, 'square', 0.1, 0.1); }
  death() { this.tone(220, 0.5, 'sawtooth', 0.14); this.tone(110, 0.7, 'triangle', 0.12, 0.15); }
}
