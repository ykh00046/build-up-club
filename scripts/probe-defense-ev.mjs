// probe-defense-ev.mjs — 수비 3택(dp_press/dp_cut/dp_drop) EV 매트릭스.
// 성향(null/safe/balanced/aggressive/direct) × 압박강도 × 정책별로 대량 시뮬레이션해
// 회수율/실점률/선방률/스텝수/xG 분포를 측정한다. (조사용 — 게임 코드는 건드리지 않음)
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

function openDefense(seed, opts = {}, scen = 'A1') {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss: { x: 42, y: 34 }, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  const r = e.chooseSituationOption('cp_retreat');
  return { e, r };
}

// 한 판의 수비 국면을 정책대로 플레이. 결과 분류 + 스텝별 관측치 반환.
function playPhase(e, policy) {
  const obs = { steps: 0, regainPs: [], cutPs: [], outcome: null, xg: null,
    regainKind: null, decisions: 0, shotAfterDecisions: null };
  let guard = 0;
  while (e.state.matchDecision?.id === 'defend' && guard++ < 8) {
    const dl = e.state.defenseLoop;
    obs.regainPs.push(dl.regainP);
    obs.cutPs.push(dl.cutP);
    const choice = typeof policy === 'function' ? policy(obs.decisions, dl) : policy;
    const logBefore = e.state.log.length;
    obs.decisions++;
    const r = e.chooseSituationOption(choice);
    const appended = e.state.log.slice(logBefore);
    if (r.recovered) {
      obs.outcome = 'regain';
      // 로그 1줄(회수만) = 확률 성공, 2줄(실패/내려서기 + 회수) = 레인 정체(stall) 회수
      obs.regainKind = appended.length >= 2 ? 'stall' : 'roll';
      return obs;
    }
    if (r.xg != null) {
      obs.outcome = r.conceded ? 'conceded' : 'saved';
      obs.xg = r.xg;
      obs.shotAfterDecisions = obs.decisions;
      return obs;
    }
    obs.steps = e.state.defenseLoop?.steps ?? obs.steps;
  }
  obs.outcome = 'other';
  return obs;
}

const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

function runCell({ scen = 'A1', intensity, disposition, policy, n = 1000 }) {
  const agg = { n: 0, regain: 0, roll: 0, stall: 0, saved: 0, conceded: 0, other: 0,
    xgs: [], decisions: [], earlyShot: 0, shots: 0, rp1: [], cp1: [], rpAll: [] };
  for (let seed = 1; seed <= n; seed++) {
    const opts = { opponentBuildDisposition: disposition };
    if (intensity) opts.intensityOverride = intensity;
    const { e } = openDefense(seed, opts, scen);
    if (e.state.matchDecision?.id !== 'defend') continue;
    agg.n++;
    const obs = playPhase(e, policy);
    agg.rp1.push(obs.regainPs[0]); agg.cp1.push(obs.cutPs[0]);
    agg.rpAll.push(...obs.regainPs);
    agg.decisions.push(obs.decisions);
    if (obs.outcome === 'regain') { agg.regain++; agg[obs.regainKind === 'stall' ? 'stall' : 'roll']++; }
    else if (obs.outcome === 'saved') { agg.saved++; agg.shots++; agg.xgs.push(obs.xg); if (obs.shotAfterDecisions < 3) agg.earlyShot++; }
    else if (obs.outcome === 'conceded') { agg.conceded++; agg.shots++; agg.xgs.push(obs.xg); if (obs.shotAfterDecisions < 3) agg.earlyShot++; }
    else agg.other++;
  }
  return agg;
}

const POLICIES = ['dp_press', 'dp_cut', 'dp_drop'];
const DISPS = [null, 'safe', 'balanced', 'aggressive', 'direct'];

console.log('=== 1) 3택 EV 매트릭스 — 시나리오 A1, 기본 강도, 성향 × 정책, n=1000 ===');
console.log('cell | enter | regain% (roll/stall) | shot% | saved% | conceded% | avgXG | early-shot% | rp1 | cp1 | rpAll');
for (const disp of DISPS) {
  for (const pol of POLICIES) {
    const a = runCell({ disposition: disp, policy: pol, n: 1000 });
    console.log(`${String(disp).padEnd(10)} ${pol.padEnd(8)} | ${a.n} | ${pct(a.regain, a.n)} (${a.roll}/${a.stall}) | ${pct(a.shots, a.n)} | ${pct(a.saved, a.n)} | ${pct(a.conceded, a.n)} | ${fmt(avg(a.xgs))} | ${pct(a.earlyShot, a.shots)} | ${fmt(avg(a.rp1), 3)} | ${fmt(avg(a.cp1), 3)} | ${fmt(avg(a.rpAll), 3)}`);
  }
  console.log('');
}

console.log('=== 2) 압박강도(intensityOverride) 축 — balanced 성향, n=800 ===');
for (const inten of [undefined, 'mid', 'high', 'vhigh']) {
  for (const pol of POLICIES) {
    const a = runCell({ intensity: inten, disposition: 'balanced', policy: pol, n: 800 });
    console.log(`${String(inten).padEnd(9)} ${pol.padEnd(8)} | ${a.n} | regain ${pct(a.regain, a.n)} (roll ${a.roll}/stall ${a.stall}) | conceded ${pct(a.conceded, a.n)} | avgXG ${fmt(avg(a.xgs))} | rp1 ${fmt(avg(a.rp1), 3)}`);
  }
}

console.log('\n=== 3) 시나리오(상대 압박 스킴) 축 — balanced, n=600 ===');
for (const scen of ['A1', 'B1', 'C2', 'D2']) {
  for (const pol of POLICIES) {
    const a = runCell({ scen, disposition: 'balanced', policy: pol, n: 600 });
    console.log(`${scen} ${pol.padEnd(8)} | ${a.n} | regain ${pct(a.regain, a.n)} (stall ${a.stall}) | conceded ${pct(a.conceded, a.n)} | avgXG ${fmt(avg(a.xgs))} | early-shot ${pct(a.earlyShot, a.shots)} | rp1 ${fmt(avg(a.rp1), 3)}`);
  }
}

console.log('\n=== 4) 성향 구별성 — 정책 고정(dp_drop: 상대 루트가 그대로 드러남), n=1500 ===');
console.log('disp | avg decisions-to-shot | early-shot%(침투) | stall-regain%(공짜 회수) | conceded% | avgXG');
for (const disp of DISPS) {
  const a = runCell({ disposition: disp, policy: 'dp_drop', n: 1500 });
  console.log(`${String(disp).padEnd(10)} | ${fmt(avg(a.decisions), 2)} | ${pct(a.earlyShot, a.shots)} | ${pct(a.stall, a.n)} | ${pct(a.conceded, a.n)} | ${fmt(avg(a.xgs))}`);
}

console.log('\n=== 5) xG 재구성 — beaten/contained 조합별 실제 xg (press-spam vs drop-spam vs cut-spam) ===');
for (const pol of POLICIES) {
  const a = runCell({ disposition: 'balanced', policy: pol, n: 1500 });
  const xs = a.xgs.sort((x, y) => x - y);
  const q = (p) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : NaN;
  console.log(`${pol}: shots=${xs.length} xg min=${fmt(xs[0])} p25=${fmt(q(0.25))} med=${fmt(q(0.5))} p75=${fmt(q(0.75))} max=${fmt(xs[xs.length - 1])} | floor(0.05) 비율=${pct(xs.filter((v) => v <= 0.0501).length, xs.length)}`);
}
