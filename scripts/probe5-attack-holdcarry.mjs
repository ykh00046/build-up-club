// probe5-attack-holdcarry — hold/carry 신규(재캘리브레이션) 후보의 건강성.
// 확인 대상:
// (1) hold 후보가 evaluator.js 설계대로 "압박 ≥35 고압박 전용 니치"로만 노출되는가
//     (reward = pHat*0.5*0.49 - 0.0045*(10+3*chain) - ... > 0.02 문턱).
// (2) carry 가 "걸어서 전진" 스팸이 되지 않는가 — 연속 carry 비율(가드가 evaluator
//     안에서 최근 2액션에 carry 있으면 후보 자체를 죽이므로 이론상 0이어야 함),
//     액션 엔트로피(단조 붕괴 여부).
//
// 실행: node scripts/probe5-attack-holdcarry.mjs [경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { evaluateBoard } from '../js/engine/evaluator.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 400);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;

function entropy(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let h = 0;
  for (const v of Object.values(counts)) {
    if (!v) continue;
    const pr = v / total;
    h -= pr * Math.log2(pr);
  }
  return h;
}

function quantile(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function playMatch(seed, cell, agg) {
  const engine = createEngine(getScenario(cell), seed);
  let turns = 0, stuck = 0;
  let prevAction = null;
  let carryCarryPairs = 0, carryTotal = 0;
  const actionCounts = {};
  let holdSelected = 0, holdExposed = 0;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');

    // hold 후보 노출 관측 (매 우리측 결정 시점) — board 는 buildPolicyView 가 이미 계산.
    const board = view.boardRead;
    if (board) {
      const holdCand = board.candidates.find((c) => c.action === 'hold');
      if (holdCand) {
        holdExposed++;
        agg.holdExposurePressure.push(engine.state.pressure);
      } else {
        agg.noHoldPressure.push(engine.state.pressure);
      }
    }

    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const key = action.actionId || action.choiceId || action.kind;
    actionCounts[key] = (actionCounts[key] || 0) + 1;
    agg.globalActionCounts[key] = (agg.globalActionCounts[key] || 0) + 1;
    if (key === 'hold') holdSelected++;
    if (key === 'carry') {
      carryTotal++;
      if (prevAction === 'carry') carryCarryPairs++;
    }
    prevAction = key;

    const r = executePolicyAction(engine, action);
    settle(engine);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  return {
    tone: o?.tone ?? 'timeout', turns, actionCounts,
    holdSelected, holdExposed, carryCarryPairs, carryTotal,
    entropy: entropy(actionCounts),
  };
}

console.log(`=== hold/carry 스팸 프로브 (4R 재캘리브레이션) — 10셀 × ${N}경기 ===\n`);

const agg = { holdExposurePressure: [], noHoldPressure: [], globalActionCounts: {} };
let totHoldSelected = 0, totHoldExposed = 0, totCarryCarry = 0, totCarry = 0, totActions = 0;
let matches = 0;
const entropies = [];
const perCellHold = {};

for (const cell of CELLS) {
  let cellHoldExposed = 0, cellMatches = 0;
  for (let i = 0; i < N; i++) {
    const m = playMatch(i * 7 + 13, cell, agg);
    matches++;
    cellMatches++;
    totHoldSelected += m.holdSelected;
    totHoldExposed += m.holdExposed;
    totCarryCarry += m.carryCarryPairs;
    totCarry += m.carryTotal;
    totActions += Object.values(m.actionCounts).reduce((a, b) => a + b, 0);
    entropies.push(m.entropy);
    if (m.holdExposed > 0) cellHoldExposed++;
  }
  perCellHold[cell] = { exposedMatches: cellHoldExposed, matches: cellMatches };
}

const p = (a, b) => (b ? (a / b * 100).toFixed(1) : '0');
const minHoldPressure = agg.holdExposurePressure.length ? Math.min(...agg.holdExposurePressure) : NaN;
const maxNoHoldPressure = agg.noHoldPressure.length ? Math.max(...agg.noHoldPressure) : NaN;

console.log('[hold 후보 노출 — 압박 게이지 문턱 검증]');
console.log(`  노출 시점 수 ${totHoldExposed} / 전체 결정 시점 ${totHoldExposed + agg.noHoldPressure.length}`);
console.log(`  hold 노출 시 게이지 최소값 ${minHoldPressure.toFixed(1)} (설계 문턱: ≥35 근방이어야 함)`);
console.log(`  hold 노출 시 게이지 분포: 중앙값 ${quantile(agg.holdExposurePressure, 0.5).toFixed(1)}  p10 ${quantile(agg.holdExposurePressure, 0.1).toFixed(1)}`);
console.log(`  hold 미노출 시 게이지 최대값 ${maxNoHoldPressure.toFixed(1)}`);
console.log(`  hold 를 실제로 선택한 횟수 ${totHoldSelected} (경기당 ${(totHoldSelected / matches).toFixed(3)}, 액션 대비 ${p(totHoldSelected, totActions)}%)`);
console.log('\n  [셀별 hold 노출 경기 비율]');
for (const [cell, c] of Object.entries(perCellHold)) {
  console.log(`    ${cell}  ${p(c.exposedMatches, c.matches)}%  (${c.exposedMatches}/${c.matches})`);
}

console.log('\n[carry 스팸 검증]');
console.log(`  carry 총 선택 ${totCarry} (경기당 ${(totCarry / matches).toFixed(2)}, 액션 대비 ${p(totCarry, totActions)}%)`);
console.log(`  연속 carry→carry 쌍 ${totCarryCarry} (carry 대비 ${p(totCarryCarry, totCarry)}%, 설계상 가드로 0% 기대)`);

console.log('\n[액션 엔트로피 (경기당, bit — 액션 5종 균등이면 log2(5)=2.32)]');
console.log(`  평균 ${(entropies.reduce((a, b) => a + b, 0) / entropies.length).toFixed(2)}  중앙값 ${quantile(entropies, 0.5).toFixed(2)}  p10 ${quantile(entropies, 0.1).toFixed(2)}`);

console.log('\n[전체 액션 빈도]');
const totalActs = Object.values(agg.globalActionCounts).reduce((a, b) => a + b, 0) || 1;
for (const [k, v] of Object.entries(agg.globalActionCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(6)}  ${p(v, totalActs)}%`);
}

console.log('\n[진단]');
const flags = [];
if (minHoldPressure < 25) flags.push(`hold 노출 최소 게이지 ${minHoldPressure.toFixed(1)} — 설계 문턱(≥35 근방)보다 낮은 곳에서도 노출(니치 경계 느슨)`);
if (totCarryCarry > 0) flags.push(`연속 carry→carry ${totCarryCarry}건 발생 — 스팸 가드(최근 2액션 carry 포함 시 후보 제거)가 뚫림`);
const topAction = Object.entries(agg.globalActionCounts).sort((a, b) => b[1] - a[1])[0];
if (topAction && Number(p(topAction[1], totalActs)) > 60) flags.push(`단조: '${topAction[0]}' 이 ${p(topAction[1], totalActs)}% 차지`);
if (Number(p(totHoldSelected, totActions)) < 0.1) flags.push(`hold 실사용률 ${p(totHoldSelected, totActions)}% — 노출은 되나 실제 정책 선택은 거의 없음(니치가 후보로만 존재, EV 경쟁에서 항상 패배)`);
if (flags.length === 0) console.log('  뚜렷한 이상 신호 없음.');
else for (const f of flags) console.log(`  ⚠ ${f}`);

console.log('\n완료.');
