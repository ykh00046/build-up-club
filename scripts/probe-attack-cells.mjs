// probe-attack-cells — 공격(빌드업) 관점 셀 전수 프로브.
// selfplay-probe 는 A1/A2/B1/B2(hybrid·man)만 돌린다 — 여기서는 10셀 전부(6개 스킴)를
// aiPolicy 로 자동 플레이해 스킴별 공격 난이도 구별성 + 타임아웃 원인을 진단한다.
//
// 실행: node scripts/probe-attack-cells.mjs [셀당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario, SCENARIOS } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 200);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;
const PHASE_RANK = { BUILDUP: 0, PRESSING: 0, PROGRESSION: 1, FINAL_THIRD: 2, SHOT: 3 };

function playMatch(seed, cell) {
  const engine = createEngine(getScenario(cell), seed);
  const actions = {};
  const rejects = {};
  let turns = 0, stuck = 0, stuckBreak = false;
  let maxPhase = 0;
  let shots = 0, xgSum = 0;
  let restarts = 0, concededShots = 0;
  let lastReject = null;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    maxPhase = Math.max(maxPhase, PHASE_RANK[view.phase] ?? 0);
    const action = aiPolicy(view);
    if (action.kind === 'noop') { if (++stuck > 4) { stuckBreak = true; break; } continue; }
    const key = action.actionId || action.choiceId || action.kind;
    actions[key] = (actions[key] || 0) + 1;
    if (key === 'shoot') { const s = engine.previewShot?.(); if (s) { shots++; xgSum += s.xg; } }
    const r = executePolicyAction(engine, action);
    settle(engine);
    if (r?.restarted) restarts++;
    if (r?.conceded === false || r?.conceded === true) concededShots++;
    if (!r || r.ok === false) {
      const msg = r?.message ?? (r?.rejected ? 'rejected(no-msg)' : 'ok:false(턴오버)');
      lastReject = `${key} | ${msg}`;
      rejects[lastReject] = (rejects[lastReject] || 0) + 1;
      if (++stuck > 4) { stuckBreak = true; break; }
    } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  return {
    tone: o?.tone ?? 'timeout', kind: o?.kind ?? 'timeout', turns, engineTurn: engine.state.turn,
    actions, rejects, stuckBreak, maxPhase, shots, xgSum, restarts, concededShots, lastReject,
    endPhase: engine.state.phase, endDecision: engine.state.matchDecision?.id ?? null,
    endHolderX: engine.holder?.()?.x ?? null,
  };
}

function pct(part, whole) { return whole ? (part / whole * 100).toFixed(1) : '0'; }

console.log(`=== 공격 프로브: 10셀 × ${N}경기 (aiPolicy) ===\n`);

const timeoutDiag = { stuckBreak: 0, turnCap: 0, rejects: {}, endStates: {} };
const globalActions = {};
const rows = [];

for (const cell of CELLS) {
  const sc = SCENARIOS[cell];
  const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
  const kinds = {};
  let totalTurns = 0, shotMatches = 0, shots = 0, xgSum = 0, finalThird = 0, restarts = 0;
  for (let i = 0; i < N; i++) {
    const m = playMatch(i * 7 + 13, cell);
    tones[m.tone] = (tones[m.tone] || 0) + 1;
    kinds[m.kind] = (kinds[m.kind] || 0) + 1;
    totalTurns += m.turns;
    if (m.shots > 0) shotMatches++;
    shots += m.shots; xgSum += m.xgSum;
    if (m.maxPhase >= 2) finalThird++;
    restarts += m.restarts;
    for (const [k, v] of Object.entries(m.actions)) globalActions[k] = (globalActions[k] || 0) + v;
    if (m.tone === 'timeout') {
      if (m.stuckBreak) timeoutDiag.stuckBreak++; else timeoutDiag.turnCap++;
      if (m.lastReject) timeoutDiag.rejects[m.lastReject] = (timeoutDiag.rejects[m.lastReject] || 0) + 1;
      const es = `${cell} phase=${m.endPhase} decision=${m.endDecision} turns=${m.turns}`;
      timeoutDiag.endStates[es] = (timeoutDiag.endStates[es] || 0) + 1;
    }
  }
  rows.push({
    cell, scheme: `${sc.scheme}/${sc.intensity}/${sc.compactness}`,
    goal: pct(tones.goal, N), near: pct(tones.near, N), fail: pct(tones.fail, N), timeout: pct(tones.timeout, N),
    avgTurns: (totalTurns / N).toFixed(1),
    ftReach: pct(finalThird, N), shotRate: pct(shotMatches, N),
    avgXg: shots ? (xgSum / shots).toFixed(2) : '-',
    conceded: pct(kinds.conceded ?? 0, N),
    kinds,
  });
}

console.log('셀    스킴                    goal%  near%  fail%  t.o.%  평균턴  FT도달%  슛경기%  평균xG  실점%');
for (const r of rows) {
  console.log(`${r.cell.padEnd(5)} ${r.scheme.padEnd(23)} ${String(r.goal).padStart(5)}  ${String(r.near).padStart(5)}  ${String(r.fail).padStart(5)}  ${String(r.timeout).padStart(5)}  ${String(r.avgTurns).padStart(5)}  ${String(r.ftReach).padStart(6)}  ${String(r.shotRate).padStart(6)}  ${String(r.avgXg).padStart(5)}  ${String(r.conceded).padStart(5)}`);
}

console.log('\n[종결 종류 분포(셀 합산)]');
const kindTotals = {};
for (const r of rows) for (const [k, v] of Object.entries(r.kinds)) kindTotals[k] = (kindTotals[k] || 0) + v;
for (const [k, v] of Object.entries(kindTotals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(5)}  ${pct(v, N * CELLS.length)}%`);
}

console.log('\n[전체 액션 빈도]');
const totalActs = Object.values(globalActions).reduce((a, b) => a + b, 0) || 1;
for (const [k, v] of Object.entries(globalActions).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(6)}  ${pct(v, totalActs)}%`);
}

console.log('\n[타임아웃 원인 진단]');
console.log(`  stuck-break(연속 실패/거부 5회) ${timeoutDiag.stuckBreak} · turn-cap(60턴 소진) ${timeoutDiag.turnCap}`);
console.log('  타임아웃 직전 마지막 거부/실패 사유 TOP:');
for (const [k, v] of Object.entries(timeoutDiag.rejects).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    ${String(v).padStart(4)} × ${k}`);
}
console.log('  타임아웃 시점 상태 샘플 TOP:');
for (const [k, v] of Object.entries(timeoutDiag.endStates).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    ${String(v).padStart(4)} × ${k}`);
}
console.log('\n완료.');
