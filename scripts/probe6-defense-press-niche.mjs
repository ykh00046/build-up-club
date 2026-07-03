// 6R 신규 — press 니치 소멸 여부 감사.
// 5R 재조정(323c35b): dp_press = regainP²×1.25+carrierRisk×0.14 → regainP×0.92−laneThreat×0.08.
// 질문: 제곱 폭증을 죽였으니 이번엔 반대로 press가 "다시" 과소평가돼 죽었나?
// (1) 실제 정책 플레이에서 press 픽률이 각 진입×성향 셀에서 살아있는지(≥5%) 그리드로 확인.
// (2) laneThreat 관측 분포 — −laneThreat×0.08 항이 실제로 "위험 비례"로 작동하는지,
//     아니면 dry-run.js risk clamp(0.05~0.95)가 거의 항상 상한(0.95)에 붙어 사실상
//     "상수 페널티"가 됐는지(부작용 여지).
// (3) 국면 내 스텝 진행에 따른 regainP/press값 성장 — 첫 결정에서 press가 죽어 있어도
//     후속 스텝(캐리어가 골에 가까워짐)에서 살아나는 "지연 니치"인지 직접 추적.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1500);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const SCENARIOS = ['A1', 'D2', 'E1'];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 1) press 픽률 그리드 — 시나리오×진입×성향, 실사용 pressPolicy, n=${N} ===`);
console.log('셀이 press <5% 면 "니치 소멸" 후보로 표시(*)');
let deadCells = [];
for (const scen of SCENARIOS) {
  for (const entry of ['reset', 'loss']) {
    const row = [];
    for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
      const pick = { dp_press: 0, dp_cut: 0, dp_mark: 0, dp_drop: 0, dp_foul: 0 };
      let decisions = 0, enter = 0;
      for (let i = 0; i < N; i++) {
        const loss = LOSSES[i % 3];
        const e = openDefense(scen, 6000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
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
      const pressPct = pick.dp_press / tot * 100;
      if (pressPct < 5) deadCells.push(`${scen}/${entry}/${disp}`);
      row.push(`${disp}=${pressPct.toFixed(1)}%${pressPct < 5 ? '*' : ''}`);
    }
    console.log(`  [${scen}/${entry.padEnd(5)}] ${row.join('  ')}`);
  }
}
console.log(deadCells.length ? `  → press<5% 셀: ${deadCells.join(', ')}` : '  → 모든 셀에서 press ≥5% 생존.');

console.log(`\n=== 2) laneThreat 분포 — dry-run.js risk clamp(0.05~0.95) 포화 여부, 전 시나리오×진입×성향 혼합, 실사용 플레이 ===`);
const hist = {};
let total = 0;
for (const scen of SCENARIOS) {
  for (const entry of ['reset', 'loss']) {
    for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
      for (let i = 0; i < Math.max(80, Math.floor(N / 8)); i++) {
        const loss = LOSSES[i % 3];
        const e = openDefense(scen, 7000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
        if (!e.state.defenseLoop) continue;
        for (let s = 0; s < 6 && e.state.defenseLoop; s++) {
          const view = buildPolicyView(e, 'us');
          if (view.situation?.id !== 'defend') break;
          const read = view.oppBuildRead;
          const best = read?.best, gamble = read?.gamble, trap = read?.trap;
          const laneThreat = Math.max(best?.risk ?? 0, gamble?.risk ?? 0, trap?.risk ?? 0);
          const bucket = laneThreat >= 0.90 ? '0.90-0.95(상한권)' : laneThreat >= 0.5 ? '0.50-0.89' : '0.00-0.49';
          hist[bucket] = (hist[bucket] || 0) + 1;
          total++;
          const act = pressPolicy(view);
          if (act.kind !== 'situation_choice') break;
          const r = e.chooseSituationOption(act.choiceId);
          if (!r.ok || r.recovered || r.conceded !== undefined || r.restarted) break;
        }
      }
    }
  }
}
for (const [k, v] of Object.entries(hist).sort()) console.log(`  ${k}: ${(v / total * 100).toFixed(1)}% (n=${v})`);
console.log(`  총 관측 n=${total}. 상한권(0.90-0.95) 비중이 압도적이면 −laneThreat×0.08은 "위험 비례"가 아니라 사실상 상수(-0.076~-0.086) 페널티.`);

console.log(`\n=== 3) 지연 니치 추적 — dp_cut 강제 진행으로 스텝별 dp_press/dp_cut 원값 성장 (A1, loss, balanced) ===`);
function rawVals(view) {
  const pr = view.pressRead;
  const read = view.oppBuildRead ?? null;
  const best = read?.best ?? null, gamble = read?.gamble ?? null, trap = read?.trap ?? null;
  const carrierRisk = best?.risk ?? 0;
  const laneThreat = Math.max(best?.risk ?? 0, gamble?.risk ?? 0, trap?.risk ?? 0);
  const offLaneThreat = Math.max(0, laneThreat - carrierRisk);
  return {
    press: pr.regainP * 0.92 - laneThreat * 0.08,
    cut: pr.cutP * 0.55 + offLaneThreat * 0.22 + 0.08,
    regainP: pr.regainP, laneThreat,
  };
}
for (const entry of ['reset', 'loss']) {
  console.log(`  [진입 '${entry}']  step  n     press값   cut값   regainP  press승자%`);
  for (let step = 0; step < 3; step++) {
    let sums = { press: 0, cut: 0, regainP: 0 }, n = 0, pressWins = 0;
    for (let i = 0; i < 500; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense('A1', 8000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: 'balanced' });
      if (!e.state.defenseLoop) continue;
      for (let s = 0; s < step; s++) { if (!e.state.defenseLoop) break; e.chooseSituationOption('dp_cut'); }
      if (!e.state.defenseLoop) continue;
      const view = buildPolicyView(e, 'us');
      if (view.situation?.id !== 'defend') continue;
      const v = rawVals(view);
      sums.press += v.press; sums.cut += v.cut; sums.regainP += v.regainP;
      if (v.press > v.cut) pressWins++;
      n++;
    }
    if (n === 0) { console.log(`    step ${step}  n=0 (루프가 이 스텝 전에 종료됨)`); continue; }
    console.log(`    step ${step}  n=${n}  ${(sums.press / n).toFixed(3).padStart(8)}  ${(sums.cut / n).toFixed(3).padStart(7)}  ${(sums.regainP / n).toFixed(3).padStart(8)}  ${(pressWins / n * 100).toFixed(1).padStart(6)}%`);
  }
}
console.log('\n판정: (1) 픽률 그리드에 * 없으면 press 니치 생존. (2) laneThreat가 상한권에 쏠려 있으면 페널티가 상수화된 부작용.');
console.log('(3) step 0에서 press승자%가 낮고 step 1+에서 오르면 "니치가 첫 결정에 없고 후속 스텝에만 존재"하는 지연 니치 — 평균결정 1.1-1.6(policyuse 실측)인 loss에선 이 니치가 발현될 기회 자체가 제한적임을 시사.');
