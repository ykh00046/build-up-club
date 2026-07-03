// 5R 신규 — cut(존 커버) vs mark(대인 도박) 교차점. 정책은 markP(0.7 첫사용 시 0.6)×pred
// 를 cutP(0.35+offLaneThreat×0.8)+laneThreat×0.08 와 비교해 고른다(policy.js:130-139).
// "balanced가 애매하다"는 감으로 끝내지 않고, pred를 직접 스윕해 실제 교차 pred*를 구한다.
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

// policy.js pressPolicy 의 dp_cut/dp_mark 항을 그대로 재현 — 원값(raw value)을 얻어야
// 교차점을 정확히 계산할 수 있다(pressPolicy는 choiceId만 반환, 값은 비공개).
function rawValues(view) {
  const pr = view.pressRead;
  const read = view.oppBuildRead ?? null;
  const best = read?.best ?? null, trap = read?.trap ?? null, gamble = read?.gamble ?? null;
  const carrierRisk = best?.risk ?? 0;
  const laneThreat = Math.max(best?.risk ?? 0, gamble?.risk ?? 0, trap?.risk ?? 0);
  const offLaneThreat = Math.max(0, laneThreat - carrierRisk);
  const cutVal = pr.cutP * (0.35 + offLaneThreat * 0.8) + laneThreat * 0.08;
  const markVal = (pr.markP ?? 0.7) * (pr.pred ?? 1) * (0.40 + offLaneThreat * 0.5);
  return { cutVal, markVal, offLaneThreat, laneThreat, cutP: pr.cutP, markP: pr.markP ?? 0.7 };
}

console.log(`=== 1) 분석적 교차 pred* — markVal(pred*)=cutVal 만족 pred, 첫 결정(markP=0.6 고정), n=${N} ===`);
console.log('(pred* < 실제 성향 pred → mark 우세, pred* > 실제 성향 pred → cut 우세) — entry별(진입 x가 offLaneThreat를 바꾼다)');
for (const entry of ['reset', 'loss']) {
  const preds = [];
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(11000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: null });
    if (!e.state.defenseLoop) continue;
    const view = buildPolicyView(e, 'us');
    if (view.situation?.id !== 'defend') continue;
    const { cutVal, offLaneThreat, markP } = rawValues(view);
    // markVal(pred) = markP*pred*(0.40+offLaneThreat*0.5) → pred* = cutVal / (markP*(0.40+off*0.5))
    const denom = markP * (0.40 + offLaneThreat * 0.5);
    if (denom <= 0) continue;
    preds.push(cutVal / denom);
  }
  preds.sort((a, b) => a - b);
  const pick = (p) => preds[Math.floor(p * (preds.length - 1))];
  console.log(`  [진입 '${entry}'] 표본 n=${preds.length} | pred* 최소 ${pick(0).toFixed(2)} / p25 ${pick(0.25).toFixed(2)} / 중앙 ${pick(0.5).toFixed(2)} / p75 ${pick(0.75).toFixed(2)} / 최대 ${pick(1).toFixed(2)}`);
  console.log(`    실제 성향 pred: direct 0.60 · aggressive 0.70 · balanced 0.85 · safe 0.95`);
  for (const [disp, pv] of Object.entries(PRED_BY_DISP)) {
    const below = preds.filter((p) => p <= pv).length;
    console.log(`    → ${disp.padEnd(11)}(pred=${pv}): 표본 중 ${(below / preds.length * 100).toFixed(0)}%가 pred*≤${pv} (mark 우세 구간)`);
  }
}

console.log(`\n=== 2) 실측 스윕 — dl.pred를 강제 오버라이드(markP=0.6 첫사용)해 mark/cut 승률 곡선, n=${N} ===`);
for (const entry of ['reset', 'loss']) {
  console.log(`  [진입 '${entry}']  pred   mark우세%  cut우세%   평균offLaneThreat`);
  for (const pred of [0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]) {
    let markWin = 0, cutWin = 0, tot = 0, offSum = 0;
    for (let i = 0; i < N; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(13000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: null });
      if (!e.state.defenseLoop) continue;
      e.state.defenseLoop.pred = pred;   // 성향과 무관하게 순수 pred 값만 스윕
      const view = buildPolicyView(e, 'us');
      if (view.situation?.id !== 'defend') continue;
      const { cutVal, markVal, offLaneThreat } = rawValues(view);
      tot++; offSum += offLaneThreat;
      if (markVal > cutVal) markWin++; else cutWin++;
    }
    console.log(`           ${pred.toFixed(2)}   ${(markWin / tot * 100).toFixed(1).padStart(7)}   ${(cutWin / tot * 100).toFixed(1).padStart(7)}   ${(offSum / tot).toFixed(2)}`);
  }
}
console.log('\n해석: 교차 pred*가 실제 balanced(0.85)/aggressive(0.70) 부근에 걸치면 그 성향들에서 표본마다 승자가');
console.log('갈려("애매") — policyuse 실측(진입 reset: safe/balanced→mark, aggressive/direct→cut)과 대조해 balanced가');
console.log('임계선에 가장 가깝게 걸리는 성향인지 확인.');
