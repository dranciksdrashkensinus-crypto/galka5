/* ГАЛЬКА — tiny WebAudio chiptune engine. No external files. */
(function (G) {
  const A4 = 440;
  const hz = (m) => A4 * Math.pow(2, (m - 69) / 12);

  const TRACKS = {
    title: {
      step: 0.16, wave: 'square',
      lead: [69, 72, 76, 79, 76, 72, 74, 77, 81, 77, 74, 72, 69, 0, 72, 0],
      bass: [45, 0, 45, 0, 41, 0, 41, 0, 43, 0, 43, 0, 40, 0, 40, 0]
    },
    home: {
      step: 0.19, wave: 'triangle',
      lead: [60, 64, 67, 72, 69, 67, 64, 0, 62, 65, 69, 74, 72, 69, 65, 0],
      bass: [36, 0, 0, 0, 41, 0, 0, 0, 38, 0, 0, 0, 43, 0, 0, 0]
    },
    path: {
      step: 0.145, wave: 'square',
      lead: [72, 0, 74, 76, 0, 79, 76, 74, 72, 0, 69, 72, 74, 0, 76, 0],
      bass: [48, 0, 48, 0, 43, 0, 43, 0, 45, 0, 45, 0, 41, 0, 41, 0]
    },
    abayunda: {
      step: 0.17, wave: 'triangle',
      lead: [69, 0, 72, 74, 76, 0, 74, 72, 69, 0, 67, 69, 72, 0, 69, 0],
      bass: [45, 0, 45, 45, 41, 0, 41, 41, 43, 0, 43, 43, 40, 0, 40, 40]
    },
    huyet: {
      step: 0.21, wave: 'sawtooth',
      lead: [52, 55, 57, 55, 52, 0, 50, 52, 55, 0, 57, 60, 57, 55, 52, 0],
      bass: [28, 0, 28, 0, 33, 0, 33, 0, 31, 0, 31, 0, 27, 0, 27, 0]
    },
    afina: {
      step: 0.15, wave: 'square',
      lead: [76, 79, 81, 84, 81, 79, 76, 0, 74, 77, 81, 86, 84, 81, 77, 0],
      bass: [48, 0, 55, 0, 53, 0, 55, 0, 50, 0, 57, 0, 55, 0, 53, 0]
    },
    yasr: {
      step: 0.115, wave: 'square',
      lead: [72, 72, 76, 79, 81, 79, 76, 72, 74, 74, 77, 81, 83, 81, 77, 74],
      bass: [36, 36, 43, 36, 38, 38, 45, 38, 41, 41, 48, 41, 36, 36, 43, 36]
    },
    director: {
      step: 0.135, wave: 'sawtooth',
      lead: [69, 72, 76, 72, 68, 72, 75, 72, 67, 71, 74, 71, 65, 69, 72, 69],
      bass: [33, 0, 33, 33, 32, 0, 32, 32, 31, 0, 31, 31, 28, 0, 28, 28]
    },
    victory: {
      step: 0.13, wave: 'square',
      lead: [72, 76, 79, 84, 0, 79, 84, 88, 0, 84, 88, 91, 88, 84, 79, 0],
      bass: [48, 0, 48, 0, 53, 0, 53, 0, 55, 0, 55, 0, 48, 0, 48, 0]
    },
    ending: {
      step: 0.24, wave: 'triangle',
      lead: [60, 64, 67, 72, 0, 71, 67, 64, 65, 69, 72, 77, 0, 72, 69, 0],
      bass: [36, 0, 0, 0, 41, 0, 0, 0, 43, 0, 0, 0, 36, 0, 0, 0]
    }
  };

  class Chip {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.trackName = null;
      this.step = 0;
      this.next = 0;
      this.noiseBuf = null;
    }

    ensure() {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.17;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.4);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }

    setMuted(v) {
      this.muted = !!v;
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.17, this.ctx.currentTime, 0.02);
    }

    setTrack(name) {
      if (this.trackName === name) return;
      this.trackName = name;
      this.step = 0;
      if (this.ctx) this.next = this.ctx.currentTime + 0.06;
    }

    note(midi, when, dur, wave, vol, detune = 0) {
      if (!this.ctx || midi === 0 || midi == null) return;
      const t = Math.max(when, this.ctx.currentTime);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = wave || 'square';
      osc.frequency.setValueAtTime(hz(midi), t);
      if (detune) osc.detune.setValueAtTime(detune, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.03);
    }

    noise(when, dur, vol, freq = 1200) {
      if (!this.ctx) return;
      const t = Math.max(when, this.ctx.currentTime);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter); filter.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.02);
    }

    sweep(f1, f2, dur, wave, vol) {
      if (!this.ensure()) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = wave || 'square';
      osc.frequency.setValueAtTime(f1, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    }

    tick() {
      if (!this.ctx || !this.trackName || this.muted) {
        if (this.ctx) this.next = this.ctx.currentTime + 0.05;
        return;
      }
      const tr = TRACKS[this.trackName];
      if (!tr) return;
      if (this.next < this.ctx.currentTime - 0.5) this.next = this.ctx.currentTime + 0.05;
      while (this.next < this.ctx.currentTime + 0.22) {
        const i = this.step % tr.lead.length;
        const lead = tr.lead[i];
        const bass = tr.bass ? tr.bass[i] : 0;
        this.note(lead, this.next, tr.step * 1.6, tr.wave, 0.16);
        if (i % 4 === 0) this.note(lead ? lead - 12 : 0, this.next, tr.step * 0.7, 'square', 0.05, 6);
        this.note(bass, this.next, tr.step * 1.4, 'triangle', 0.24);
        if (i % 8 === 0) this.noise(this.next, 0.05, 0.035, 3000);
        this.step++;
        this.next += tr.step;
      }
    }

    sfx(name) {
      if (this.muted || !this.ensure()) return;
      const t = this.ctx.currentTime;
      switch (name) {
        case 'move': this.note(84, t, 0.05, 'square', 0.10); break;
        case 'select':
          this.note(76, t, 0.07, 'square', 0.16);
          this.note(83, t + 0.06, 0.10, 'square', 0.16);
          break;
        case 'back': this.sweep(520, 240, 0.12, 'square', 0.12); break;
        case 'hurt':
          this.noise(t, 0.22, 0.28, 700);
          this.sweep(300, 70, 0.3, 'sawtooth', 0.2);
          break;
        case 'hit':
          this.noise(t, 0.13, 0.24, 2400);
          this.note(52, t, 0.12, 'square', 0.24);
          break;
        case 'charge': this.sweep(220, 900, 0.22, 'square', 0.10); break;
        case 'phase':
          this.sweep(140, 720, 0.42, 'sawtooth', 0.16);
          [64, 68, 71, 76].forEach((n, i) => this.note(n, t + i * 0.06, 0.26, 'square', 0.14));
          break;
        case 'warn': this.note(88, t, 0.06, 'square', 0.08); break;
        case 'spare':
          [72, 76, 79, 84].forEach((n, i) => this.note(n, t + i * 0.09, 0.28, 'triangle', 0.20));
          break;
        case 'win':
          [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => this.note(n, t + i * 0.1, 0.24, 'square', 0.18));
          break;
        case 'door': this.sweep(180, 90, 0.18, 'triangle', 0.20); break;
        case 'save':
          [79, 84, 88].forEach((n, i) => this.note(n, t + i * 0.07, 0.3, 'triangle', 0.17));
          break;
        case 'bullet': this.note(93, t, 0.035, 'square', 0.035); break;
      }
    }
  }

  G.audio = new Chip();
})(window.GALKA = window.GALKA || {});
