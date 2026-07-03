// probe5-attack-gauge-econ — 4R 플랜 B(게이지 경제 재조정) 이후 건강성 검증.
// 변경분: 라인브레이크 유출 -6→-3, pass_space 유출 -2→0, 자연 상승 +2/액션.
// 문서(duel-round4-plan.md) 자체 보고 수치: 중앙값 2→8→12-14, 베이트 0.00→1.63/경기.
//
// 여기서 새로 재는 것:
// (1) 게이지 밴드가 상대 커밋 확률 배수((0.6 + pressure/100*0.8), press.js decide())를
//     과열시키는가 — 배수 분포 + 배수>1.0(과압박권) 비중.
// (2) "창 생성"(committer full_commit → real window open) 빈도와 "창 실사용"
//     (windowUseCheck→facts.windowsUsed) 비율 — 밴드가 만든 창이 실제로 쓰이는가.
// (3) 베이트 1.63/경기가 mods.js의 isolation 정산 보너스 게이트
//     (baits>=2 && switches>=1) 를 실제로 발동시키는 빈도.
//
// 실행: node scripts/probe5-attack-gauge-econ.mjs [경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 400);
const CELLS = ['A1', 'A2', 'B1', 'B2'];
const TURN_CAP = 60;

function quantile(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function commitMul(pressure) { return 0.6 + (pressure / 100) * 0.8; }

function sameWindow(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.committerId === b.committerId && a.expiresTurn === b.expiresTurn && a.x === b.x && a.y === b.y;
}

function playMatch(seed, cell, agg) {
  const engine = createEngine(getScenario(cell), seed);
  let turns = 0, stuck = 0;
  let windowsCreated = 0;
  let prevWindow = null;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }

    // 결정 시점 게이지 관측 (우리 소유, 상황창 아닐 때만 — 실제 빌드업 국면).
    if (engine.state.holderId && engine.holder?.()?.side === 'us' && !engine.state.matchDecision) {
      const p = engine.state.pressure;
      agg.pressureSamples.push(p);
      const mul = commitMul(p);
      agg.mulSamples.push(mul);
      if (mul > 1.0) agg.mulOverOne++;
      agg.mulTotal++;
    }

    const r = executePolicyAction(engine, action);
    settle(engine);

    // 창 생성 감지: dispatch 직후 state.rewardWindow 가 real 이고 이전과 다른 객체면 신규.
    const w = engine.state.rewardWindow;
    if (w && w.kind === 'real' && !sameWindow(w, prevWindow)) windowsCreated++;
    prevWindow = w;

    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  const f = engine.state.facts;
  return {
    tone: o?.tone ?? 'timeout', turns,
    windowsCreated, windowsUsed: f.windowsUsed ?? 0,
    baits: f.baits ?? 0, switches: f.switches ?? 0, linesBroken: f.linesBroken ?? 0,
    endPressure: engine.state.pressure,
  };
}

console.log(`=== 게이지 경제 건강성 프로브 (4R 플랜 B) — 4셀 × ${N}경기 ===\n`);

const agg = { pressureSamples: [], mulSamples: [], mulOverOne: 0, mulTotal: 0 };
const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
let totWindowsCreated = 0, totWindowsUsed = 0, totBaits = 0, totSwitches = 0, totLines = 0;
let isolationGateHits = 0;
let baitsGe2 = 0, switchesGe1 = 0;
let endPressureSum = 0;
const matches = N * CELLS.length;

for (const cell of CELLS) {
  for (let i = 0; i < N; i++) {
    const m = playMatch(i * 7 + 13, cell, agg);
    tones[m.tone] = (tones[m.tone] || 0) + 1;
    totWindowsCreated += m.windowsCreated;
    totWindowsUsed += m.windowsUsed;
    totBaits += m.baits;
    totSwitches += m.switches;
    totLines += m.linesBroken;
    endPressureSum += m.endPressure;
    if (m.baits >= 2) baitsGe2++;
    if (m.switches >= 1) switchesGe1++;
    if (m.baits >= 2 && m.switches >= 1) isolationGateHits++;
  }
}

const p = (a, b) => (b ? (a / b * 100).toFixed(1) : '0');

console.log('[게이지 분포 — 결정 시점 표본 (matchDecision 아닌 순간, 우리 소유)]');
console.log(`  표본 수 ${agg.pressureSamples.length}`);
console.log(`  중앙값 ${quantile(agg.pressureSamples, 0.5).toFixed(1)}  p10 ${quantile(agg.pressureSamples, 0.1).toFixed(1)}  p90 ${quantile(agg.pressureSamples, 0.9).toFixed(1)}  최대 ${Math.max(...agg.pressureSamples).toFixed(0)}`);
console.log(`  경기 종료 시 평균 게이지 ${(endPressureSum / matches).toFixed(1)}`);

console.log('\n[상대 커밋 확률 배수 (0.6 + pressure/100*0.8) — press.js decide()]');
console.log(`  평균 배수 ${(agg.mulSamples.reduce((a, b) => a + b, 0) / agg.mulSamples.length).toFixed(3)} (밴드 0.6~1.4)`);
console.log(`  배수 > 1.0 (게이지 50 초과, 과압박권) 비중: ${p(agg.mulOverOne, agg.mulTotal)}%`);
console.log(`  배수 중앙값 ${quantile(agg.mulSamples, 0.5).toFixed(3)}  p90 ${quantile(agg.mulSamples, 0.9).toFixed(3)}`);

console.log('\n[창(window) 생성 vs 실사용]');
console.log(`  경기당 창 생성 ${(totWindowsCreated / matches).toFixed(2)}  경기당 실사용(windowsUsed) ${(totWindowsUsed / matches).toFixed(2)}`);
console.log(`  창 실사용률(사용/생성) ${p(totWindowsUsed, totWindowsCreated)}%`);

console.log('\n[베이트·isolation 정산 보너스 게이트 (mods.js: baits>=2 && switches>=1)]');
console.log(`  경기당 베이트 ${(totBaits / matches).toFixed(2)}  경기당 스위치 ${(totSwitches / matches).toFixed(2)}  경기당 라인브레이크 ${(totLines / matches).toFixed(2)}`);
console.log(`  baits>=2 인 경기 비율: ${p(baitsGe2, matches)}%`);
console.log(`  switches>=1 인 경기 비율: ${p(switchesGe1, matches)}%`);
console.log(`  게이트 실발동(baits>=2 && switches>=1) 비율: ${p(isolationGateHits, matches)}% (${isolationGateHits}/${matches})`);

console.log('\n[결과 분포]');
for (const t of ['goal', 'near', 'fail', 'timeout']) {
  if (tones[t]) console.log(`  ${t.padEnd(8)} ${p(tones[t], matches)}%`);
}

console.log('\n[진단]');
const flags = [];
const overOnePct = Number(p(agg.mulOverOne, agg.mulTotal));
if (overOnePct > 40) flags.push(`배수>1.0 비중 ${overOnePct}% — 게이지 밴드가 상대를 상시 과압박권에 두는 신호(과열 후보)`);
const useRate = Number(p(totWindowsUsed, totWindowsCreated));
if (useRate < 30) flags.push(`창 실사용률 ${useRate}% — 생성된 창의 대부분이 낭비(정책이 못 쓰거나 창이 너무 짧음/멀다)`);
if (isolationGateHits === 0) flags.push('isolation 게이트 0회 발동 — 베이트 1.63/경기 평균이 있어도 매치당 분산이 뭉치면 여전히 사문');
else if (Number(p(isolationGateHits, matches)) < 5) flags.push(`isolation 게이트 발동률 ${p(isolationGateHits, matches)}% — 사문 해제는 됐으나 희귀 이벤트(연쇄조건 baits>=2 AND switches>=1 이 병목)`);
if (switchesGe1 > 0 && baitsGe2 > 0 && isolationGateHits < Math.min(baitsGe2, switchesGe1) * 0.3) {
  flags.push('baits>=2 경기와 switches>=1 경기의 교집합이 개별 발생률보다 훨씬 작음 — 두 조건이 같은 경기에 잘 안 겹침(독립에 가까움)');
}
if (flags.length === 0) console.log('  뚜렷한 이상 신호 없음.');
else for (const f of flags) console.log(`  ⚠ ${f}`);

console.log('\n완료.');
