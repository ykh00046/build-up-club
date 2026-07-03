// probe6-attack-isolation-scoreline — isolation 정산 보너스(mods.js resolveScoreline:
// baits>=2 && switches>=1 → execRaw +0.08)가 스위치 게이트 실발동률 11%→31%로 오른
// 뒤에도 스코어라인을 과하게 밀지 않는지 실측 정량화.
//
// 방법: 실제 aiPolicy 자기대국으로 진짜 facts(baits/linesBroken/switches/...)+tone+xg를
// 모으고, 같은 시드 쌍(paired RNG)으로 resolveScoreline을 두 변형에 돌린다.
//   A: 실측 perf 그대로 (isolation 자연 발동 포함)
//   B: perf.switches=0 (스위치 직접항 0.08·switches + isolation 게이트 모두 제거)
// A-B 델타 = "이 경기에 스위치가 1회 이상 있었다"의 전체 스코어라인 효과(직접항+isolation).
// 추가로 isolation 게이트만 따로(직접항은 보존) 끄는 근사 변형 C도 병기(baits를 1로 캡).
//
// 실행: node scripts/probe6-attack-isolation-scoreline.mjs [경기수/셀]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import * as Club from '../js/career/club.js';
import { matchSetup, resolveScoreline } from '../js/career/mods.js';

const N = Number(process.argv[2] ?? 300);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playMatch(seed, cell) {
  const engine = createEngine(getScenario(cell), seed);
  let turns = 0, stuck = 0;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const r = executePolicyAction(engine, action);
    settle(engine);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  const f = engine.state.facts || {};
  return {
    tone: o?.tone ?? 'fail',
    baits: f.baits ?? 0, linesBroken: f.linesBroken ?? 0, switches: f.switches ?? 0,
    runs: f.runs ?? 0, windowsUsed: f.windowsUsed ?? 0,
    situationsResolved: f.situationsResolved ?? 0, decisionsMade: f.decisionsMade ?? 0,
    xg: o?.xg ?? 0,
  };
}

console.log(`=== isolation 정산 보너스 스코어라인 왜곡 프로브 — 10셀 × ${N}경기 ===\n`);

// 1) 실측 facts 수집.
const perfs = [];
for (const cell of CELLS) for (let i = 0; i < N; i++) perfs.push(playMatch(i * 7 + 13, cell));

const isolationEligible = perfs.filter((p) => p.baits >= 2 && p.switches >= 1);
console.log(`실측 경기 ${perfs.length} | isolation 게이트(baits>=2 && switches>=1) 발동 ${isolationEligible.length} (${(isolationEligible.length / perfs.length * 100).toFixed(1)}%)`);
console.log(`(참고: 0e94839 감사 수치는 11%→31.3% — 이 실측치와 비교용)\n`);

// 2) 대표 셋업 3종(약체/균형/강체 상대) — Club 상태 리셋 후 매치셋업 산출.
Club.hardReset();
const setups = {
  weakOpp: matchSetup(80),
  midOpp: matchSetup(200),
  strongOpp: matchSetup(340),
};

function runVariant(perfList, setupLabel, mutate, seedBase) {
  const setup = setups[setupLabel];
  let goalsSum = 0, n = 0;
  for (let i = 0; i < perfList.length; i++) {
    const base = perfList[i];
    const perf = mutate ? mutate({ ...base }) : { ...base };
    const rng = mulberry32(seedBase + i);
    const score = resolveScoreline(perf, setup, rng);
    goalsSum += score.ourGoals;
    n++;
  }
  return goalsSum / n;
}

console.log('[대표 상대별 A(실측) vs B(switches=0, 직접항+isolation 모두 제거) vs C(baits만 캡해 isolation만 제거)]');
console.log('상대       A평균득점  B평균득점  Δ(A-B) 전체효과  C평균득점  Δ(A-C)≈isolation단독');
for (const label of ['weakOpp', 'midOpp', 'strongOpp']) {
  const seedBase = 5000 + (label === 'weakOpp' ? 0 : label === 'midOpp' ? 100000 : 200000);
  const avgA = runVariant(perfs, label, null, seedBase);
  const avgB = runVariant(perfs, label, (p) => { p.switches = 0; return p; }, seedBase);
  const avgC = runVariant(perfs, label, (p) => { if (p.baits >= 2) p.baits = 1; return p; }, seedBase);
  console.log(`${label.padEnd(10)} ${avgA.toFixed(3).padStart(9)}  ${avgB.toFixed(3).padStart(9)}  ${(avgA - avgB).toFixed(3).padStart(9)}         ${avgC.toFixed(3).padStart(9)}  ${(avgA - avgC).toFixed(3)}`);
}

// 3) isolation-eligible 부분집합만 따로 — "이 게이트가 실제로 켜진 경기"에서 효과 크기.
console.log('\n[isolation 게이트 발동 경기만(부분집합) — A vs C(isolation만 제거)]');
for (const label of ['weakOpp', 'midOpp', 'strongOpp']) {
  const seedBase = 9000 + (label === 'weakOpp' ? 0 : label === 'midOpp' ? 100000 : 200000);
  const avgA = runVariant(isolationEligible, label, null, seedBase);
  const avgC = runVariant(isolationEligible, label, (p) => { if (p.baits >= 2) p.baits = 1; return p; }, seedBase);
  console.log(`${label.padEnd(10)} A ${avgA.toFixed(3)}  C(isolation off) ${avgC.toFixed(3)}  Δ ${(avgA - avgC).toFixed(3)}  (n=${isolationEligible.length})`);
}

// 4) execRaw 규모감 — isolation의 0.08 이 실제 execRaw 대비 몇 %인가(클램프 0.8 기준).
const execRawSample = perfs.map((p) => {
  const isolation = (p.baits >= 2 && p.switches >= 1) ? 0.08 : 0;
  const execRaw = p.baits * 0.05 + p.linesBroken * 0.12 + p.switches * 0.08 + p.runs * 0.05
    + p.windowsUsed * 0.10 + p.situationsResolved * 0.09 + p.decisionsMade * 0.04 + isolation;
  return { execRaw, isolation };
});
const avgExecRaw = execRawSample.reduce((a, b) => a + b.execRaw, 0) / execRawSample.length;
const avgExecRawEligible = execRawSample.filter((e) => e.isolation > 0);
const avgExecRawElig = avgExecRawEligible.reduce((a, b) => a + b.execRaw, 0) / (avgExecRawEligible.length || 1);
console.log(`\n[execRaw 규모감] 전체 평균 execRaw ${avgExecRaw.toFixed(3)} (0.8 클램프 대비 ${(avgExecRaw / 0.8 * 100).toFixed(1)}%)`);
console.log(`  isolation 발동 경기 평균 execRaw ${avgExecRawElig.toFixed(3)} 중 isolation 몫 0.08 = ${(0.08 / avgExecRawElig * 100).toFixed(1)}%`);

console.log('\n해석: Δ(A-B)는 "스위치가 있었던 경기가 없었던 경기보다 얼마나 더 득점하는가"(직접항+게이트 합산).');
console.log('Δ(A-C)는 isolation 플래그(+0.08)만의 순효과 근사(baits 1 차이 confound 있음, 상한).');
console.log('완료.');
