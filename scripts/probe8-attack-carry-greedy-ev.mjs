// probe8-attack-carry-greedy-ev — 8R 항목 3·5: carry/hold EV 균형 + 저비용 전진
// 익스플로잇. evaluator.js buildCarryCandidate는 "최근 2액션에 carry 있으면 후보
// 자체를 죽인다"는 스팸 가드 하나만 갖고 있다(5R에 캘리브레이션). 이번엔:
//   (1) 그 가드를 우회해 "carry 가능하면 무조건 carry" 정책이 baseline보다
//       유의미하게 더 득점하는지(무비용 반복 전진이 실제 익스플로잇인지) 자기대국으로.
//   (2) carry→X→carry→X 리듬(가드가 허용하는 최소 간격)을 강제했을 때 경기당
//       carry 횟수·평균 risk·게이지 소모를 측정 — "위험 없이 반복 가능한 전진"인지.
//
// 실행: node scripts/probe8-attack-carry-greedy-ev.mjs [경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { evaluateBoard } from '../js/engine/evaluator.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 400);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;

// "carry 탐욕" 정책 — carry 후보가 candidates에 있으면(가드가 이미 최근 2액션
// 검사로 후보 자체를 죽이므로, 후보로 노출된 carry는 항상 시도) 그것부터 실행.
// 아니면 baseline. 상황(situation)·유인 창은 baseline 그대로.
function carryGreedyPolicy(view) {
  if (view.situation || view.baited) return aiPolicy(view);
  const cands = view.boardRead?.candidates ?? [];
  const carryC = cands.find((c) => c.action === 'carry');
  if (carryC && carryC.point) {
    return { kind: 'engine_action', actionId: 'carry', point: carryC.point, confidence: carryC.safety, reason: 'forced carry (probe)' };
  }
  return aiPolicy(view);
}

function playMatch(seed, cell, policyFn) {
  const engine = createEngine(getScenario(cell), seed);
  let turns = 0, stuck = 0;
  let carryCount = 0, carryRiskSum = 0;
  let pressureAtEnd = 0;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = policyFn(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    if (action.actionId === 'carry') {
      const cands = view.boardRead?.candidates ?? [];
      const c = cands.find((x) => x.action === 'carry');
      if (c) { carryCount++; carryRiskSum += c.risk; }
    }
    const r = executePolicyAction(engine, action);
    settle(engine);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  pressureAtEnd = engine.state.pressure;
  return { tone: o?.tone ?? 'timeout', turns, carryCount, carryRiskSum, pressureAtEnd };
}

console.log(`=== carry 탐욕 EV / 저비용 전진 익스플로잇 프로브 — 10셀 × ${N}경기 ===\n`);

function aggregate(policyFn, label) {
  const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
  let totalCarry = 0, totalCarryRisk = 0, totalTurns = 0, totalPressure = 0;
  let games = 0;
  for (const cell of CELLS) {
    for (let i = 0; i < N; i++) {
      const m = playMatch(i * 7 + 13, cell, policyFn);
      tones[m.tone] = (tones[m.tone] || 0) + 1;
      totalCarry += m.carryCount;
      totalCarryRisk += m.carryRiskSum;
      totalTurns += m.turns;
      totalPressure += m.pressureAtEnd;
      games++;
    }
  }
  const pct = (a) => (a / games * 100).toFixed(1);
  console.log(`  [${label}] 경기 ${games}  goal ${pct(tones.goal)}%  near ${pct(tones.near)}%  fail ${pct(tones.fail)}%  timeout ${pct(tones.timeout)}%`);
  console.log(`    경기당 평균 carry ${(totalCarry / games).toFixed(2)}회  carry 평균 risk ${(totalCarryRisk / Math.max(1, totalCarry)).toFixed(3)}  경기당 평균 턴 ${(totalTurns / games).toFixed(1)}  종료시 평균 게이지 ${(totalPressure / games).toFixed(1)}`);
  return { tones, games, goalPct: Number(pct(tones.goal)), avgCarry: totalCarry / games, avgCarryRisk: totalCarryRisk / Math.max(1, totalCarry) };
}

const baseline = aggregate(aiPolicy, 'baseline aiPolicy');
const greedy = aggregate(carryGreedyPolicy, 'carry-탐욕');

console.log(`\n  Δgoal% (탐욕-baseline) = ${(greedy.goalPct - baseline.goalPct).toFixed(1)}pt`);
console.log(`  경기당 carry 횟수 baseline ${baseline.avgCarry.toFixed(2)} → 탐욕 ${greedy.avgCarry.toFixed(2)} (배수 ${(greedy.avgCarry / Math.max(0.01, baseline.avgCarry)).toFixed(1)}x)`);

// ── 근본 원인 진단 — baseline이 carry 후보를 "왜" 덜 고르는지: carry가 있는
// 결정 시점마다 baseline이 실제로 무엇을 골랐고, carry.net 대비 얼마나 차이났는지.
console.log('\n[근본 원인 진단 — baseline이 carry 후보를 지나칠 때 net/risk 격차]');
{
  let decisionsWithCarry = 0, carryChosen = 0;
  let netGapSum = 0, netGapN = 0;
  let riskGapSum = 0;
  for (const cell of CELLS) {
    for (let i = 0; i < Math.min(40, N); i++) {
      const engine = createEngine(getScenario(cell), i * 7 + 13);
      let turns = 0, stuck = 0;
      while (engine.state.status === 'live' && turns < TURN_CAP) {
        settle(engine);
        if (engine.state.status !== 'live') break;
        const board = evaluateBoard(engine);
        const carryC = board?.candidates?.find((c) => c.action === 'carry');
        const view = buildPolicyView(engine, 'us');
        const action = aiPolicy(view);
        if (carryC && !view.situation && !view.baited) {
          decisionsWithCarry++;
          if (action.actionId === 'carry') carryChosen++;
          else {
            const chosenNet = board.candidates.find((c) => c.action === action.actionId
              && (action.actionId !== 'pass_space' || Math.abs((c.target?.x ?? 0) + 10 - (action.point?.x ?? 0)) < 1))?.net ?? board.best?.net;
            if (chosenNet != null) { netGapSum += (chosenNet - carryC.net); netGapN++; riskGapSum += ((board.candidates.find((c) => c.action === action.actionId)?.risk ?? 0) - carryC.risk); }
          }
        }
        if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
        const r = executePolicyAction(engine, action);
        settle(engine);
        if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
        turns++;
      }
    }
  }
  console.log(`  carry 후보 존재 결정 시점 ${decisionsWithCarry}회, baseline이 실제 carry 선택 ${carryChosen}회 (${(carryChosen / Math.max(1, decisionsWithCarry) * 100).toFixed(1)}%)`);
  console.log(`  carry 미선택시 (선택된 액션.net − carry.net) 평균 ${(netGapSum / Math.max(1, netGapN)).toFixed(3)} (양수면 선택된 게 net상 더 나음, 그런데도 실측 goal%는 carry 우선이 더 높다는 게 위 결과)`);
  console.log(`  carry 미선택시 (선택된 액션.risk − carry.risk) 평균 ${(riskGapSum / Math.max(1, netGapN)).toFixed(3)} (양수면 선택된 쪽이 carry보다 더 위험했다는 뜻)`);
}

console.log('\n[진단]');
const flags = [];
const delta = greedy.goalPct - baseline.goalPct;
if (delta > 3) flags.push(`carry-탐욕 정책이 baseline보다 goal% +${delta.toFixed(1)}pt — carry가 위험 대비 과대평가돼 스팸이 +EV 익스플로잇일 가능성 (carry 평균 risk ${greedy.avgCarryRisk.toFixed(3)})`);
else if (delta < -3) flags.push(`carry-탐욕이 baseline보다 goal% ${delta.toFixed(1)}pt 낮음 — carry를 맹목적으로 우선하면 손해(스팸 가드+carry 자체의 낮은 절대보상이 효과적으로 억제)`);
else flags.push(`carry-탐욕과 baseline의 goal% 차이 ${delta.toFixed(1)}pt — carry를 무비용 반복 전진 도구로 남용해도 유의미한 이득 없음`);
if (greedy.avgCarry / Math.max(0.01, baseline.avgCarry) > 5 && Math.abs(delta) < 3) {
  flags.push(`carry 빈도는 ${(greedy.avgCarry / Math.max(0.01, baseline.avgCarry)).toFixed(1)}배로 폭증했는데 goal%는 거의 그대로 — carry가 "많이 써도 결과에 무해"한 중립 액션(EV가 낮게 눌려 있어 스팸해도 안 이기지만 손해도 안 봄)`);
}
if (flags.length === 0) console.log('  발견 없음(PASS)');
else for (const f of flags) console.log(`  - ${f}`);

console.log('\n완료.');
