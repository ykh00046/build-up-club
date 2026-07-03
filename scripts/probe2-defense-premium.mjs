// probe2-defense-premium.mjs — 수비 2라운드: 회수 '위치 프리미엄' 정량화.
// 질문: press(캐리어 지점) 회수가 cut(패스길 중간, 더 깊음) 회수보다 "회수 후 공격 재개
// 가치"로 실제 얼마나 이득인가? 회수 지점 x 분포 + 회수 후 같은 시도에서 aiPolicy로
// 끝까지 이어 골까지 간 비율을 측정. + 합성 정책(drop→press 등) 지배 여부.
// (조사 전용 — 게임 코드는 건드리지 않음)
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1500);

function openDefense(seed, opts = {}, scen = 'A1') {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss: { x: 42, y: 34 }, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

// policy: string | (i, dl) => choice. 국면 종료 분류 반환.
function playDefense(e, policy) {
  let i = 0, guard = 0;
  while (e.state.matchDecision?.id === 'defend' && guard++ < 8) {
    const choice = typeof policy === 'function' ? policy(i, e.state.defenseLoop) : policy;
    const r = e.chooseSituationOption(choice);
    i++;
    if (r.recovered) return { end: 'regain', by: choice, decisions: i };
    if (r.xg != null) return { end: r.conceded ? 'conceded' : 'saved', decisions: i, xg: r.xg };
  }
  return { end: 'other', decisions: i };
}

// 회수(또는 선방 리스타트) 후 같은 시도를 aiPolicy로 끝까지.
function continueAttack(e, cap = 50) {
  let turns = 0, stuck = 0, acts = 0;
  const first3 = [];
  while (e.state.status === 'live' && turns < cap) {
    settle(e);
    if (e.state.status !== 'live') break;
    const view = buildPolicyView(e, 'us');
    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const r = executePolicyAction(e, action);
    settle(e);
    const ok = !!(r && r.ok !== false);
    if (acts < 3) first3.push(ok ? 1 : 0);
    acts++;
    if (!ok) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(e);
  const tone = e.state.outcome?.tone ?? 'timeout';
  return { tone, first3 };
}

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log(`=== 1) 회수 위치 프리미엄 — A1, 성향 null, n=${N}/정책 ===`);
console.log('정책별: 회수 시 홀더 x 분포 / 회수 후 골까지 간 비율 / 첫 3액션 성공률 / phase 라벨');
for (const pol of ['dp_press', 'dp_cut', 'dp_drop']) {
  const xs = [], first3All = [];
  let regains = 0, goalsAfter = 0, phaseMismatch = 0, shapePulled = 0;
  const byStepX = { 1: [], 2: [], 3: [] };
  for (let seed = 1; seed <= N; seed++) {
    const e = openDefense(seed);
    if (e.state.matchDecision?.id !== 'defend') continue;
    const res = playDefense(e, pol);
    if (res.end !== 'regain') continue;
    regains++;
    const h = e.state.players.find((p) => p.id === e.state.holderId);
    xs.push(h.x);
    (byStepX[Math.min(res.decisions, 3)] ??= []).push(h.x);
    if (e.state.phase === 'BUILDUP' && h.x > 40) phaseMismatch++;
    // 재배치로 우리 필드 선수가 홈에서 10m 이상 뒤로 끌려간 채 재개하는지
    const pulled = e.state.players.filter((p) => p.side === 'us' && p.role !== 'GK' && Number.isFinite(p.homeX) && p.x < p.homeX - 10).length;
    if (pulled >= 3) shapePulled++;
    const cont = continueAttack(e);
    if (cont.tone === 'goal') goalsAfter++;
    first3All.push(...cont.first3);
  }
  console.log(`${pol.padEnd(8)} | 회수 ${regains} | x avg ${fmt(avg(xs), 1)} med ${fmt(med(xs), 1)} | 골전환 ${pct(goalsAfter, regains)} | 첫3액션 성공 ${pct(first3All.filter(Boolean).length, first3All.length)} | phase=BUILDUP&x>40 ${pct(phaseMismatch, regains)} | 3인+ 10m후퇴 재개 ${pct(shapePulled, regains)}`);
  console.log(`         step별 회수 x: 1스텝 ${fmt(avg(byStepX[1]), 1)}(n=${byStepX[1]?.length ?? 0}) 2스텝 ${fmt(avg(byStepX[2]), 1)}(n=${byStepX[2]?.length ?? 0}) 3스텝+ ${fmt(avg(byStepX[3]), 1)}(n=${byStepX[3]?.length ?? 0})`);
}

console.log('\n=== 2) 기준선 — 정상 빌드업(킥오프부터 aiPolicy), 같은 시드 ===');
{
  const first3All = [];
  let n = 0, goals = 0;
  for (let seed = 1; seed <= N; seed++) {
    const e = createEngine(getScenario('A1'), seed, {});
    n++;
    const cont = continueAttack(e);
    if (cont.tone === 'goal') goals++;
    first3All.push(...cont.first3);
  }
  console.log(`baseline | n ${n} | 골 ${pct(goals, n)} | 첫3액션 성공 ${pct(first3All.filter(Boolean).length, first3All.length)}`);
}

console.log('\n=== 3) 합성 정책 EV — 국면+재개 통산 (goal% - conceded%), n=1200/정책 ===');
const POLICIES = {
  press3: 'dp_press',
  cut3: 'dp_cut',
  drop3: 'dp_drop',
  'drop→press': (i) => (i === 0 ? 'dp_drop' : 'dp_press'),
  'drop→cut': (i) => (i === 0 ? 'dp_drop' : 'dp_cut'),
  'cut→press': (i) => (i === 0 ? 'dp_cut' : 'dp_press'),
  'drop,drop→press': (i) => (i < 2 ? 'dp_drop' : 'dp_press'),
  'press→cut': (i) => (i === 0 ? 'dp_press' : 'dp_cut'),
};
console.log('정책 | 회수% | 실점% | 선방% | 회수후골% | 선방후골% | 통산 goal% | 순EV(goal-conceded)');
for (const [name, pol] of Object.entries(POLICIES)) {
  let n = 0, regain = 0, conceded = 0, saved = 0, goalAfterRegain = 0, goalAfterSave = 0;
  for (let seed = 1; seed <= 1200; seed++) {
    const e = openDefense(seed);
    if (e.state.matchDecision?.id !== 'defend') continue;
    n++;
    const res = playDefense(e, pol);
    if (res.end === 'regain') {
      regain++;
      if (continueAttack(e).tone === 'goal') goalAfterRegain++;
    } else if (res.end === 'saved') {
      saved++;
      if (continueAttack(e).tone === 'goal') goalAfterSave++;
    } else if (res.end === 'conceded') conceded++;
  }
  const goals = goalAfterRegain + goalAfterSave;
  console.log(`${name.padEnd(16)} | ${pct(regain, n)} | ${pct(conceded, n)} | ${pct(saved, n)} | ${pct(goalAfterRegain, regain)} | ${pct(goalAfterSave, saved)} | ${pct(goals, n)} | ${fmt(((goals - conceded) / n) * 100, 1)}pp`);
}
console.log('\n(순EV = 이 수비 국면에 진입한 시도가 결국 골로 끝날 확률 - 실점으로 끝날 확률)');
