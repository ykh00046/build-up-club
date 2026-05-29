// ─── Audio Manager (Web Audio API, 8-bit) & Ad Manager (Poki SDK) ────────
const AudioMgr = {
  ctx: null,
  muted: false,
  volume: 0.3,

  bgmInterval: null,
  bgmIndex: 0,
  bgmSequence: [
    261.63, 329.63, 392.00, 523.25, 392.00, 329.63,
    293.66, 349.23, 440.00, 587.33, 440.00, 349.23,
    329.63, 392.00, 493.88, 659.25, 493.88, 392.00,
    349.23, 440.00, 523.25, 698.46, 523.25, 440.00
  ],

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) { /* no audio */ }
  },

  play(type) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    switch(type) {
      case 'pass': this._beep(440, 0.08, 'square', 660); break;
      case 'fail': this._beep(220, 0.25, 'sawtooth', 110); break;
      case 'goal': this._fanfare(); break;
      case 'star': this._beep(880, 0.1, 'square', 1100); break;
      case 'click': this._beep(600, 0.04, 'square', 600); break;
      case 'undo': this._beep(330, 0.06, 'triangle', 220); break;
      case 'lock': this._beep(150, 0.15, 'sawtooth', 100); break;
    }
  },

  _beep(freq, dur, wave, endFreq) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(endFreq || freq, this.ctx.currentTime + dur);
    gain.gain.setValueAtTime(this.volume * 0.5, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + dur);
  },

  _fanfare() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      setTimeout(() => this._beep(f, 0.15, 'square', f), i * 120);
    });
  },

  startBGM() {
    this.init();
    if (!this.ctx || this.muted || this.bgmInterval) return;
    this.bgmIndex = 0;
    this.bgmInterval = setInterval(() => {
      if (this.muted || !this.ctx || this.ctx.state === 'suspended') return;
      const note = this.bgmSequence[this.bgmIndex];
      this._playBgmNote(note, 0.12);
      this.bgmIndex = (this.bgmIndex + 1) % this.bgmSequence.length;
    }, 180);
  },

  stopBGM() {
    if (this.bgmInterval) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
  },

  _playBgmNote(freq, dur) {
    if (!this.ctx || this.muted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(this.volume * 0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + dur);
    } catch (e) {}
  }
};

const AdMgr = {
  sdk: null,
  loaded: false,
  gameplayActive: false,

  init() {
    if (typeof PokiSDK !== 'undefined') {
      this.sdk = PokiSDK;
      this.sdk.init().then(() => {
        this.loaded = true;
        console.log("Poki SDK initialized successfully");
      }).catch(() => {
        this.loaded = false;
        console.log("Poki SDK failed to initialize");
      });
    }
  },

  gameplayStart() {
    if (this.loaded && !this.gameplayActive) {
      this.sdk.gameplayStart();
      this.gameplayActive = true;
    }
  },

  gameplayStop() {
    if (this.loaded && this.gameplayActive) {
      this.sdk.gameplayStop();
      this.gameplayActive = false;
    }
  },

  commercialBreak(callback) {
    if (this.loaded) {
      const wasMuted = AudioMgr.muted;
      AudioMgr.muted = true;
      AudioMgr.stopBGM();

      this.sdk.commercialBreak().then(() => {
        AudioMgr.muted = wasMuted;
        if (!AudioMgr.muted) AudioMgr.startBGM();
        if (callback) callback();
      }).catch(() => {
        AudioMgr.muted = wasMuted;
        if (!AudioMgr.muted) AudioMgr.startBGM();
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  },

  rewardedBreak(callback) {
    if (this.loaded) {
      const wasMuted = AudioMgr.muted;
      AudioMgr.muted = true;
      AudioMgr.stopBGM();

      this.sdk.rewardedBreak().then((success) => {
        AudioMgr.muted = wasMuted;
        if (!AudioMgr.muted) AudioMgr.startBGM();
        if (callback) callback(success);
      }).catch(() => {
        AudioMgr.muted = wasMuted;
        if (!AudioMgr.muted) AudioMgr.startBGM();
        if (callback) callback(false);
      });
    } else {
      setTimeout(() => {
        if (callback) callback(true);
      }, 500);
    }
  }
};

// Global exports
if (typeof window !== 'undefined') {
  window.AudioMgr = AudioMgr;
  window.AdMgr = AdMgr;
}
