// 6R 신규 — cut/mark 예측 경계 재검증(현재 계수 기준).
// 주의: scripts/probe5-defense-cutmark-crossover.mjs 는 policy.js 5R 재조정 이전 계수를
// 그대로 하드코딩(cutP*(0.35+off*0.8)+laneThreat*0.08, markP*(0.40+off*0.5))하고 있어
// 이제는 실제 policy.js 와 다른 식을 재는 "낡은 프로브"다(수치 재사용 금지). 여기서
// 현재 계수(dp_cut = cutP*0.55+offLaneThreat*0.22+0.08, dp_mark = markP*pred*0.58)로
// 교차 pred*를 다시 구해 커밋 설계 의도("경계 pred≈0.75, balanced/aggressive 사이")와
// 실측이 맞는지 확인한다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1500);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const PRED_BY_DISP = { safe: 0.95, balanced: 0.85, aggressive: 0.7, direct: 0.6 };

function openDefense(seed, loss, opts) {
  const e = createEngine(getScenario('A1'), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

// policy.js 현재 계수(2026-07 6R 시점) 그대로 재현 — policy.js:139,148 과 동기화 유지할 것.
function rawValues(view) {
  const pr = view.pressRead;
  const read = view.oppBuildRead ?? null;
  const best = read?.best ?? null, trap = read?.trap ?? null, gamble = read?.gamble ?? null;
  const carrierRisk = best?.risk ?? 0;
  const laneThreat = Math.max(best?.risk ?? 0, gamble?.risk ?? 0, trap?.risk ?? 0);
  const offLaneThreat = Math.max(0, laneThreat - carrierRisk);
  const cutVal = pr.cutP * 0.55 + offLaneThreat * 0.22 + 0.08;
  const markVal = (pr.markP ?? 0.7) * (pr.pred ?? 1) * 0.58;
  return { cutVal, markVal, offLaneThreat, laneThreat, cutP: pr.cutP, markP: pr.markP ?? 0.7 };
}

console.log(`=== 1) 분석적 교차 pred* (현재 계수) — markVal(pred*)=cutVal, 첫 결정(markP=0.6 첫사용), n=${N} ===`);
console.log('설계 의도(policy.js 주석): 경계 pred≈0.75, balanced(0.85)/aggressive(0.70) 사이에서 갈리게. 실측으로 검증:');
for (const entry of ['reset', 'loss']) {
  const preds = [];
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(11000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: null });
    if (!e.state.defenseLoop) continue;
    const view = buildPolicyView(e, 'us');
    if (view.situation?.id !== 'defend') continue;
    const { cutVal, markP } = rawValues(view);
    const denom = markP * 0.58;
    if (denom <= 0) continue;
    preds.push(cutVal / denom);
  }
  preds.sort((a, b) => a - b);
  const pick = (p) => preds[Math.floor(p * (preds.length - 1))];
  console.log(`  [진입 '${entry}'] n=${preds.length} | pred* 최소 ${pick(0).toFixed(3)} / p25 ${pick(0.25).toFixed(3)} / 중앙 ${pick(0.5).toFixed(3)} / p75 ${pick(0.75).toFixed(3)} / 최대 ${pick(1).toFixed(3)}`);
  for (const [disp, pv] of Object.entries(PRED_BY_DISP)) {
    const below = preds.filter((p) => p <= pv).length;
    console.log(`    → ${disp.padEnd(11)}(pred=${pv}): ${(below / preds.length * 100).toFixed(0)}%가 pred*≤${pv} (mark 우세 구간)`);
  }
}

console.log(`\n=== 2) 실측 스윕 — dl.pred 강제 오버라이드(markP=0.6 첫사용), mark/cut 승률, n=${N} ===`);
for (const entry of ['reset', 'loss']) {
  console.log(`  [진입 '${entry}']  pred   mark우세%  cut우세%`);
  for (const pred of [0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]) {
    let markWin = 0, cutWin = 0, tot = 0;
    for (let i = 0; i < N; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(13000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: null });
      if (!e.state.defenseLoop) continue;
      e.state.defenseLoop.pred = pred;
      const view = buildPolicyView(e, 'us');
      if (view.situation?.id !== 'defend') continue;
      const { cutVal, markVal } = rawValues(view);
      tot++;
      if (markVal > cutVal) markWin++; else cutWin++;
    }
    console.log(`           ${pred.toFixed(2)}   ${(markWin / tot * 100).toFixed(1).padStart(7)}   ${(cutWin / tot * 100).toFixed(1).padStart(7)}`);
  }
}

console.log(`\n=== 3) 실사용 픽률로 직접 교차 확인 — balanced(pred=0.85)에서 mark이 실제로 몇 % 뽑히나(설계 의도 대조), n=${N} ===`);
import('../js/engine/policy.js').then(async ({ pressPolicy }) => {
  for (const entry of ['reset', 'loss']) {
    for (const disp of ['balanced', 'aggressive']) {
      let markPicks = 0, decisions = 0, enter = 0;
      for (let i = 0; i < N; i++) {
        const loss = LOSSES[i % 3];
        const e = openDefense(15000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
        if (!e.state.defenseLoop) continue;
        enter++;
        for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
          const view = buildPolicyView(e, 'us');
          const act = pressPolicy(view);
          if (!act.choiceId || act.kind !== 'situation_choice') break;
          decisions++;
          if (act.choiceId === 'dp_mark') markPicks++;
          const r = e.chooseSituationOption(act.choiceId);
          if (!r.ok || r.recovered || r.conceded !== undefined || r.restarted) break;
        }
      }
      console.log(`  [${entry}/${disp}] mark 픽률 ${(markPicks / (decisions || 1) * 100).toFixed(1)}% (decisions=${decisions})`);
    }
  }
  console.log('\n판정: 설계 의도(주석)는 "pred≈0.75 경계 — balanced/aggressive 사이에서 갈림" 이었다.');
  console.log('실측 pred*가 0.75보다 훨씬 높게(예: 0.90+) 나오면 balanced조차 mark을 못 넘고, mark은 사실상 safe(0.95) 전용 니치로');
  console.log('축소된 것 — "예측 경계가 설계 의도보다 훨씬 안전 쪽(safe 전용)으로 밀렸다"가 실제 결론이 된다.');
});
