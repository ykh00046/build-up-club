// probe2-defense-commander2.mjs — 수비 2라운드: 지휘자 v2 실효 + 성향 v2 구별성.
// 기존 probe-defense-commander는 v1 임계(contained>=2)로 분류해 rule 발동률이 왜곡된다.
// 여기서는 commandOpponent v2 소스 순서 그대로 재분류하고, ON/OFF 실점 대조(같은 시드),
// 성향 4종의 실점률·전진속도·루트 엔트로피(타깃 분포), cut이 읽는 best와 실제 선택의
// 불일치율(인텔 가치)을 측정한다. (조사 전용 — 게임 코드는 건드리지 않음)
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { commandOpponent } from '../js/career/opponent-commander.js';
import { oppBuildDryRun } from '../js/engine/dry-run.js';

const BASE = 'balanced';
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');

function injectTransition(e) {
  const h = e.state.players.find((p) => p.id === e.state.holderId);
  e.state.transition = { kind: 'intercepted', detail: {}, loss: { x: h?.x ?? 42, y: h?.y ?? 34 }, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e.state.matchDecision?.id === 'defend';
}

// v2 소스 순서 그대로: contained>=1 → direct, beaten>=1 → aggressive, pressWins>=2 → safe
function classifyV2(state) {
  const dl = state.defenseLoop;
  if (!dl) return 'none';
  if (dl.contained >= 1) return 'r1_direct';
  if (dl.beaten >= 1) return 'r2_aggressive';
  if ((state.facts?.defensivePressWins ?? 0) >= 2) return 'r3_safe';
  return 'base';
}

function lcg(s) { return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function pickChoice(policy, rnd) {
  if (policy === 'drop') return 'dp_drop';
  if (policy === 'press') return 'dp_press';
  if (policy === 'cut') return 'dp_cut';
  return ['dp_press', 'dp_cut', 'dp_drop'][Math.floor(rnd() * 3)];
}

function runMatches({ policy, commander, n = 400, phasesPerMatch = 6 }) {
  const agg = { matches: 0, phases: 0, steps: 0, fired: { r1_direct: 0, r2_aggressive: 0, r3_safe: 0, base: 0 },
    everMatch: { r1_direct: 0, r2_aggressive: 0, r3_safe: 0 },
    conceded: 0, regains: 0, saved: 0, xgs: [] };
  for (let seed = 1; seed <= n; seed++) {
    const e = createEngine(getScenario('A1'), seed, { opponentBuildDisposition: BASE });
    const rnd = lcg(seed * 7 + 1);
    agg.matches++;
    const ever = new Set();
    for (let ph = 0; ph < phasesPerMatch && e.state.status === 'live'; ph++) {
      if (!injectTransition(e)) break;
      agg.phases++;
      let guard = 0;
      while (e.state.matchDecision?.id === 'defend' && guard++ < 8) {
        agg.steps++;
        if (commander) {
          const cls = classifyV2(e.state);
          agg.fired[cls] = (agg.fired[cls] ?? 0) + 1;
          if (cls !== 'base' && cls !== 'none') ever.add(cls);
          e.setOpponentDisposition(commandOpponent(e.state, BASE));
        }
        const r = e.chooseSituationOption(pickChoice(policy, rnd));
        if (r.recovered) agg.regains++;
        if (r.conceded === true) { agg.conceded++; agg.xgs.push(r.xg); }
        if (r.conceded === false && r.xg != null) { agg.saved++; agg.xgs.push(r.xg); }
      }
    }
    for (const k of ever) agg.everMatch[k]++;
  }
  return agg;
}

console.log('=== 1) 지휘자 v2 규칙 발동(v2 분류) + ON/OFF 실점 — n=400 경기 × 6국면 ===\n');
for (const policy of ['drop', 'press', 'cut', 'random']) {
  const on = runMatches({ policy, commander: true });
  const off = runMatches({ policy, commander: false });
  console.log(`정책=${policy} — 국면 ${on.phases} / 스텝 ${on.steps}`);
  console.log(`  발동(스텝): r1 direct(contained≥1) ${pct(on.fired.r1_direct, on.steps)}  r2 aggressive(beaten≥1) ${pct(on.fired.r2_aggressive, on.steps)}  r3 safe(뺏김≥2) ${pct(on.fired.r3_safe, on.steps)}  base유지 ${pct(on.fired.base, on.steps)}`);
  console.log(`  발동(경기 1회+): r1 ${pct(on.everMatch.r1_direct, on.matches)}  r2 ${pct(on.everMatch.r2_aggressive, on.matches)}  r3 ${pct(on.everMatch.r3_safe, on.matches)}`);
  console.log(`  ON : 회수 ${on.regains} 선방 ${on.saved} 실점 ${on.conceded} (경기당 ${(on.conceded / on.matches).toFixed(3)})`);
  console.log(`  OFF: 회수 ${off.regains} 선방 ${off.saved} 실점 ${off.conceded} (경기당 ${(off.conceded / off.matches).toFixed(3)})  Δ실점/경기 ${((on.conceded - off.conceded) / on.matches).toFixed(3)}\n`);
}

console.log('=== 2) 성향 v2 구별성 — 4티어로 갈라지나? (dp_drop 고정 + random 정책, n=1500 국면) ===');
function entropy(counts) {
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (!total) return NaN;
  let h = 0;
  for (const v of Object.values(counts)) { if (v > 0) { const p = v / total; h -= p * Math.log2(p); } }
  return h;
}
for (const defPolicy of ['drop', 'random']) {
  console.log(`\n[수비 정책=${defPolicy}]`);
  console.log('disp | 국면 | 실점% | 회수% | 평균결정수(전진속도) | 1스텝타깃 H(bit) | 전스텝타깃 H | best이탈%');
  for (const disp of [null, 'safe', 'balanced', 'aggressive', 'direct']) {
    let n = 0, conceded = 0, regain = 0, decisionsSum = 0, deviate = 0, chosenSteps = 0;
    const firstTargets = {}, allTargets = {};
    for (let seed = 1; seed <= 1500; seed++) {
      const e = createEngine(getScenario('A1'), seed, { opponentBuildDisposition: disp });
      const rnd = lcg(seed * 13 + 5);
      if (!injectTransition(e)) continue;
      n++;
      let guard = 0, decisions = 0, firstStep = true;
      while (e.state.matchDecision?.id === 'defend' && guard++ < 8) {
        const best = oppBuildDryRun(e.state)?.best?.target?.id ?? null;
        decisions++;
        const r = e.chooseSituationOption(pickChoice(defPolicy, rnd));
        if (r.step?.targetId) {
          chosenSteps++;
          allTargets[r.step.targetId] = (allTargets[r.step.targetId] ?? 0) + 1;
          if (firstStep) { firstTargets[r.step.targetId] = (firstTargets[r.step.targetId] ?? 0) + 1; firstStep = false; }
          if (best && r.step.targetId !== best) deviate++;
        }
        if (r.recovered) { regain++; break; }
        if (r.xg != null) { if (r.conceded) conceded++; break; }
      }
      decisionsSum += decisions;
    }
    console.log(`${String(disp).padEnd(10)} | ${n} | ${pct(conceded, n)} | ${pct(regain, n)} | ${(decisionsSum / n).toFixed(2)} | ${fmt(entropy(firstTargets), 2)} | ${fmt(entropy(allTargets), 2)} | ${pct(deviate, chosenSteps)}`);
  }
}
console.log('\n(best이탈% = cutP가 읽는 dry-run best와 실제 선택 루트의 불일치율 — cut 회수 위치/확률의 정합성, 예상루트 인텔의 신뢰도)');
