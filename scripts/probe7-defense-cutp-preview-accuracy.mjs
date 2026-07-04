// 7R 신규 — 버튼에 표시되는 cut% (dp_cut.desc, engine.js:368 Math.round(cutP*100))가
// 정직한 프리뷰인가: 강제로 dp_cut만 선택했을 때 실측 회수율이 표시값과 일치하는지.
// 성향 4종 + null(자유 플레이, pred=1)에서 확인. dp_mark(markP*pred)도 곁들여 검증
// (마크는 사용마다 markP가 감쇄하므로 "1회차만" 비교가 공정).
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

const N = Number(process.argv[2] ?? 4000);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];

function openDefense(seed, loss, opts) {
  const e = createEngine(getScenario('A1'), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 1) cutP 표시값 vs 실측 회수율 — dp_cut 강제선택(첫 결정만, n=${N}/성향), 성향 4종 + null(자유 플레이) ===`);
console.log('성향        표시cutP(평균)  버튼%반올림  실측회수율  절대오차');
for (const disp of ['safe', 'balanced', 'aggressive', 'direct', null]) {
  let sumCutP = 0, recovered = 0, tot = 0;
  for (const entry of ['reset', 'loss']) {
    for (let i = 0; i < N; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(9000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
      if (!e.state.defenseLoop) continue;
      const cutP = e.state.defenseLoop.cutP;
      sumCutP += cutP;
      tot++;
      const r = e.chooseSituationOption('dp_cut');
      if (r.recovered) recovered++;
    }
  }
  const avgCutP = sumCutP / tot;
  const buttonPct = Math.round(avgCutP * 100); // 근사(실제로는 매 스텝 round 하지만 평균 근사로 충분)
  const realized = recovered / tot * 100;
  const label = disp ?? 'null(자유)';
  console.log(`${label.padEnd(11)}  ${(avgCutP * 100).toFixed(1).padStart(6)}%      ${String(buttonPct).padStart(6)}%      ${realized.toFixed(1).padStart(6)}%     ${Math.abs(avgCutP * 100 - realized).toFixed(1)}pp`);
}

console.log(`\n=== 2) dp_mark 표시값 vs 실측 (1회차만 — markP=0.6 미감쇄), n=${N}/성향 ===`);
console.log('성향        표시(markP*pred)  실측적중률  절대오차');
for (const disp of ['safe', 'balanced', 'aggressive', 'direct', null]) {
  let sumVal = 0, hit = 0, tot = 0;
  for (const entry of ['reset', 'loss']) {
    for (let i = 0; i < N; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(11000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
      if (!e.state.defenseLoop) continue;
      const dl = e.state.defenseLoop;
      const disp_val = (dl.markP ?? 0.7) * (dl.pred ?? 1);
      sumVal += disp_val;
      tot++;
      const r = e.chooseSituationOption('dp_mark');
      // 첫 결정(dl.beaten==0 이전 상태)에서 회수 성공 = 적중
      if (r.recovered) hit++;
    }
  }
  const avgVal = sumVal / tot * 100;
  const realized = hit / tot * 100;
  const label = disp ?? 'null(자유)';
  console.log(`${label.padEnd(11)}  ${avgVal.toFixed(1).padStart(6)}%          ${realized.toFixed(1).padStart(6)}%     ${Math.abs(avgVal - realized).toFixed(1)}pp`);
}

console.log('\n=== 3) null(자유 플레이, pred=1) cutP 절대값 — safe(0.95)보다도 높아야 정상(가장 예측 가능) ===');
for (const entry of ['reset', 'loss']) {
  let sum = 0, tot = 0;
  for (let i = 0; i < 800; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(13000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: null });
    if (!e.state.defenseLoop) continue;
    sum += e.state.defenseLoop.cutP; tot++;
  }
  let sumSafe = 0, totSafe = 0;
  for (let i = 0; i < 800; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(13000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: 'safe' });
    if (!e.state.defenseLoop) continue;
    sumSafe += e.state.defenseLoop.cutP; totSafe++;
  }
  const nullCutP = sum / tot * 100, safeCutP = sumSafe / totSafe * 100;
  console.log(`  [${entry}] null cutP=${nullCutP.toFixed(1)}%  vs  safe cutP=${safeCutP.toFixed(1)}%  → ${nullCutP >= safeCutP - 0.5 ? '정상(null≥safe, pred=1이 최고 예측가능성)' : '⚠ null이 safe보다 낮음 — pred=1 처리 의심'}`);
}
console.log('\n판정: 1)/2)의 절대오차가 크면(예: 5pp+) 프리뷰가 부정직 — 확률표시가 UI만 그럴싸하고 실제 판정과 괴리.');
