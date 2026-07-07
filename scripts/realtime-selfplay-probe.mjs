// 실시간 자기대국 프로브(로드맵 A1) — '사람 페이스 + 실시간 레이어'의 밸런스 측정.
//
// selfplay-probe와의 차이: 결정 사이에 '생각 시간'이 흐르고 그동안 실시간 레이어
// (시계·압박수 조여옴·홀더 드리프트·역할 런·블록 호흡)가 적용된다 — main.js 렌더
// 루프와 같은 조건을 헤드리스로 재현(16ms 스텝 펌핑, 벽시계 대기 없음 → 빠름).
// 직접 플레이 5판에서 증명된 "시계 유무로 전승↔실점"의 그 차이를 게이트화하는 토대.
//
// 실행: node scripts/realtime-selfplay-probe.mjs [경기수] [thinkMs]
//   thinkMs = 결정당 생각 시간(기본 1500 — 무난한 사람 페이스. 3200 = 꾸물이).

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy } from '../js/engine/policy.js';
import { applyRealtimePress } from '../js/engine/realtime.js';

const N = Number(process.argv[2] ?? 300);
const THINK_MS = Number(process.argv[3] ?? 1500);
const CELLS = ['A1', 'A2', 'B1', 'B2'];
const TURN_CAP = 60;
const STEP = 16;

// main.js realtimeActive와 동일 조건(가이드락 제외 — 헤드리스): 결정 대기·us 공격.
function rtActive(e) {
  const s = e.state;
  return s.status === 'live' && !e.busy && !s.matchDecision && e.holder()?.side === 'us';
}

// 생각 시간 + 애니메이션을 16ms 스텝으로 펌핑 — 실시간 레이어가 실제로 문다.
function passTime(e, ms) {
  for (let t = 0; t < ms && e.state.status === 'live'; t += STEP) {
    e.update(STEP);
    applyRealtimePress(e, STEP, rtActive(e));
  }
}

export function playMatch(seed, cell, thinkMs = THINK_MS) {
  const e = createEngine(getScenario(cell), seed, { baitCombo: true });
  const s = e.state;
  let turns = 0, stuck = 0, baits = 0, decisions = 0, pressureSum = 0;
  while (s.status === 'live' && turns < TURN_CAP) {
    passTime(e, thinkMs);                       // 생각하는 동안 시간이 흐른다
    while (e.busy && s.status === 'live') passTime(e, STEP * 4);   // 잔여 애니 소화
    if (s.status !== 'live') break;
    if (s.baited) baits++;
    const view = buildPolicyView(e, 'us');
    const action = aiPolicy(view);
    if (action.kind === 'noop') {
      // 정책이 못 다루는 결정(tempo/flank/전환)은 1번 선택지로 해소(사람의 기본값).
      if (s.matchDecision?.choices?.length) { e.chooseSituationOption(s.matchDecision.choices[0].id); stuck = 0; }
      else if (++stuck > 4) break;
      continue;
    }
    decisions++;
    pressureSum += s.pressure ?? 0;
    const r = executePolicyAction(e, action);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  passTime(e, 4000);                            // 마지막 애니·붕괴 소화
  const o = s.outcome;
  return {
    tone: o?.tone ?? 'timeout', kind: o?.kind ?? 'timeout', turns,
    baits, thirdMan: s.facts?.thirdMan ?? 0,
    avgPressure: decisions ? pressureSum / decisions : 0,
  };
}

export function runBatch(n, thinkMs) {
  const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
  let collapsed = 0, baits = 0, thirdMan = 0, turns = 0, avgP = 0;
  for (let i = 0; i < n; i++) {
    const m = playMatch(i * 7 + 13, CELLS[i % CELLS.length], thinkMs);
    tones[m.tone] = (tones[m.tone] || 0) + 1;
    if (m.kind === 'collapsed') collapsed++;
    baits += m.baits; thirdMan += m.thirdMan; turns += m.turns; avgP += m.avgPressure;
  }
  return {
    n, goalPct: tones.goal / n * 100, nearPct: tones.near / n * 100,
    failPct: tones.fail / n * 100, timeoutPct: (tones.timeout || 0) / n * 100,
    collapsePct: collapsed / n * 100, baitsPerGame: baits / n, thirdMan,
    avgTurns: turns / n, avgPressure: avgP / n,
  };
}

// ── 실행(직접 호출 시) ────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('realtime-selfplay-probe.mjs')) {
  console.log(`=== 실시간 자기대국 프로브 — ${N}경기 · 생각 ${THINK_MS}ms/결정 ===\n`);
  const r = runBatch(N, THINK_MS);
  console.log(`  goal ${r.goalPct.toFixed(1)}%  near ${r.nearPct.toFixed(1)}%  fail ${r.failPct.toFixed(1)}%  timeout ${r.timeoutPct.toFixed(1)}%`);
  console.log(`  붕괴(collapsed) ${r.collapsePct.toFixed(1)}%  평균 결정시 게이지 ${r.avgPressure.toFixed(0)}  평균 턴 ${r.avgTurns.toFixed(1)}`);
  console.log(`  유인 arm/경기 ${r.baitsPerGame.toFixed(2)}  3자 릴리스 총 ${r.thirdMan}`);
  console.log('\n비교용: 정지 selfplay(시계 없음)는 selfplay-probe.mjs — goal ~23.5%.');
  console.log('완료.');
}
