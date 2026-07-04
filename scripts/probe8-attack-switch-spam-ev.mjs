// probe8-attack-switch-spam-ev — 8R 항목 2: switch/isolation. switchBonus(engine.js
// scanOptions, |Δy|>16 게이트) + 연속 스위치 쿨다운(state.lastWasSwitch → ×0.5) +
// evaluator.js repeatedActionPenalty(같은 액션 문자열 'pass_space' 최근 5턴 내 누적,
// 최대 -0.28)가 겹쳐 있다. 6R은 "빈도/엔트로피"를 쟀다 — 이번엔 "EV가 실제로 죽는가":
// 스위치를 강제로 매턴 선호하는 정책이 일반 aiPolicy보다 유의미하게 더 득점하면
// (좌우 흔들기 스팸이 진짜 최적) 익스플로잇이고, 득점이 같거나 낮으면 병목이 여전하다는 뜻.
//
// 방법:
//   (1) 전체 자기대국 비교 — baseline aiPolicy vs "스위치 탐욕" 정책(스위치 자격
//       후보(|Δy|>16, risk<0.5)가 있으면 evaluator net과 무관하게 그것부터 선택,
//       없으면 baseline으로 폴백) — 10셀 × N경기, tone 분포 비교.
//   (2) 결정적 연속-스위치 추적 — 매턴 왕복 스위치가 가능하게 좌우로 위치를 되돌리는
//       인위적 루프에서 evaluator net(스위치 후보 vs 최선 비-스위치 후보)이 턴을
//       거듭할수록 어떻게 변하는지(억제되는지, 계속 이기는지) 원시 수치로 관찰.
//
// 실행: node scripts/probe8-attack-switch-spam-ev.mjs [경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { evaluateBoard } from '../js/engine/evaluator.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { PITCH_W } from '../js/data/pitch.js';

const N = Number(process.argv[2] ?? 400);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;
const SWITCH_GATE = 16;

// "스위치 탐욕" 정책 — 상황(situation)이 열려 있으면 baseline과 동일(압박/5택은
// 손대지 않는다 — 이건 순수 공격 액션 선택 실험). 그 외엔 candidates 중 스위치
// 자격(|Δy|>16, risk<0.5)이 있는 pass_space 를 evaluator net과 무관하게 최우선.
function switchGreedyPolicy(view) {
  if (view.situation) return aiPolicy(view);
  if (view.baited) return aiPolicy(view); // 유인 창은 그대로 release
  const cands = view.boardRead?.candidates ?? [];
  const holderY = view.boardRead?.holder?.y;
  const switchCand = cands.find((c) => c.action === 'pass_space' && c.risk < 0.5
    && holderY != null && Math.abs((c.target?.y ?? holderY) - holderY) > SWITCH_GATE);
  if (switchCand) {
    return { kind: 'engine_action', actionId: 'pass_space', point: { x: Math.min((switchCand.target?.x ?? 0) + 10, PITCH_W - 2), y: switchCand.target?.y }, confidence: switchCand.safety, reason: 'forced switch (probe)' };
  }
  return aiPolicy(view);
}

function playMatch(seed, cell, policyFn) {
  const engine = createEngine(getScenario(cell), seed);
  let turns = 0, stuck = 0;
  let switchCount = 0;
  let lastWasSwitchLocal = false;
  let consecutiveSwitches = 0, maxConsecutive = 0;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = policyFn(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const key = action.actionId || action.choiceId || action.kind;
    const before = engine.state.facts.switches;
    const r = executePolicyAction(engine, action);
    settle(engine);
    const triggered = engine.state.facts.switches > before;
    if (triggered) {
      switchCount++;
      consecutiveSwitches = lastWasSwitchLocal ? consecutiveSwitches + 1 : 1;
      maxConsecutive = Math.max(maxConsecutive, consecutiveSwitches);
      lastWasSwitchLocal = true;
    } else if (key === 'pass_space' || key === 'to_feet') {
      lastWasSwitchLocal = false;
      consecutiveSwitches = 0;
    }
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  return { tone: o?.tone ?? 'timeout', turns, switchCount, maxConsecutive };
}

console.log(`=== 스위치 스팸 EV 프로브 — 10셀 × ${N}경기 ===\n`);
console.log('[1) 전체 자기대국: baseline aiPolicy vs 스위치-탐욕 정책]\n');

function aggregate(policyFn, label) {
  const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
  let totalSwitches = 0, totalTurns = 0, maxConsecutiveOverall = 0;
  let games = 0;
  for (const cell of CELLS) {
    for (let i = 0; i < N; i++) {
      const m = playMatch(i * 7 + 13, cell, policyFn);
      tones[m.tone] = (tones[m.tone] || 0) + 1;
      totalSwitches += m.switchCount;
      totalTurns += m.turns;
      maxConsecutiveOverall = Math.max(maxConsecutiveOverall, m.maxConsecutive);
      games++;
    }
  }
  const pct = (a) => (a / games * 100).toFixed(1);
  console.log(`  [${label}] 경기 ${games}  goal ${pct(tones.goal)}%  near ${pct(tones.near)}%  fail ${pct(tones.fail)}%  timeout ${pct(tones.timeout)}%`);
  console.log(`    경기당 평균 스위치 ${(totalSwitches / games).toFixed(2)}  경기당 평균 턴 ${(totalTurns / games).toFixed(1)}  최대 연속스위치(전체 중) ${maxConsecutiveOverall}`);
  return { tones, games, goalPct: Number(pct(tones.goal)) };
}

const baseline = aggregate(aiPolicy, 'baseline aiPolicy');
const greedy = aggregate(switchGreedyPolicy, '스위치-탐욕');

console.log(`\n  Δgoal% (탐욕-baseline) = ${(greedy.goalPct - baseline.goalPct).toFixed(1)}pt`);

console.log('\n[2) 결정적 연속-스위치 추적 — 왕복 스위치 시 evaluator net 추이]');
// A1 홀더를 좌측 넓게 배치하고 매턴 우측 윙(개방)으로 스위치 → 다음 턴 그 반대로
// 되돌리는 왕복을 4회 반복하며 evaluator net(스위치 후보 vs 최선 비-스위치 후보)을 기록.
{
  const e = createEngine(getScenario('A1'), 42);
  let g = 0; while (e.busy && g++ < 30) e.update(999);
  console.log('  턴  스위치후보net  최선비스위치net  선택   lastWasSwitch');
  for (let turn = 0; turn < 8; turn++) {
    const board = evaluateBoard(e);
    if (!board) { console.log(`  ${turn}  (보드 없음 — 소유권 상실 또는 상황 진행 중)`); break; }
    const switchC = board.candidates.filter((c) => c.action === 'pass_space')
      .find((c) => {
        const h = e.holder();
        return h && Math.abs((c.target?.y ?? h.y) - h.y) > SWITCH_GATE;
      });
    const nonSwitch = [...board.candidates].filter((c) => c !== switchC).sort((a, b) => b.net - a.net)[0];
    const switchNet = switchC ? switchC.net.toFixed(3) : 'n/a';
    const nonSwitchNet = nonSwitch ? nonSwitch.net.toFixed(3) : 'n/a';
    console.log(`  ${turn}   ${String(switchNet).padStart(8)}      ${String(nonSwitchNet).padStart(8)}       ${switchC && nonSwitch && switchC.net >= nonSwitch.net ? 'SWITCH' : 'other'}   ${e.state.lastWasSwitch}`);
    if (!switchC) break;
    const r = e.dispatch('pass_space', null, { x: Math.min((switchC.target?.x ?? 0) + 10, PITCH_W - 2), y: switchC.target?.y });
    let g2 = 0; while (e.busy && g2++ < 30) e.update(999);
    if (!r.ok || e.state.status !== 'live' || e.holder()?.side !== 'us') { console.log('  (스위치 실패 또는 소유권 이탈 — 중단)'); break; }
  }
}

console.log('\n[진단]');
const flags = [];
const delta = greedy.goalPct - baseline.goalPct;
if (delta > 3) flags.push(`스위치-탐욕 정책이 baseline보다 goal% +${delta.toFixed(1)}pt 높음 — 좌우 흔들기 스팸이 실제로 +EV 익스플로잇일 가능성`);
else if (delta < -3) flags.push(`스위치-탐욕 정책이 baseline보다 goal% ${delta.toFixed(1)}pt 낮음 — 스위치를 맹목적으로 우선하면 오히려 손해(가드가 과함이 아니라 스위치 자체가 만능이 아님)`);
else flags.push(`스위치-탐욕과 baseline의 goal% 차이 ${delta.toFixed(1)}pt — 스팸이 유의미한 이득을 주지 않음(가드가 효과적으로 억제)`);
if (flags.length === 0) console.log('  발견 없음(PASS)');
else for (const f of flags) console.log(`  - ${f}`);

console.log('\n완료.');
