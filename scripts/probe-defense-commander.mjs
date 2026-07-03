// probe-defense-commander.mjs — 상대 지휘자(opponent-commander) 규칙 발동 빈도 측정.
// main.js와 같은 방식으로 매 defend 결정 전에 commandOpponent를 호출하며,
// 한 "경기"에 수비 국면을 여러 번(최대 6회) 재진입시켜 규칙 1/2/3의 실발동을 센다.
// + 지휘자 ON/OFF 실점률 비교. (조사용)
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { commandOpponent } from '../js/career/opponent-commander.js';

const BASE = 'balanced';

function injectTransition(e) {
  const h = e.state.players.find((p) => p.id === e.state.holderId);
  e.state.transition = { kind: 'intercepted', detail: {}, loss: { x: h?.x ?? 42, y: h?.y ?? 34 }, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e.state.matchDecision?.id === 'defend';
}

// policy: 'drop' | 'press' | 'random' | 'mixed'
function pickChoice(policy, rnd) {
  if (policy === 'drop') return 'dp_drop';
  if (policy === 'press') return 'dp_press';
  if (policy === 'mixed') return ['dp_press', 'dp_cut', 'dp_drop'][Math.floor(rnd() * 3)];
  return ['dp_press', 'dp_cut', 'dp_drop'][Math.floor(rnd() * 3)];
}

function lcg(s) { return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

function runMatches({ policy, commander, n = 400, phasesPerMatch = 6 }) {
  const agg = { matches: 0, phases: 0, steps: 0,
    rule1: 0, rule2: 0, rule3: 0, baseKept: 0, switched: 0,
    conceded: 0, regains: 0, saved: 0,
    rule1EverMatch: 0, rule2EverMatch: 0, rule3EverMatch: 0 };
  for (let seed = 1; seed <= n; seed++) {
    const e = createEngine(getScenario('A1'), seed, { opponentBuildDisposition: BASE });
    const rnd = lcg(seed * 7 + 1);
    agg.matches++;
    let ever1 = false, ever2 = false, ever3 = false;
    for (let ph = 0; ph < phasesPerMatch && e.state.status === 'live'; ph++) {
      if (!injectTransition(e)) break;
      agg.phases++;
      let guard = 0;
      while (e.state.matchDecision?.id === 'defend' && guard++ < 8) {
        agg.steps++;
        if (commander) {
          const next = commandOpponent(e.state, BASE);
          // 어떤 규칙이 발동했는지 분류(우선순위 그대로 재현)
          const dl = e.state.defenseLoop;
          if ((e.state.facts?.defensivePressWins ?? 0) >= 2) { agg.rule1++; ever1 = true; }
          else if (dl.contained >= 2) { agg.rule2++; ever2 = true; }
          else if (dl.beaten >= 1) { agg.rule3++; ever3 = true; }
          if (next !== BASE) agg.switched++; else agg.baseKept++;
          e.setOpponentDisposition(next);
        }
        const r = e.chooseSituationOption(pickChoice(policy, rnd));
        if (r.recovered) agg.regains++;
        if (r.conceded === true) agg.conceded++;
        if (r.conceded === false && r.xg != null) agg.saved++;
      }
    }
    if (ever1) agg.rule1EverMatch++;
    if (ever2) agg.rule2EverMatch++;
    if (ever3) agg.rule3EverMatch++;
  }
  return agg;
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

console.log('=== 상대 지휘자 규칙 발동 — 경기당 수비 국면 최대 6회, n=400 경기 ===\n');
for (const policy of ['drop', 'press', 'random']) {
  const on = runMatches({ policy, commander: true });
  console.log(`정책=${policy} (지휘자 ON)`);
  console.log(`  경기 ${on.matches} / 국면 ${on.phases} / 스텝 ${on.steps}`);
  console.log(`  스텝 기준 발동: rule1(safe,뺏김≥2) ${pct(on.rule1, on.steps)}  rule2(direct,내려서기≥2) ${pct(on.rule2, on.steps)}  rule3(aggressive,벗겨냄≥1) ${pct(on.rule3, on.steps)}  성향교체 스텝 ${pct(on.switched, on.steps)}`);
  console.log(`  경기 기준 1회라도 발동: rule1 ${pct(on.rule1EverMatch, on.matches)}  rule2 ${pct(on.rule2EverMatch, on.matches)}  rule3 ${pct(on.rule3EverMatch, on.matches)}`);
  console.log(`  결과: 회수 ${on.regains} / 선방 ${on.saved} / 실점 ${on.conceded} (경기당 실점 ${(on.conceded / on.matches).toFixed(3)})`);
  const off = runMatches({ policy, commander: false });
  console.log(`  [OFF 대조] 회수 ${off.regains} / 선방 ${off.saved} / 실점 ${off.conceded} (경기당 실점 ${(off.conceded / off.matches).toFixed(3)})\n`);
}

// rule2 심층: 내려서기 2회 후 3번째 결정 직전에 direct로 바뀌는데, 그 결정의 스텝이
// 곧바로 steps>=3 슛으로 이어진다 — direct가 마지막 한 스텝의 루트만 바꾼다.
// 그 한 스텝이 실제로 xG를 바꾸는지: drop-spam에서 지휘자 ON/OFF xG 비교.
console.log('=== rule2 실효 — drop-spam 슛 xG: 지휘자 ON vs OFF (base=balanced, n=1200 국면) ===');
for (const commander of [true, false]) {
  const xgs = [];
  let early = 0, shots = 0;
  for (let seed = 1; seed <= 1200; seed++) {
    const e = createEngine(getScenario('A1'), seed, { opponentBuildDisposition: BASE });
    if (!injectTransition(e)) continue;
    let guard = 0, decisions = 0, last = null;
    while (e.state.matchDecision?.id === 'defend' && guard++ < 8) {
      if (commander) e.setOpponentDisposition(commandOpponent(e.state, BASE));
      decisions++;
      last = e.chooseSituationOption('dp_drop');
    }
    if (last?.xg != null) { xgs.push(last.xg); shots++; if (decisions < 3) early++; }
  }
  const avg = xgs.reduce((s, v) => s + v, 0) / (xgs.length || 1);
  console.log(`  commander=${commander}: shots=${shots} avgXG=${avg.toFixed(4)} 침투슛(3스텝 전)=${pct(early, shots)}`);
}
