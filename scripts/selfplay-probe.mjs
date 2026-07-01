// Phase 0 자기대국 프로브 — docs/symmetric-duel-design.md.
//
// AI 정책으로 빌드업을 자동 플레이하고(공격 정책), 압박 선택 3종을 측정해(압박 프로브)
// 첫 밸런스 리포트를 낸다. 사이드 조작이 아닌 "AI가 게임을 자동으로 돌려 문제를 뱉어내는" 단계.
//
// 실행:  node scripts/selfplay-probe.mjs [경기수]
// 주의:  샌드박스 마운트가 engine.js 를 잘라 여기선 못 돌린다 → 로컬에서 실행.

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle, buildPressDecisionTrace } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 300);
const CELLS = ['A1', 'A2', 'B1', 'B2'];
const TURN_CAP = 60;

// 한 경기(한 점유 시도) 자동 플레이 → tone(goal/near/fail) + 액션 빈도.
function playMatch(seed, cell) {
  const engine = createEngine(getScenario(cell), seed);
  const actions = {};
  const pressTraces = [];
  let turns = 0;
  let stuck = 0;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = aiPolicy(view);
    if (action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const trace = buildPressDecisionTrace(view, action);
    if (trace) pressTraces.push(trace);
    const key = action.actionId || action.choiceId || action.kind;
    actions[key] = (actions[key] || 0) + 1;
    const r = executePolicyAction(engine, action);
    settle(engine);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else { stuck = 0; }
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  return { tone: o?.tone ?? 'timeout', kind: o?.kind ?? 'timeout', turns, actions, pressTraces };
}

// 압박 프로브 — 각 선택지의 실제 성공률을 측정(정책 선택이 아니라 3종 모두 측정).
// "압박이 항상 +EV 인가?" 라는 밸런스 질문에 직접 답한다.
function pressProbe(trials) {
  const tally = { dp_press: { win: 0, n: 0 }, dp_cut: { win: 0, n: 0 }, dp_drop: { reset: 0, n: 0 } };
  for (let i = 0; i < trials; i++) {
    for (const choice of ['dp_press', 'dp_cut', 'dp_drop']) {
      const e = createEngine(getScenario('A1'), 100000 + i);
      if (!e.openPressingMode().ok) continue;
      const r = e.chooseSituationOption(choice);
      tally[choice].n++;
      if (choice === 'dp_drop') { if (r.recovered === false && e.state.status === 'live') tally.dp_drop.reset++; }
      else if (r.recovered) tally[choice].win++;
    }
  }
  return tally;
}

function policyPressTraceProbe(trials) {
  const totals = makePressTraceTotals();
  for (let i = 0; i < trials; i++) {
    const e = createEngine(getScenario('A1'), 200000 + i);
    if (!e.openPressingMode().ok) continue;
    const view = buildPolicyView(e, 'us');
    const action = aiPolicy(view);
    const trace = buildPressDecisionTrace(view, action);
    if (trace) addPressTrace(totals, trace);
  }
  return totals;
}

function pctOf(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : 0; }

function makePressTraceTotals() {
  return {
    n: 0,
    choices: {},
    reasons: {},
    lanes: { best: { risk: 0, n: 0 }, gamble: { risk: 0, n: 0 }, trap: { risk: 0, n: 0 } },
    samples: [],
  };
}

function addPressTrace(totals, trace) {
  totals.n++;
  totals.choices[trace.choiceId] = (totals.choices[trace.choiceId] || 0) + 1;
  if (trace.reason) totals.reasons[trace.reason] = (totals.reasons[trace.reason] || 0) + 1;
  for (const key of ['best', 'gamble', 'trap']) {
    const lane = trace[key];
    if (!lane) continue;
    totals.lanes[key].risk += lane.risk;
    totals.lanes[key].n++;
  }
  if (totals.samples.length < 3) totals.samples.push(trace);
}

function avgLane(lane) { return lane.n ? (lane.risk / lane.n).toFixed(2) : '-'; }

// ── 실행 ──────────────────────────────────────────────────────────
console.log(`=== 자기대국 프로브 (Phase 0) — ${N}경기 ===\n`);

const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
const actionTotals = {};
const pressTraceTotals = makePressTraceTotals();
let totalTurns = 0;
for (let i = 0; i < N; i++) {
  const cell = CELLS[i % CELLS.length];
  const m = playMatch(i * 7 + 13, cell);
  tones[m.tone] = (tones[m.tone] || 0) + 1;
  totalTurns += m.turns;
  for (const [k, v] of Object.entries(m.actions)) actionTotals[k] = (actionTotals[k] || 0) + v;
  for (const trace of m.pressTraces) addPressTrace(pressTraceTotals, trace);
}

console.log('[결과 분포] (한 점유 시도의 마무리)');
for (const t of ['goal', 'near', 'fail', 'timeout']) {
  if (tones[t]) console.log(`  ${t.padEnd(8)} ${String(tones[t]).padStart(4)}  ${pctOf(tones[t], N)}%`);
}
console.log(`  평균 턴 ${(totalTurns / N).toFixed(1)}`);

console.log('\n[액션 빈도]');
const totalActions = Object.values(actionTotals).reduce((a, b) => a + b, 0) || 1;
const sortedActions = Object.entries(actionTotals).sort((a, b) => b[1] - a[1]);
for (const [k, v] of sortedActions) console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)}  ${pctOf(v, totalActions)}%`);

console.log('\n[압박 vs 탈압박 AI 의견]');
const displayedPressTraceTotals = pressTraceTotals.n
  ? pressTraceTotals
  : policyPressTraceProbe(Math.min(2000, N * 6));
if (!pressTraceTotals.n && displayedPressTraceTotals.n) console.log('  자동 경기 중 판단 없음 — 압박 정책 프로브로 산출');
if (!displayedPressTraceTotals.n) {
  console.log('  defensive_press 정책 판단 없음');
} else {
  console.log(`  판단 수 ${displayedPressTraceTotals.n}`);
  for (const [k, v] of Object.entries(displayedPressTraceTotals.choices).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(8)} ${String(v).padStart(4)}  ${pctOf(v, displayedPressTraceTotals.n)}%`);
  }
  console.log(`  평균 위험도 best ${avgLane(displayedPressTraceTotals.lanes.best)} · gamble ${avgLane(displayedPressTraceTotals.lanes.gamble)} · trap ${avgLane(displayedPressTraceTotals.lanes.trap)}`);
  const topReasons = Object.entries(displayedPressTraceTotals.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [reason, count] of topReasons) console.log(`  이유 ${count}회 · ${reason}`);
  for (const sample of displayedPressTraceTotals.samples) {
    const best = sample.best ? `${sample.best.label ?? sample.best.targetId} r${sample.best.risk}` : 'none';
    const trap = sample.trap ? `${sample.trap.label ?? sample.trap.targetId} r${sample.trap.risk}` : 'none';
    console.log(`  샘플 ${sample.choiceId} · ${sample.holderAssumption} · best ${best} · trap ${trap}`);
    console.log(`    압박 AI: ${sample.pressingOpinion}`);
    console.log(`    탈압박 AI: ${sample.buildUpOpinion}`);
  }
}

console.log('\n[압박 프로브] (각 선택지 1만 표본 미만)');
const pp = pressProbe(Math.min(2000, N * 6));
console.log(`  강하게 압박  성공 ${pctOf(pp.dp_press.win, pp.dp_press.n)}%  (n=${pp.dp_press.n})`);
console.log(`  패스길 차단  성공 ${pctOf(pp.dp_cut.win, pp.dp_cut.n)}%  (n=${pp.dp_cut.n})`);
console.log(`  블록 후퇴    리셋 ${pctOf(pp.dp_drop.reset, pp.dp_drop.n)}%  (n=${pp.dp_drop.n})`);

// ── 자동 진단(문제·개선점 후보) ──────────────────────────────────
console.log('\n[진단]');
const flags = [];
const topAction = sortedActions[0];
if (topAction && pctOf(topAction[1], totalActions) > 60) flags.push(`단조: '${topAction[0]}' 이 액션의 ${pctOf(topAction[1], totalActions)}% 차지 — 다양성 부족`);
if (pctOf(tones.goal, N) < 5) flags.push(`득점률 ${pctOf(tones.goal, N)}% — 너무 낮음(공격 정책 약하거나 난이도 과함)`);
if (pctOf(tones.goal, N) > 75) flags.push(`득점률 ${pctOf(tones.goal, N)}% — 너무 높음(난이도 과소)`);
if (pctOf(tones.timeout, N) > 15) flags.push(`타임아웃 ${pctOf(tones.timeout, N)}% — 정책이 결말을 못 내고 맴돎`);
const pressWin = pctOf(pp.dp_press.win, pp.dp_press.n);
const cutWin = pctOf(pp.dp_cut.win, pp.dp_cut.n);
if (pressWin > 70) flags.push(`강한 압박 성공 ${pressWin}% — 거의 항상 +EV면 압박 선택이 단조로워짐`);
if (Math.abs(pressWin - cutWin) < 4) flags.push(`강압(${pressWin}%)과 차단(${cutWin}%) 차이가 작음 — 두 선택의 트레이드오프가 약함`);
if (displayedPressTraceTotals.n) {
  const pressChoiceCounts = Object.values(displayedPressTraceTotals.choices);
  const maxPressChoice = pressChoiceCounts.length ? Math.max(...pressChoiceCounts) : 0;
  const maxPressChoiceShare = pctOf(maxPressChoice, displayedPressTraceTotals.n);
  if (maxPressChoiceShare > 85) flags.push(`압박 정책 의견 ${maxPressChoiceShare}%가 한 선택에 집중 — 실제 선택 분포 튜닝 필요`);
}
if (flags.length === 0) console.log('  뚜렷한 degenerate 신호 없음 — 표본을 늘려 재확인 권장.');
else for (const f of flags) console.log(`  ⚠ ${f}`);

console.log('\n참고: 대칭 미러전 50:50 불변식은 양방향 소유(Phase 2)부터 측정 가능.');
console.log('완료.');
