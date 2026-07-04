// 7R 신규 — 성향 4티어 실점률 단조성을 10개 시나리오 전부(A1/A2/B1/B2/C1/C2/D1/D2/E1/E2)
// × 진입 2종(reset/loss)에서 재검증. e72de93은 A1/E1/loss만으로 "단조 복원"을 주장했다 —
// 나머지 7개 시나리오에서 새 위반이 생겼는지가 미검증 영역.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1000);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const SCENARIOS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TOL = 1.5; // pp 노이즈 허용치(e72de93 커밋 메시지: "잔여 safe/balanced 0.5pp 노이즈" 참고, 여유있게 1.5pp)

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

let violations = [];
for (const entry of ['reset', 'loss']) {
  console.log(`\n=== 진입 '${entry}' — 시나리오 10종 × 성향 4종 실점률 단조성 (n=${N}/셀) ===`);
  console.log('시나리오  safe    balanced  aggressive  direct   단조?');
  for (const scen of SCENARIOS) {
    const row = [];
    for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
      let conceded = 0, enter = 0;
      for (let i = 0; i < N; i++) {
        const loss = LOSSES[i % 3];
        const e = openDefense(scen, 40000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
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
      row.push(conceded / (enter || 1) * 100);
    }
    // 단조 판정: 허용 오차(TOL) 내 역전은 노이즈로 봄. TOL을 넘는 역전만 위반.
    let monotone = true;
    const breaks = [];
    for (let i = 1; i < row.length; i++) {
      if (row[i] < row[i - 1] - TOL) { monotone = false; breaks.push(`${['safe','balanced','aggressive','direct'][i-1]}>${['safe','balanced','aggressive','direct'][i]}`); }
    }
    if (!monotone) violations.push({ entry, scen, row: row.map((x) => x.toFixed(1)), breaks });
    console.log(`  ${scen}      ${row.map((x) => x.toFixed(1).padStart(6)).join('  ')}   ${monotone ? '✓' : '✗ 위반(' + breaks.join(', ') + ')'}`);
  }
}

console.log(`\n=== 종합 ===`);
if (violations.length === 0) {
  console.log(`  전 10시나리오 × 2진입 = 20셀 모두 단조(허용오차 ${TOL}pp 이내). 티어 단조 복원(e72de93)이 일반화됨.`);
} else {
  console.log(`  위반 ${violations.length}건(허용오차 ${TOL}pp 초과):`);
  for (const v of violations) console.log(`    [${v.entry}/${v.scen}] safe=${v.row[0]} balanced=${v.row[1]} aggressive=${v.row[2]} direct=${v.row[3]}  역전: ${v.breaks.join(', ')}`);
}
