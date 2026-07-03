// probe6-attack-switch-entropy — 스위치 병목 해소(0e94839) 부작용 점검: 스위치가
// 스팸/과열됐는지(연속 스위치, 액션 엔트로피 붕괴) 아니면 1회/경기 근처의 건강한 빈도인지.
//
// 측정:
//   (1) 경기당 스위치 횟수 분포(0/1/2/3+)
//   (2) 연속 스위치(직전 실행 액션도 스위치를 유발했는데 이번 액션도 스위치) 비율
//   (3) 액션 타입별 빈도 + Shannon 엔트로피(비트) — 붕괴 여부
//   (4) pass_space 비중 변화 관찰용 원시 수치
//
// 실행: node scripts/probe6-attack-switch-entropy.mjs [경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 500);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;
const SWITCH_THRESHOLD = 16; // engine.js: |Δy|>16 → switches++

function playMatch(seed, cell, agg) {
  const engine = createEngine(getScenario(cell), seed);
  let turns = 0, stuck = 0;
  let switchCount = 0;
  let consecutiveSwitchPairs = 0;
  let lastWasSwitch = false;
  let anyActionCount = 0;

  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const key = action.actionId || action.choiceId || action.kind;

    const before = engine.state.facts.switches;
    const r = executePolicyAction(engine, action);
    settle(engine);
    const triggeredSwitch = engine.state.facts.switches > before;
    if (triggeredSwitch) {
      switchCount++;
      if (lastWasSwitch) consecutiveSwitchPairs++;
    }
    if (engine.state.possession === 'us' && (key === 'pass_space' || key === 'to_feet')) {
      // 스위치는 pass_space/to_feet 로만 발생 — 다른 액션(carry/shoot/dp_*)이 끼면 '연속'은 끊긴다.
      lastWasSwitch = triggeredSwitch;
    } else if (key !== 'pass_space' && key !== 'to_feet') {
      lastWasSwitch = false;
    }

    agg.actionTotals[key] = (agg.actionTotals[key] || 0) + 1;
    anyActionCount++;

    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  agg.switchDist[Math.min(switchCount, 3)] = (agg.switchDist[Math.min(switchCount, 3)] || 0) + 1;
  agg.totalSwitches += switchCount;
  agg.totalConsecutivePairs += consecutiveSwitchPairs;
  agg.totalActions += anyActionCount;
  agg.games++;
}

function shannonEntropyBits(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let h = 0;
  for (const v of Object.values(counts)) {
    if (!v) continue;
    const p = v / total;
    h -= p * Math.log2(p);
  }
  return h;
}

console.log(`=== 스위치 스팸/엔트로피 프로브 — 10셀 × ${N}경기 ===\n`);

const agg = { actionTotals: {}, switchDist: {}, totalSwitches: 0, totalConsecutivePairs: 0, totalActions: 0, games: 0 };
for (const cell of CELLS) for (let i = 0; i < N; i++) playMatch(i * 7 + 13, cell, agg);

const G = agg.games;
console.log(`경기 수 ${G}`);
console.log(`경기당 평균 스위치 ${(agg.totalSwitches / G).toFixed(2)}회`);
console.log('[스위치 횟수 분포]');
for (const k of ['0', '1', '2', '3']) {
  const label = k === '3' ? '3+' : k;
  console.log(`  ${label.padEnd(3)} ${String(agg.switchDist[k] || 0).padStart(6)}  ${((agg.switchDist[k] || 0) / G * 100).toFixed(1)}%`);
}
console.log(`\n연속 스위치(직전 pass_space/to_feet 도 스위치였는데 이번도 스위치) ${agg.totalConsecutivePairs}회`);
console.log(`  스위치 총 ${agg.totalSwitches}회 대비 ${(agg.totalConsecutivePairs / Math.max(1, agg.totalSwitches) * 100).toFixed(1)}%`);

console.log('\n[액션 빈도 + 엔트로피]');
const total = Object.values(agg.actionTotals).reduce((a, b) => a + b, 0);
const sorted = Object.entries(agg.actionTotals).sort((a, b) => b[1] - a[1]);
for (const [k, v] of sorted) console.log(`  ${k.padEnd(14)} ${String(v).padStart(6)}  ${(v / total * 100).toFixed(1)}%`);
const H = shannonEntropyBits(agg.actionTotals);
const maxH = Math.log2(sorted.length);
console.log(`\n  Shannon 엔트로피 ${H.toFixed(3)} bits (최대 ${maxH.toFixed(3)} bits, 정규화 ${(H / maxH * 100).toFixed(1)}%)`);

console.log('\n해석: 경기당 스위치가 3+로 몰리면 스팸. 연속 스위치 비율이 높으면 "스위치→스위치"로');
console.log('탁구질(과열). 엔트로피가 이전 대비 크게 떨어지면 스위치가 다른 액션을 밀어내고 단조화.');
console.log('완료.');
