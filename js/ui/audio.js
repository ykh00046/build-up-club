// WebAudio synth layer — zero asset files. Embodied pressure (concept §9):
// a crowd bed that swells with the hidden pressure level, a heartbeat when
// the press is closing, and short cues for every tactical beat. Every sound
// is a small synth patch, so samples can replace any of them later without
// touching call sites.

let ctx = null;
let master = null;
let crowdGain = null;
let heartbeatTimer = null;
let enabled = true;

const STORE_KEY = 'beat-the-block:sound';

export function soundEnabled() { return enabled; }

export function setSoundEnabled(v) {
  enabled = v;
  try { localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch { /* ok */ }
  if (master) master.gain.value = v ? 1 : 0;
}

export function initAudio() {
  try { enabled = localStorage.getItem(STORE_KEY) !== '0'; } catch { /* ok */ }
}

// Browsers require a user gesture before audio — call this from any click.
export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = enabled ? 1 : 0;
  master.connect(ctx.destination);
  startCrowdBed();
  window.__audio = { ctx, sfx, setPressureLevel }; // debug/testing handle
}

// ─── synth helpers ───────────────────────────────────────────────────────────

function noiseBuffer(seconds = 1) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // brown-ish noise: warmer than white, reads as distant crowd
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

function env(gainNode, t0, peak, attack, decay) {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function tone(freq, type, peak, attack, decay, { sweepTo = null, when = 0 } = {}) {
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + attack + decay);
  const g = ctx.createGain();
  env(g, t0, peak, attack, decay);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + attack + decay + 0.05);
}

function noiseHit(peak, attack, decay, { filterType = 'lowpass', freq = 600, sweepTo = null, when = 0 } = {}) {
  const t0 = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(attack + decay + 0.1);
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + attack + decay);
  const g = ctx.createGain();
  env(g, t0, peak, attack, decay);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + attack + decay + 0.1);
}

// ─── continuous layers ───────────────────────────────────────────────────────

function startCrowdBed() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(4);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 420;
  crowdGain = ctx.createGain();
  crowdGain.gain.value = 0.025;
  src.connect(f); f.connect(crowdGain); crowdGain.connect(master);
  src.start();
}

// Called every frame with pressure 0..1: the stadium feels the squeeze.
export function setPressureLevel(level) {
  if (!ctx || !crowdGain) return;
  const target = 0.02 + level * 0.075;
  crowdGain.gain.setTargetAtTime(target, ctx.currentTime, 0.4);

  const wantHeartbeat = level >= 0.78;
  if (wantHeartbeat && !heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      if (!ctx || !enabled) return;
      tone(58, 'sine', 0.16, 0.012, 0.1);
      tone(52, 'sine', 0.1, 0.012, 0.09, { when: 0.18 });
    }, 850);
  } else if (!wantHeartbeat && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── one-shot cues ───────────────────────────────────────────────────────────

export const sfx = {
  kick(strength = 0.5) {
    if (!ctx) return;
    noiseHit(0.20 * strength + 0.05, 0.005, 0.07, { freq: 900, sweepTo: 250 });
    tone(95, 'sine', 0.22 * strength + 0.04, 0.005, 0.09, { sweepTo: 55 });
  },
  whoosh() {
    if (!ctx) return;
    noiseHit(0.10, 0.16, 0.34, { filterType: 'bandpass', freq: 500, sweepTo: 1800 });
  },
  tick() {
    if (!ctx) return;
    tone(1250, 'triangle', 0.05, 0.003, 0.045);
  },
  chime() {
    if (!ctx) return;
    tone(740, 'sine', 0.09, 0.008, 0.22);
    tone(1108, 'sine', 0.07, 0.008, 0.3, { when: 0.09 });
  },
  sting() {
    if (!ctx) return;
    tone(170, 'sawtooth', 0.10, 0.006, 0.16);
    tone(180, 'sawtooth', 0.08, 0.006, 0.16);
    noiseHit(0.12, 0.004, 0.1, { freq: 500, sweepTo: 140 });
  },
  goal() {
    if (!ctx) return;
    // crowd eruption + bright chord
    noiseHit(0.34, 0.07, 1.9, { filterType: 'bandpass', freq: 700, sweepTo: 380 });
    const chord = [523.25, 659.25, 784];
    chord.forEach((f, i) => tone(f, 'triangle', 0.09, 0.01, 0.7, { when: 0.05 + i * 0.05 }));
    tone(98, 'sine', 0.2, 0.01, 0.5, { sweepTo: 70 });
  },
  near() {
    if (!ctx) return;
    // the "ooh" — swell that falls away
    noiseHit(0.2, 0.12, 0.7, { filterType: 'bandpass', freq: 650, sweepTo: 280 });
  },
  collapse() {
    if (!ctx) return;
    tone(240, 'sawtooth', 0.08, 0.02, 0.55, { sweepTo: 70 });
    tone(120, 'sine', 0.1, 0.02, 0.5, { sweepTo: 50 });
  },
  // ── 실시간 문법 큐(A4) — 절제된 미니멀 ─────────────────────────────
  whistle() {
    if (!ctx) return;
    // 심판 휘슬 — 삑-삑(짧은 더블 버스트). 시도 종료의 표식.
    tone(2350, 'square', 0.045, 0.004, 0.11);
    tone(2350, 'square', 0.05, 0.004, 0.16, { when: 0.16 });
  },
  slowmo() {
    if (!ctx) return;
    // 시간이 늘어진다 — 아래로 미끄러지는 소프트 스윕(수동 슬로우 진입).
    tone(660, 'sine', 0.06, 0.01, 0.5, { sweepTo: 220 });
    noiseHit(0.045, 0.05, 0.45, { filterType: 'lowpass', freq: 1200, sweepTo: 300 });
  },
  baitPull() {
    if (!ctx) return;
    // 물었다! — 짧은 상승 2음(기대감).
    tone(392, 'triangle', 0.07, 0.006, 0.12);
    tone(523.25, 'triangle', 0.08, 0.006, 0.18, { when: 0.08 });
  },
  baitMiss() {
    if (!ctx) return;
    // 안 물었다 — 낮은 무딘 톡(F2 로그 피드백과 쌍).
    tone(160, 'sine', 0.06, 0.005, 0.12, { sweepTo: 110 });
  },
  releaseChime() {
    if (!ctx) return;
    // 3자 릴리스 — 빠른 상승 3연음(콤비 완성의 시그니처).
    [659.25, 830.6, 987.77].forEach((f, i) => tone(f, 'triangle', 0.07, 0.006, 0.22, { when: i * 0.055 }));
  },
};
