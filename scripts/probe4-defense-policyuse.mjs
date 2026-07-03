// 4R 플랜 C 불변식 1(실사용 버전) — 최적 수비 정책(pressPolicy)이 5택을
// 상황별로 실제 고르는가. 고정 1택 순EV로는 drop(실점회피)·foul(위기밸브)의
// 상황 가치가 안 잡히므로, AI가 국면마다 최선을 고르게 두고 빈도·결과를 집계.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1500);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];

function openDefense(seed, loss, opts) {
  const e = createEngine(getScenario('A1'), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

for (const entry of ['reset', 'loss']) {
  console.log(`\n=== 진입 '${entry}' — pressPolicy 선택 빈도 + 국면 결과 (n=${N}/성향) ===`);
  console.log('성향        press  cut  mark drop foul | 회수%  실점%  선방%  평균결정');
  for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
    const pick = { dp_press: 0, dp_cut: 0, dp_mark: 0, dp_drop: 0, dp_foul: 0 };
    let regain = 0, conceded = 0, saved = 0, enter = 0, decisions = 0;
    for (let i = 0; i < N; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(7000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
      if (!e.state.defenseLoop) continue;
      enter++;
      for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
        const view = buildPolicyView(e, 'us');
        const act = pressPolicy(view);
        const cid = act.choiceId;
        if (!cid || act.kind !== 'situation_choice') break;
        pick[cid] = (pick[cid] || 0) + 1;
        decisions++;
        const r = e.chooseSituationOption(cid);
        if (r.recovered) { regain++; break; }
        if (r.conceded === true) { conceded++; break; }
        if (r.conceded === false || r.restarted) { saved++; break; }
        if (!r.ok) break;
      }
    }
    const tot = decisions || 1;
    const f = (x) => (x / tot * 100).toFixed(0).padStart(4);
    const p = (x) => (x / enter * 100).toFixed(1).padStart(5);
    console.log(`${disp.padEnd(11)}${f(pick.dp_press)} ${f(pick.dp_cut)} ${f(pick.dp_mark)} ${f(pick.dp_drop)} ${f(pick.dp_foul)} | ${p(regain)}  ${p(conceded)}  ${p(saved)}  ${(decisions / enter).toFixed(2)}`);
  }
}
console.log('\n불변식1(실사용): 5택 각각이 최소 한 성향에서 비자명 빈도(≥5%)로 선택되면 생존.');
