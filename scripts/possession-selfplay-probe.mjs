import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy, buildPressDecisionTrace } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 120);
const disposition = process.argv[3] || 'aggressive';
const STEP_CAP = 10;

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function pctOf(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : 0; }

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

function advisoryPressRead(read) {
  const risk = Math.max(read?.best?.risk ?? 0, read?.gamble?.risk ?? 0, read?.trap?.risk ?? 0);
  const safety = read?.best?.safety ?? 0.5;
  return {
    regainP: clamp(0.28 + risk * 0.34 - safety * 0.08, 0.12, 0.72),
    cutP: clamp(0.24 + risk * 0.38, 0.1, 0.7),
  };
}

function advisoryTrace(engine) {
  const view = buildPolicyView(engine, 'us');
  if (view.possession !== 'opp' || !view.oppBuildRead) return null;
  const pressView = {
    ...view,
    pressRead: advisoryPressRead(view.oppBuildRead),
    situation: {
      id: 'defensive_press',
      choices: [
        { id: 'dp_press', label: '강하게 압박' },
        { id: 'dp_cut', label: '패스길 차단' },
        { id: 'dp_drop', label: '블록 후퇴' },
      ],
    },
  };
  const action = pressPolicy(pressView);
  return buildPressDecisionTrace(pressView, action);
}

function runCycle(seed) {
  const engine = createEngine(getScenario('A1'), seed, {
    possessionTurnoverLoop: true,
    opponentBuildDisposition: disposition,
  });
  openSyntheticTurnover(engine);
  const turnover = engine.chooseSituationOption('cp_retreat');
  const steps = [];
  const traces = [];
  for (let i = 0; i < STEP_CAP && engine.state.possession === 'opp'; i++) {
    const trace = advisoryTrace(engine);
    if (trace) traces.push(trace);
    const step = engine.advanceOpponentBuildUp();
    steps.push(step);
    if (!step.ok || step.regained) break;
  }
  return {
    turnover,
    steps,
    traces,
    finalPossession: engine.state.possession,
    finalHolderSide: engine.holder()?.side ?? null,
    status: engine.state.status,
    outcome: engine.state.outcome,
  };
}

function makeTraceTotals() {
  return {
    n: 0,
    choices: {},
    holders: {},
    lanes: { best: { risk: 0, n: 0 }, gamble: { risk: 0, n: 0 }, trap: { risk: 0, n: 0 } },
    samples: [],
  };
}

function addTrace(totals, trace) {
  totals.n++;
  totals.choices[trace.choiceId] = (totals.choices[trace.choiceId] || 0) + 1;
  if (trace.holderId) totals.holders[trace.holderId] = (totals.holders[trace.holderId] || 0) + 1;
  for (const key of ['best', 'gamble', 'trap']) {
    const lane = trace[key];
    if (!lane) continue;
    totals.lanes[key].risk += lane.risk;
    totals.lanes[key].n++;
  }
  if (totals.samples.length < 4) totals.samples.push(trace);
}

function avgLane(lane) { return lane.n ? (lane.risk / lane.n).toFixed(2) : '-'; }

console.log(`=== 소유권 자기대국 프로브 (Phase 2b) — ${N}회 · ${disposition} ===\n`);

const totals = {
  turnover: 0,
  regained: 0,
  stalled: 0,
  live: 0,
  outcomes: 0,
  oppSteps: 0,
};
const pathCounts = new Map();
const traceTotals = makeTraceTotals();

for (let i = 0; i < N; i++) {
  const cycle = runCycle(7000 + i);
  if (cycle.turnover?.turnover?.possession === 'opp') totals.turnover++;
  if (cycle.finalPossession === 'us' && cycle.finalHolderSide === 'us') totals.regained++;
  if (cycle.steps.some((s) => s?.stalled)) totals.stalled++;
  if (cycle.status === 'live') totals.live++;
  if (cycle.outcome) totals.outcomes++;
  totals.oppSteps += cycle.steps.filter((s) => s?.ok).length;
  const path = cycle.steps.map((s) => s?.ok ? `${s.fromId}->${s.targetId}` : s?.stalled ? 'stalled/regain' : 'stop').join(' | ');
  pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
  for (const trace of cycle.traces) addTrace(traceTotals, trace);
}

console.log('[왕복 루프]');
console.log(`  턴오버 전환 ${totals.turnover}/${N} (${pctOf(totals.turnover, N)}%)`);
console.log(`  우리 리게인 ${totals.regained}/${N} (${pctOf(totals.regained, N)}%)`);
console.log(`  정체 감지   ${totals.stalled}/${N} (${pctOf(totals.stalled, N)}%)`);
console.log(`  live 유지   ${totals.live}/${N} (${pctOf(totals.live, N)}%)`);
console.log(`  outcome 발생 ${totals.outcomes}/${N} (${pctOf(totals.outcomes, N)}%)`);
console.log(`  평균 상대 전진 수 ${(totals.oppSteps / N).toFixed(1)}`);
console.log(`  상대 빌드업 루트 ${pathCounts.size}종`);

console.log('\n[주요 루트]');
for (const [path, count] of [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log(`  ${path} · ${count}회`);
}

console.log('\n[압박 AI vs 탈압박 AI 의견]');
console.log(`  판단 수 ${traceTotals.n}`);
for (const [choice, count] of Object.entries(traceTotals.choices).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${choice.padEnd(8)} ${String(count).padStart(4)}  ${pctOf(count, traceTotals.n)}%`);
}
console.log(`  평균 위험도 best ${avgLane(traceTotals.lanes.best)} · gamble ${avgLane(traceTotals.lanes.gamble)} · trap ${avgLane(traceTotals.lanes.trap)}`);
const topHolders = Object.entries(traceTotals.holders).sort((a, b) => b[1] - a[1]).slice(0, 4);
for (const [holder, count] of topHolders) console.log(`  관측 holder ${holder} · ${count}회`);
for (const sample of traceTotals.samples) {
  const best = sample.best ? `${sample.best.label ?? sample.best.targetId} r${sample.best.risk}` : 'none';
  const trap = sample.trap ? `${sample.trap.label ?? sample.trap.targetId} r${sample.trap.risk}` : 'none';
  console.log(`  샘플 ${sample.choiceId} · ${sample.holderId} · best ${best} · trap ${trap}`);
  console.log(`    압박 AI: ${sample.pressingOpinion}`);
  console.log(`    탈압박 AI: ${sample.buildUpOpinion}`);
}

console.log('\n[검증]');
ok(totals.turnover === N, '모든 사이클이 opp 턴오버로 시작');
ok(totals.regained === N, '모든 사이클이 우리 리게인으로 복귀');
ok(totals.stalled === N, '모든 사이클이 정체를 감지');
ok(totals.live === N && totals.outcomes === 0, '왕복 중 시도 종료 없이 live 유지');
ok(traceTotals.n >= N, '각 사이클에서 압박/탈압박 의견을 최소 1회 기록');
ok(pathCounts.size >= 2, `${disposition} 성향은 여러 상대 빌드업 루트를 만든다`);
const choiceCounts = Object.values(traceTotals.choices);
const maxChoiceShare = choiceCounts.length ? Math.max(...choiceCounts) / traceTotals.n : 1;
ok(choiceCounts.length >= 2, '압박 AI 선택이 단일 선택으로 독식되지 않음');
ok(maxChoiceShare <= 0.85, `압박 AI 최다 선택 비중 ${Math.round(maxChoiceShare * 100)}% ≤ 85%`);

console.log(fail === 0 ? '\n소유권 자기대국 프로브 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
