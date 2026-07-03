// probe4-attack-failsplit — 4R 종합 감사 1순위: fail% 급락(22→10)과 goal% 강도
// 단조 상충의 원인 분해. A1 × 강도 4종 × defenseLoop {on,off} 를 같은 시드로
// 짝지어 돌려 (1) fail 의 종결 종류(kind) 분해 — conceded(수비 국면 실점) vs
// intercepted/tackled/trapped(공격 자체 상실), (2) 수비 국면 회계 — 진입/회수/
// 상대슛/실점/세이브 재개("두 번째 삶"), (3) OFF→ON 톤 전이 행렬로 defenseLoop가
// 강도별 goal%에 섞어 넣는 순증을 측정한다.
//
// 실행: node scripts/probe4-attack-failsplit.mjs [조합당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 400);
const INTENSITIES = ['low', 'mid', 'high', 'vhigh'];
const TURN_CAP = 60;

function play(seed, intensity, defenseLoop) {
  const e = createEngine(getScenario('A1'), seed, { intensityOverride: intensity, defenseLoop });
  let turns = 0, stuck = 0;
  const m = {
    entries: 0,        // 수비 국면 진입 횟수
    defSteps: 0,       // 수비 국면 결정(dp_*) 수
    regains: 0,        // 수비 국면 회수(공격 재개, 볼 전방)
    oppShots: 0,       // 상대 슛 발생(실점+세이브)
    concedes: 0,       // 실점 종결
    saves: 0,          // 세이브 → GK 재시작(두 번째 삶)
    foulResets: 0,     // 전술 파울 리셋
    cpRecover: 0,      // 카운터프레스 즉시 회수
    goalAfterLife: 0,  // 골이 "두 번째 삶"(진입≥1) 뒤에 나왔는가
  };
  while (e.state.status === 'live' && turns < TURN_CAP) {
    settle(e);
    if (e.state.status !== 'live') break;
    const view = buildPolicyView(e, 'us');
    const a = aiPolicy(view);
    if (!a || a.kind === 'noop') { if (++stuck > 4) break; continue; }
    const dlBefore = !!e.state.defenseLoop;
    const r = executePolicyAction(e, a);
    settle(e);
    const dlAfter = !!e.state.defenseLoop;
    if (!dlBefore && dlAfter) m.entries++;
    if (dlBefore) {
      m.defSteps++;
      if (r?.recovered) m.regains++;
      if (r?.conceded === true) { m.concedes++; m.oppShots++; }
      if (r?.conceded === false && r?.restarted) { m.saves++; m.oppShots++; }
      if (r?.fouled && r?.reset) m.foulResets++;
      if (r?.fouled && r?.restarted) m.saves++; // 파울 3+ FK 세이브 재개
    } else if (r?.recovered) m.cpRecover++;
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(e);
  const o = e.state.outcome;
  const tone = o?.tone ?? 'timeout';
  if (tone === 'goal' && m.entries > 0) m.goalAfterLife = 1;
  return { tone, kind: o?.kind ?? 'timeout', turns, ...m };
}

const pct = (a, b) => (b ? (a / b * 100).toFixed(1) : '0.0');

console.log(`=== probe4 failsplit: A1 × 강도4 × defenseLoop{on,off} × ${N}경기 (짝시드) ===\n`);

const results = {}; // results[intensity][loop] = { games:[], agg }
for (const it of INTENSITIES) {
  results[it] = {};
  for (const loop of [false, true]) {
    const games = [];
    for (let i = 0; i < N; i++) games.push(play(20000 + i * 11, it, loop));
    results[it][loop ? 'on' : 'off'] = games;
  }
}

console.log('── (1) 톤·종결종류 분해 ─ 조합별');
console.log('강도   loop  goal%  near%  fail%  t.o.%   [fail 내역] conceded  intercepted  tackled  trapped  기타');
for (const it of INTENSITIES) {
  for (const lk of ['off', 'on']) {
    const g = results[it][lk];
    const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
    const kinds = {};
    for (const m of g) { tones[m.tone] = (tones[m.tone] || 0) + 1; if (m.tone === 'fail') kinds[m.kind] = (kinds[m.kind] || 0) + 1; }
    const failN = tones.fail || 0;
    const other = failN - (kinds.conceded || 0) - (kinds.intercepted || 0) - (kinds.tackled || 0) - (kinds.trapped || 0);
    console.log(`${it.padEnd(6)} ${lk.padEnd(4)} ${pct(tones.goal, N).padStart(6)} ${pct(tones.near, N).padStart(6)} ${pct(tones.fail, N).padStart(6)} ${pct(tones.timeout, N).padStart(6)}` +
      `        ${pct(kinds.conceded || 0, N).padStart(5)}%      ${pct(kinds.intercepted || 0, N).padStart(5)}%   ${pct(kinds.tackled || 0, N).padStart(5)}%  ${pct(kinds.trapped || 0, N).padStart(5)}%  ${pct(other, N).padStart(5)}%`);
  }
}

console.log('\n── (2) 수비 국면 회계 (defenseLoop ON) ─ 경기당 평균 · 진입당 확률');
console.log('강도   진입/경기  결정/진입  회수/진입  상대슛/진입  실점/진입  세이브재개/진입  파울리셋/경기  cp회수/경기');
for (const it of INTENSITIES) {
  const g = results[it].on;
  const s = g.reduce((acc, m) => {
    for (const k of ['entries', 'defSteps', 'regains', 'oppShots', 'concedes', 'saves', 'foulResets', 'cpRecover']) acc[k] += m[k];
    return acc;
  }, { entries: 0, defSteps: 0, regains: 0, oppShots: 0, concedes: 0, saves: 0, foulResets: 0, cpRecover: 0 });
  const E = s.entries || 1;
  console.log(`${it.padEnd(6)} ${(s.entries / N).toFixed(2).padStart(8)}  ${(s.defSteps / E).toFixed(2).padStart(8)}  ${pct(s.regains, E).padStart(7)}%  ${pct(s.oppShots, E).padStart(9)}%  ${pct(s.concedes, E).padStart(7)}%  ${pct(s.saves, E).padStart(12)}%  ${(s.foulResets / N).toFixed(2).padStart(11)}  ${(s.cpRecover / N).toFixed(2).padStart(9)}`);
}

console.log('\n── (3) 두 번째 삶 회계 (ON): 진입≥1 경기의 결말 vs 진입 0 경기');
console.log('강도   진입≥1경기%  그중 goal%   그중 fail%   진입0 goal%   골 중 두번째삶 비율');
for (const it of INTENSITIES) {
  const g = results[it].on;
  const withE = g.filter((m) => m.entries > 0);
  const noE = g.filter((m) => m.entries === 0);
  const goalW = withE.filter((m) => m.tone === 'goal').length;
  const goalN = noE.filter((m) => m.tone === 'goal').length;
  const failW = withE.filter((m) => m.tone === 'fail').length;
  const totGoal = goalW + goalN;
  console.log(`${it.padEnd(6)} ${pct(withE.length, N).padStart(9)}%  ${pct(goalW, withE.length).padStart(9)}%  ${pct(failW, withE.length).padStart(9)}%  ${pct(goalN, noE.length).padStart(10)}%  ${pct(goalW, totGoal).padStart(12)}% (${goalW}/${totGoal})`);
}

console.log('\n── (4) OFF→ON 톤 전이 행렬 (같은 시드 짝) — defenseLoop가 결말을 어떻게 바꾸나');
for (const it of INTENSITIES) {
  const off = results[it].off, on = results[it].on;
  const mat = {};
  for (let i = 0; i < N; i++) {
    const key = `${off[i].tone}→${on[i].tone}`;
    mat[key] = (mat[key] || 0) + 1;
  }
  const moved = Object.entries(mat).filter(([k]) => k.split('→')[0] !== k.split('→')[1]).sort((a, b) => b[1] - a[1]);
  const failToGoal = mat['fail→goal'] || 0, failToNear = mat['fail→near'] || 0;
  const goalToFail = mat['goal→fail'] || 0, nearToGoal = mat['near→goal'] || 0, nearToFail = mat['near→fail'] || 0, goalToNear = mat['goal→near'] || 0;
  console.log(`${it}: fail→goal ${failToGoal} · fail→near ${failToNear} · near→goal ${nearToGoal} · near→fail ${nearToFail} · goal→near ${goalToNear} · goal→fail ${goalToFail}` +
    ` | goal 순증 ${(((failToGoal + nearToGoal) - (goalToFail + goalToNear)) / N * 100).toFixed(1)}%p, fail 순감 ${(((failToGoal + failToNear) - (nearToFail + goalToFail)) / N * 100).toFixed(1)}%p`);
}

console.log('\n완료.');
