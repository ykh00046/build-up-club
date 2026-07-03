// 4R 플랜 C 불변식 1 — 5택 생존 매트릭스. 각 선택이 어떤 성향×진입에서
// 최선(순EV = regain% − concede%)이 되는 셀이 존재하는가. mark/foul 포함.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

const N = Number(process.argv[2] ?? 800);
const CHOICES = ['dp_press', 'dp_cut', 'dp_mark', 'dp_drop', 'dp_foul'];
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];

function openDefense(seed, loss, opts) {
  const e = createEngine(getScenario('A1'), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

// 한 선택지를 국면 내내 고정으로 눌렀을 때의 회수/실점.
function measure(choice, disp, entry) {
  let regain = 0, conceded = 0, enter = 0;
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(6000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
    if (!e.state.defenseLoop) continue;
    enter++;
    for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
      const r = e.chooseSituationOption(choice);
      if (r.recovered) { regain++; break; }
      if (r.conceded === true) { conceded++; break; }
      if (r.conceded === false || r.restarted) break;
      if (!r.ok) break;
    }
  }
  return { regain: regain / enter * 100, conceded: conceded / enter * 100, net: (regain - conceded) / enter * 100 };
}

for (const entry of ['reset', 'loss']) {
  console.log(`\n=== 진입 '${entry}' — 성향 × 5택 순EV (regain%−concede%), n=${N} ===`);
  console.log('성향        ' + CHOICES.map((c) => c.replace('dp_', '').padStart(9)).join(' ') + '   최선');
  for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
    const nets = {};
    for (const c of CHOICES) nets[c] = measure(c, disp, entry);
    const best = CHOICES.reduce((a, c) => (nets[c].net > nets[a].net ? c : a));
    const row = CHOICES.map((c) => nets[c].net.toFixed(1).padStart(9)).join(' ');
    console.log(`${disp.padEnd(11)} ${row}   ${best.replace('dp_', '')}`);
  }
}
console.log('\n불변식1: 5택 각각이 최소 한 셀에서 최선이어야 함(어느 하나도 전셀 지배/열등 금지).');
