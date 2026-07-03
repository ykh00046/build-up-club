// 6R 신규 — dp_press의 −laneThreat×0.08 페널티 부작용 감사.
// 질문: laneThreat이 높은(깊은 진입) 국면에서 press를 과하게 눌러 cut 독점을 만드는가?
// dry-run.js:48 risk = clamp(1 - minLaneDist/18, 0.05, 0.95) — 이 프로브는 먼저
// laneThreat이 실제로 얼마나 "상한(0.95)"에 쏠리는지 시나리오별로 재고(clamp 포화 여부),
// 그 다음 D2/reset에서 실측된 press 0% 데드셀(probe6-defense-press-niche 발견)의 메커니즘을
// regainP 성장 추이로 규명한다 — laneThreat 자체가 원인인지, regainP가 원래 낮은 게
// 원인인지 분리한다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1200);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const SCENARIOS = ['A1', 'B1', 'C1', 'D2', 'E1', 'E2'];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 1) laneThreat 클램프 포화 — 시나리오별 상한권(≥0.90) 비중, 진입 'loss', 성향 'balanced', n=${N} ===`);
for (const scen of SCENARIOS) {
  let ceil = 0, tot = 0, sum = 0;
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(scen, 21000 + i, loss, { defenseEntry: 'loss', opponentBuildDisposition: 'balanced' });
    if (!e.state.defenseLoop) continue;
    const view = buildPolicyView(e, 'us');
    if (view.situation?.id !== 'defend') continue;
    const read = view.oppBuildRead;
    const laneThreat = Math.max(read?.best?.risk ?? 0, read?.gamble?.risk ?? 0, read?.trap?.risk ?? 0);
    if (laneThreat >= 0.90) ceil++;
    sum += laneThreat; tot++;
  }
  console.log(`  [${scen}] 상한권(≥0.90) ${(ceil / tot * 100).toFixed(1)}%  평균laneThreat ${(sum / tot).toFixed(3)}  (n=${tot})`);
}
console.log('  해석: 대부분 상한권이면 −laneThreat×0.08 페널티는 국면마다 거의 상수(−0.072~−0.076)로 작동 — "위험 비례" 설계 의도가 실질적으로 무력화.');

console.log(`\n=== 2) cut 독점 스캔 — 시나리오×진입×성향 그리드에서 dp_cut 픽률 ≥90% 셀(독점 후보), n=${N} ===`);
const monopolies = [];
for (const scen of SCENARIOS) {
  for (const entry of ['reset', 'loss']) {
    for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
      const pick = { dp_press: 0, dp_cut: 0, dp_mark: 0, dp_drop: 0, dp_foul: 0 };
      let decisions = 0, enter = 0;
      for (let i = 0; i < N; i++) {
        const loss = LOSSES[i % 3];
        const e = openDefense(scen, 22000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
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
      const cutPct = pick.dp_cut / tot * 100;
      if (cutPct >= 90) monopolies.push({ cell: `${scen}/${entry}/${disp}`, cutPct: cutPct.toFixed(1), pressPct: (pick.dp_press / tot * 100).toFixed(1) });
    }
  }
}
if (monopolies.length) {
  console.log('  cut≥90% 셀 발견:');
  for (const m of monopolies) console.log(`    ${m.cell}: cut ${m.cutPct}% / press ${m.pressPct}%`);
} else {
  console.log('  cut≥90% 독점 셀 없음 — laneThreat 페널티가 cut 독점을 만들지는 않음(단, 개별 dead-press 셀은 별도 프로브 참조).');
}

console.log(`\n=== 3) D2/reset 데드셀 메커니즘 — regainP 성장 추이(dp_cut 강제 진행), balanced, n=500 ===`);
for (const scen of ['D2', 'A1']) {
  console.log(`  [${scen}/reset]  step  n     regainP   laneThreat  press값   cut값`);
  for (let step = 0; step < 3; step++) {
    let sums = { regainP: 0, laneThreat: 0, press: 0, cut: 0 }, n = 0;
    for (let i = 0; i < 500; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(scen, 23000 + i, loss, { defenseEntry: 'reset', opponentBuildDisposition: 'balanced' });
      if (!e.state.defenseLoop) continue;
      for (let s = 0; s < step; s++) { if (!e.state.defenseLoop) break; e.chooseSituationOption('dp_cut'); }
      if (!e.state.defenseLoop) continue;
      const view = buildPolicyView(e, 'us');
      if (view.situation?.id !== 'defend') continue;
      const pr = view.pressRead; const read = view.oppBuildRead;
      const carrierRisk = read?.best?.risk ?? 0;
      const laneThreat = Math.max(read?.best?.risk ?? 0, read?.gamble?.risk ?? 0, read?.trap?.risk ?? 0);
      const offLaneThreat = Math.max(0, laneThreat - carrierRisk);
      sums.regainP += pr.regainP; sums.laneThreat += laneThreat;
      sums.press += pr.regainP * 0.92 - laneThreat * 0.08;
      sums.cut += pr.cutP * 0.55 + offLaneThreat * 0.22 + 0.08;
      n++;
    }
    if (n === 0) { console.log(`    step ${step}  n=0`); continue; }
    console.log(`    step ${step}  n=${n}  ${(sums.regainP / n).toFixed(3).padStart(8)}  ${(sums.laneThreat / n).toFixed(3).padStart(10)}  ${(sums.press / n).toFixed(3).padStart(8)}  ${(sums.cut / n).toFixed(3).padStart(7)}`);
  }
}
console.log('\n판정: D2/reset의 press값이 전 스텝에서 A1보다 낮게 유지되면 원인은 laneThreat(둘 다 상한권 비슷)이 아니라');
console.log('regainP 자체가 시나리오 구조상(5-3-2 로우블록 수비 배치) 낮게 유지되는 것 — laneThreat 페널티는 방아쇠가 아니라 이미 낮은 regainP를 굳히는 역할.');
