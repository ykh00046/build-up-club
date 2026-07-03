// 지목 마크(dp_mark) EV — 성향(예측 가능성)별 회수/실점. 5택 매치업 검증(3R).
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

const N = Number(process.argv[2] ?? 800);

function openDefense(seed, disposition) {
  const e = createEngine(getScenario('A1'), seed, disposition ? { opponentBuildDisposition: disposition } : {});
  e.state.transition = { kind: 'intercepted', detail: {}, loss: { x: 42, y: 34 }, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log('=== dp_mark EV — 성향 × n=' + N + ' (A1, 매 스텝 mark 고정) ===');
for (const disp of [null, 'safe', 'balanced', 'aggressive', 'direct']) {
  let regain = 0, conceded = 0, enter = 0;
  for (let i = 0; i < N; i++) {
    const e = openDefense(1000 + i, disp);
    if (!e.state.defenseLoop) continue;
    enter++;
    for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
      const r = e.chooseSituationOption('dp_mark');
      if (r.recovered) { regain++; break; }
      if (r.conceded === true) { conceded++; break; }
      if (r.conceded === false || r.restarted) break;   // 선방 재개
      if (!r.ok) break;
    }
  }
  const name = disp ?? 'null(best)';
  console.log(`  ${name.padEnd(11)} | enter ${enter} | 회수 ${(regain / enter * 100).toFixed(1)}% | 실점 ${(conceded / enter * 100).toFixed(1)}%`);
}
console.log('기대: 예측 가능(safe)일수록 회수↑ — cut(할인 후 ~52-71%)과 press(~45%) 사이 어딘가, direct에선 최악.');
