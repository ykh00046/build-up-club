// probe5-attack-a1a2-diff — A1 vs A2 는 같은 scheme/intensity/compactness
// (hybrid/high/normal) 인데 goal% 편차가 크다(이전 감사: A2 26.5% vs A1 11.5%).
// scenarios.js/formations.js 를 보면 둘의 실제 차이는:
//   - buildOurs: Salida32(단일 6, 좌우 8) vs DoublePivot23(더블 피벗 6A/6B + '10')
//   - buildOpp: build433Hybrid({screen:'us-6'} 기본) vs
//     build433Hybrid({screen:'us-r8', screenLerp:0.55, stHomeX:26})
//   - press.js positionBlock 주석: "A2 는 screenLerp 0.55 → carry 시 스크리너가
//     볼 쪽으로 더 당겨져(overshoot) 타겟(10번)이 노출된다" (설계 의도, §A2 정답축)
// 이 프로브는 그 메커니즘을 셰이프/좌표 데이터로 직접 검증한다 — 추측이 아니라 실측.
//
// 실행: node scripts/probe5-attack-a1a2-diff.mjs [경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 500);
const TURN_CAP = 60;
const CELLS = ['A1', 'A2'];
const SCREEN_TARGET = { A1: 'us-6', A2: 'us-r8' }; // scenarios.js/formations.js 스크린 대상

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function openness(engine, playerId) {
  const target = engine.state.players.find((p) => p.id === playerId);
  if (!target) return null;
  let nd = Infinity;
  for (const d of engine.state.players) {
    if (d.side !== 'opp' || d.line === 'gk') continue;
    const dd = dist(d, target);
    if (dd < nd) nd = dd;
  }
  return nd;
}

function screenerId(engine) {
  // build433Hybrid 는 opp-6 를 screens 필드로 스크리너로 세운다(둘 다 opp-6가 screener).
  return 'opp-6';
}

function playMatch(seed, cell, agg) {
  const engine = createEngine(getScenario(cell), seed);
  const screenTargetId = SCREEN_TARGET[cell];
  const scId = screenerId(engine);
  let turns = 0, stuck = 0;
  let prevAction = null;
  let firstShotTurn = null;
  let goalScorerRole = null;
  const stXSamplesEarly = [];

  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;

    if (turns < 5) {
      const st = engine.state.players.find((p) => p.id === 'opp-st');
      if (st) stXSamplesEarly.push(st.x);
    }

    // 스크리너-타겟 당김 거리 + 타겟 오픈니스, 직전 액션(carry/hold/other)별로 분리.
    const scr = engine.state.players.find((p) => p.id === scId);
    const tgt = engine.state.players.find((p) => p.id === screenTargetId);
    if (scr && tgt && engine.holder?.()?.side === 'us') {
      const pull = dist(scr, tgt);
      const open = openness(engine, screenTargetId);
      const bucket = prevAction === 'carry' ? 'afterCarry' : prevAction === 'hold' ? 'afterHold' : 'other';
      agg[cell].pull[bucket].push(pull);
      agg[cell].open[bucket].push(open);
    }

    const view = buildPolicyView(engine, 'us');
    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const key = action.actionId || action.choiceId || action.kind;

    let shooterRole = null;
    if (key === 'shoot') {
      shooterRole = engine.holder?.()?.role ?? null;
      if (firstShotTurn === null) firstShotTurn = turns;
    }

    const r = executePolicyAction(engine, action);
    settle(engine);

    if (key === 'shoot' && engine.state.outcome?.tone === 'goal') goalScorerRole = shooterRole;

    prevAction = key;
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  const f = engine.state.facts;

  // 실제 real 창이 열렸을 때 커미터 역할(어느 상대가 점프했나).
  const committerId = engine.state.rewardWindow?.committerId ?? null;
  const committerRole = committerId ? engine.state.players.find((p) => p.id === committerId)?.role ?? null : null;

  return {
    tone: o?.tone ?? 'timeout', turns, firstShotTurn, goalScorerRole,
    baits: f.baits ?? 0, linesBroken: f.linesBroken ?? 0,
    stXEarlyAvg: stXSamplesEarly.length ? stXSamplesEarly.reduce((a, b) => a + b, 0) / stXSamplesEarly.length : null,
    lastCommitterRole: committerRole,
  };
}

console.log(`=== A1 vs A2 편차 원인 프로브 (같은 hybrid/high/normal 스킴) — ${N}경기/셀 ===\n`);

const perCell = {};
const agg = {
  A1: { pull: { afterCarry: [], afterHold: [], other: [] }, open: { afterCarry: [], afterHold: [], other: [] } },
  A2: { pull: { afterCarry: [], afterHold: [], other: [] }, open: { afterCarry: [], afterHold: [], other: [] } },
};

for (const cell of CELLS) {
  const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
  const scorerRoles = {};
  const committerRoles = {};
  let firstShotSum = 0, firstShotN = 0, stXSum = 0, stXN = 0, baitsSum = 0, linesSum = 0;
  for (let i = 0; i < N; i++) {
    const m = playMatch(i * 7 + 13, cell, agg);
    tones[m.tone] = (tones[m.tone] || 0) + 1;
    if (m.goalScorerRole) scorerRoles[m.goalScorerRole] = (scorerRoles[m.goalScorerRole] || 0) + 1;
    if (m.lastCommitterRole) committerRoles[m.lastCommitterRole] = (committerRoles[m.lastCommitterRole] || 0) + 1;
    if (m.firstShotTurn != null) { firstShotSum += m.firstShotTurn; firstShotN++; }
    if (m.stXEarlyAvg != null) { stXSum += m.stXEarlyAvg; stXN++; }
    baitsSum += m.baits; linesSum += m.linesBroken;
  }
  perCell[cell] = { tones, scorerRoles, committerRoles, firstShotSum, firstShotN, stXSum, stXN, baitsSum, linesSum };
}

const p = (a, b) => (b ? (a / b * 100).toFixed(1) : '0');
const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : NaN;

console.log('[결과 분포]');
console.log('셀   goal%  near%  fail%  t.o.%  평균첫슛턴  ST초기평균x(kickoff+5턴)  경기당베이트  경기당라인브레이크');
for (const cell of CELLS) {
  const r = perCell[cell];
  const matches = N;
  console.log(`${cell.padEnd(4)} ${p(r.tones.goal, matches).padStart(5)}  ${p(r.tones.near, matches).padStart(5)}  ${p(r.tones.fail, matches).padStart(5)}  ${p(r.tones.timeout, matches).padStart(5)}  ${(r.firstShotSum / (r.firstShotN || 1)).toFixed(1).padStart(9)}  ${(r.stXSum / (r.stXN || 1)).toFixed(1).padStart(22)}  ${(r.baitsSum / matches).toFixed(2).padStart(11)}  ${(r.linesSum / matches).toFixed(2).padStart(17)}`);
}

console.log('\n[골 득점자 역할 분포]');
for (const cell of CELLS) {
  console.log(`  ${cell}:`);
  const total = Object.values(perCell[cell].scorerRoles).reduce((a, b) => a + b, 0) || 1;
  for (const [role, n] of Object.entries(perCell[cell].scorerRoles).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${role.padEnd(6)} ${n}  ${p(n, total)}%`);
  }
}

console.log('\n[마지막 real 윈도우 커미터(점프한 상대 역할) 분포]');
for (const cell of CELLS) {
  console.log(`  ${cell}:`);
  const total = Object.values(perCell[cell].committerRoles).reduce((a, b) => a + b, 0) || 1;
  for (const [role, n] of Object.entries(perCell[cell].committerRoles).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${role.padEnd(6)} ${n}  ${p(n, total)}%`);
  }
}

console.log('\n[스크리너(opp-6) ↔ 스크린 타겟 당김거리 · 타겟 오픈니스(최근접 수비수 거리)]');
console.log('  A1 타겟=us-6(단일 피벗) · A2 타겟=us-r8(10번). 설계 주석: A2 screenLerp 0.55(기본 0.4)');
console.log('  → carry 직후 스크리너가 볼 쪽으로 더 당겨져 타겟이 더 오픈될 것으로 기대.');
for (const cell of CELLS) {
  console.log(`  ${cell}:`);
  for (const bucket of ['afterCarry', 'afterHold', 'other']) {
    const pull = agg[cell].pull[bucket];
    const open = agg[cell].open[bucket];
    if (!pull.length) { console.log(`    ${bucket.padEnd(10)} n=0`); continue; }
    console.log(`    ${bucket.padEnd(10)} n=${String(pull.length).padStart(5)}  당김거리 평균 ${avg(pull).toFixed(1)}  타겟오픈니스 평균 ${avg(open).toFixed(1)}`);
  }
}

console.log('\n[진단]');
const flags = [];
const goalA1 = Number(p(perCell.A1.tones.goal, N));
const goalA2 = Number(p(perCell.A2.tones.goal, N));
if (Math.abs(goalA1 - goalA2) > 8) flags.push(`goal% 편차 A1 ${goalA1}% vs A2 ${goalA2}% (Δ${(goalA2 - goalA1).toFixed(1)}pt) — 같은 scheme/intensity/compactness 라벨인데 실제 난이도 이질적`);
const stXDelta = (perCell.A2.stXSum / (perCell.A2.stXN || 1)) - (perCell.A1.stXSum / (perCell.A1.stXN || 1));
if (Math.abs(stXDelta) > 3) flags.push(`상대 ST 초기 평균 x 차이 ${stXDelta.toFixed(1)}m (A2 stHomeX=26 vs A1 기본 14) — A2가 초반부터 더 전진 배치돼 압박 개시가 빠름/느림`);
const a2CarryOpen = avg(agg.A2.open.afterCarry), a2OtherOpen = avg(agg.A2.open.other);
const a1CarryOpen = avg(agg.A1.open.afterCarry), a1OtherOpen = avg(agg.A1.open.other);
if (!Number.isNaN(a2CarryOpen) && !Number.isNaN(a2OtherOpen) && (a2CarryOpen - a2OtherOpen) > (a1CarryOpen - a1OtherOpen) + 0.5) {
  flags.push(`A2에서 carry 직후 스크린 타겟 오픈니스 상승폭(${(a2CarryOpen - a2OtherOpen).toFixed(1)}m)이 A1(${(a1CarryOpen - a1OtherOpen).toFixed(1)}m)보다 큼 — screenLerp 0.55 overshoot 설계가 실측으로 확인됨(A2 정답축 의도대로 작동)`);
}
if (flags.length === 0) console.log('  뚜렷한 이상 신호 없음 — A1/A2 편차의 원인을 셰이프 데이터로 특정 못함(표본 재확인 권장).');
else for (const f of flags) console.log(`  ⚠ ${f}`);

console.log('\n완료.');
