// 7R 신규 — press/drop/foul 니치가 cutP 재조정(e72de93)에 밀려났는지, A1 단일 시나리오를
// 넘어 5종(A1/B2/C2/D2/E1 — 로우블록·게겐 등 형태가 다른 셋 포함)에서 재확인.
// probe4-defense-policyuse/probe6-defense-press-niche는 A1(또는 A1/D2/E1) 위주였다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1200);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const SCENARIOS = ['A1', 'B2', 'C2', 'D2', 'E1'];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 5택 픽률 그리드 — 시나리오 5종 × 진입 2종 × 성향 4종, n=${N}/셀 ===`);
console.log('셀 안 <5%면 (*) 표기 — 니치 소멸 후보. cut은 결과 확인용(니치 붕괴는 probe7-cutmark-niche 참고).');
const tally = { dp_press: [], dp_cut: [], dp_mark: [], dp_drop: [], dp_foul: [] };
for (const scen of SCENARIOS) {
  for (const entry of ['reset', 'loss']) {
    const row = [];
    for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
      const pick = { dp_press: 0, dp_cut: 0, dp_mark: 0, dp_drop: 0, dp_foul: 0 };
      let decisions = 0, enter = 0;
      for (let i = 0; i < N; i++) {
        const loss = LOSSES[i % 3];
        const e = openDefense(scen, 16000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
        if (!e.state.defenseLoop) continue;
        enter++;
        for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
          const view = buildPolicyView(e, 'us');
          const act = pressPolicy(view);
          if (!act.choiceId || act.kind !== 'situation_choice') break;
          pick[act.choiceId] = (pick[act.choiceId] || 0) + 1;
          decisions++;
          const r = e.chooseSituationOption(act.choiceId);
          if (!r.ok || r.recovered || r.conceded !== undefined || r.restarted) break;
        }
      }
      const tot = decisions || 1;
      for (const k of Object.keys(tally)) tally[k].push(pick[k] / tot * 100);
      const pct = (k) => (pick[k] / tot * 100);
      row.push(`${disp}=[P${pct('dp_press').toFixed(0)} C${pct('dp_cut').toFixed(0)} M${pct('dp_mark').toFixed(0)} D${pct('dp_drop').toFixed(0)} F${pct('dp_foul').toFixed(0)}]`);
    }
    console.log(`  [${scen}/${entry.padEnd(5)}] ${row.join('  ')}`);
  }
}
console.log('\n=== 종합 — 5택 각각 전 셀(5시나리오×2진입×4성향=40셀) 중 ≥5% 도달 셀 수 ===');
for (const k of Object.keys(tally)) {
  const arr = tally[k];
  const alive = arr.filter((v) => v >= 5).length;
  console.log(`  ${k.padEnd(9)}: ${alive}/${arr.length}셀에서 ≥5%  (최대 ${Math.max(...arr).toFixed(1)}%, 최소 ${Math.min(...arr).toFixed(1)}%)`);
}
console.log('\n판정: press/drop/foul가 이전 라운드 대비 급감했으면(전 셀 <5%에 가까움) cutP 재조정이 이들 니치를 밀어낸 것.');
console.log('drop이 시종 0에 가까우면(설계상 위기 사다리 최후수단이라 원래도 희귀) 5R/6R와 동일 결론 — 새 회귀 아님.');
