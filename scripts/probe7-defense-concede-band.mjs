// 7R 신규 — 6R(probe6-defense-concede-band)이 "balanced 진입'loss' 국면당 실점률 8-18%
// 목표 밴드에서 10개 중 6개 미달"이라 지적했다. cutP가 pred 기반으로 바뀌면서(e72de93)
// press/mark 픽률이 커졌으니(실질 회수 경로 변화) 밴드 미달 시나리오 수가 바뀌었는지 재측정.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1500);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const SCENARIOS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 국면당 실점률 밴드 재검증 — 시나리오 10종, 진입 'loss'(커리어 실사용), balanced, n=${N} ===`);
console.log('목표 밴드: 8-18% (6R과 동일 기준).');
let below = 0, inBand = 0, above = 0;
const rows = [];
for (const scen of SCENARIOS) {
  let conceded = 0, enter = 0;
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(scen, 24000 + i, loss, { defenseEntry: 'loss', opponentBuildDisposition: 'balanced' });
    if (!e.state.defenseLoop) continue;
    enter++;
    for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
      const view = buildPolicyView(e, 'us');
      const act = pressPolicy(view);
      if (act.kind !== 'situation_choice') break;
      const r = e.chooseSituationOption(act.choiceId);
      if (r.recovered || r.conceded !== undefined || r.restarted) { if (r.conceded === true) conceded++; break; }
      if (!r.ok) break;
    }
  }
  const rate = conceded / (enter || 1) * 100;
  const status = rate < 8 ? '↓ 밴드미달' : rate > 18 ? '↑ 밴드초과' : '밴드내';
  if (rate < 8) below++; else if (rate > 18) above++; else inBand++;
  rows.push({ scen, rate, status });
  console.log(`  [${scen}] 실점률 ${rate.toFixed(1)}%  (enter=${enter})  ${status}`);
}
const rates = rows.map((r) => r.rate);
console.log(`\n  평균 ${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)}%  최소 ${Math.min(...rates).toFixed(1)}%  최대 ${Math.max(...rates).toFixed(1)}%`);
console.log(`  밴드내 ${inBand}/10, 밴드미달 ${below}/10, 밴드초과 ${above}/10`);
console.log('\n6R 기록: "10개 중 6개 미달"(구체 수치는 probe6-defense-concede-band.mjs 6R 로그 참고).');
console.log(`7R 실측: 밴드미달 ${below}/10 — ${below < 6 ? '개선(cutP 재조정이 실점 상향에 기여)' : below === 6 ? '변화 없음' : '악화'}.`);
