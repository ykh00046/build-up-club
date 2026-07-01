// Phase 2b 왕복 소유권 프로브.
//
// 옵션 경로만 사용한다:
//   us 턴오버 → opp 빌드업 반복 → 전진 출구 정체 → us 리게인.
// 아직 일반 dispatch 반전/실패 확률을 넣지 않고, 왕복 루프가 멈추지 않는지만 본다.

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

const N = Number(process.argv[2] ?? 80);
const disposition = process.argv[3] || null;
const STEP_CAP = 10;

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };

function openSyntheticTurnover(engine) {
  engine.state.transition = {
    kind: 'intercepted',
    detail: {},
    loss: { x: 42, y: 34 },
    msLeft: 5000,
    regainP: 0,
  };
  engine.state.matchDecision = {
    id: 'transition',
    choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }],
  };
}

function runCycle(seed) {
  const engine = createEngine(getScenario('A1'), seed, { possessionTurnoverLoop: true, opponentBuildDisposition: disposition });
  openSyntheticTurnover(engine);
  const turnover = engine.chooseSituationOption('cp_retreat');
  const steps = [];
  for (let i = 0; i < STEP_CAP && engine.state.possession === 'opp'; i++) {
    const step = engine.advanceOpponentBuildUp();
    steps.push(step);
    if (!step.ok || step.regained) break;
  }
  return {
    turnover,
    steps,
    finalPossession: engine.state.possession,
    finalHolderSide: engine.holder()?.side ?? null,
    finalPhase: engine.state.phase,
    status: engine.state.status,
    outcome: engine.state.outcome,
  };
}

function pctOf(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : 0; }

console.log(`=== 소유권 왕복 프로브 (Phase 2b) — ${N}회 ===\n`);

const totals = {
  turnover: 0,
  regained: 0,
  stalled: 0,
  live: 0,
  outcomes: 0,
  oppSteps: 0,
  maxSteps: 0,
};
const pathCounts = new Map();

for (let i = 0; i < N; i++) {
  const cycle = runCycle(4000 + i);
  if (cycle.turnover?.turnover?.possession === 'opp') totals.turnover++;
  if (cycle.finalPossession === 'us' && cycle.finalHolderSide === 'us') totals.regained++;
  if (cycle.steps.some((s) => s?.stalled)) totals.stalled++;
  if (cycle.status === 'live') totals.live++;
  if (cycle.outcome) totals.outcomes++;
  const okSteps = cycle.steps.filter((s) => s?.ok).length;
  totals.oppSteps += okSteps;
  totals.maxSteps = Math.max(totals.maxSteps, cycle.steps.length);
  const path = cycle.steps.map((s) => s?.ok ? `${s.fromId}->${s.targetId}` : s?.stalled ? 'stalled/regain' : 'stop').join(' | ');
  pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
}

console.log(`[왕복 결과${disposition ? ` · ${disposition}` : ''}]`);
console.log(`  턴오버 전환 ${totals.turnover}/${N} (${pctOf(totals.turnover, N)}%)`);
console.log(`  우리 리게인 ${totals.regained}/${N} (${pctOf(totals.regained, N)}%)`);
console.log(`  정체 감지   ${totals.stalled}/${N} (${pctOf(totals.stalled, N)}%)`);
console.log(`  live 유지   ${totals.live}/${N} (${pctOf(totals.live, N)}%)`);
console.log(`  outcome 발생 ${totals.outcomes}/${N} (${pctOf(totals.outcomes, N)}%)`);
console.log(`  평균 상대 전진 수 ${(totals.oppSteps / N).toFixed(1)} · 최대 루프 길이 ${totals.maxSteps}`);
console.log(`  상대 빌드업 루트 ${pathCounts.size}종`);

console.log('\n[샘플]');
for (const [path, count] of [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
  console.log(`  ${path} · ${count}회`);
}

console.log('\n[검증]');
ok(totals.turnover === N, '모든 사이클이 opp 턴오버로 시작');
ok(totals.regained === N, '모든 사이클이 우리 리게인으로 복귀');
ok(totals.stalled === N, '모든 사이클이 정체를 감지');
ok(totals.live === N && totals.outcomes === 0, '왕복 중 시도 종료 없이 live 유지');
ok(totals.maxSteps < STEP_CAP, '루프 상한 전에 종료');
ok(totals.oppSteps >= N, '각 사이클에서 상대가 최소 한 수 전진');
if (disposition && disposition !== 'safe') ok(pathCounts.size >= 2, `${disposition} 성향은 여러 상대 빌드업 루트를 만든다`);

console.log(fail === 0 ? '\n소유권 왕복 프로브 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
