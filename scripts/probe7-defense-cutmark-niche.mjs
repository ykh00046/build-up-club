// 7R 신규 — cutP가 이제 pred 기반이라(e72de93) mark(markP×pred)와 cut(cutP*0.55+offLane*0.22+0.08)
// 둘 다 pred에 의존하게 됐다. 니치가 다시 겹쳤나(cut/mark 경계 재붕괴), 아니면 press가
// 어부지리로 니치를 먹었나(둘 다일 수도)? 6R 감사(probe6-defense-cutmark-boundary)의 경계
// 재현식을 pred-기반 cutP로 갱신해 분석적 교차점을 다시 구하고, 실사용 픽률로 검증한다.
// 계수 동기화 주의: policy.js:142(dp_press),147(dp_cut),157(dp_mark) / engine.js:345(cutP신) 참조.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

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

// --- 1) 분석적 교차점 재계산: 신(post e72de93) cutP vs 구(pre) cutP -------------
console.log('=== 1) 분석적 mark/cut 교차 pred* — 신규 pred기반 cutP vs 구식 route.risk(포화 상수) cutP ===');
console.log('신규: cutP = clamp(0.10+0.34*pred, 0.1, 0.56)   [engine.js:345]');
console.log('구식: cutP = clamp(0.12+0.41*0.32, ...) ≈ 0.2512 (route.risk 포화 상수, pred 무관)   [pre-e72de93]');
console.log('cutVal = cutP*0.55 + offLaneThreat*0.22 + 0.08 / markVal = markP*pred*0.66  [policy.js:147,157]\n');

function newCutP(pred) { return Math.min(0.56, Math.max(0.1, 0.10 + 0.34 * pred)); }
const OLD_CUTP_CONST = Math.min(0.56, Math.max(0.1, 0.12 + 0.41 * 0.32)); // ≈0.2512, pred 무관(6R 발견)

for (const offLaneThreat of [0, 0.15, 0.3]) {
  console.log(`  [offLaneThreat=${offLaneThreat}]`);
  for (const markP of [0.6, 0.45, 0.3]) {
    // 신규: markVal(pred) = cutVal(pred) 풀이 (이분 탐색, cutP가 pred에 약하게 의존)
    let lo = 0.3, hi = 1.0;
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      const cutVal = newCutP(mid) * 0.55 + offLaneThreat * 0.22 + 0.08;
      const markVal = markP * mid * 0.66;
      if (markVal > cutVal) hi = mid; else lo = mid;
    }
    const newCross = (lo + hi) / 2;
    // 구식: cutVal 상수이므로 markVal=cutVal 선형으로 즉시 풀림
    const oldCutVal = OLD_CUTP_CONST * 0.55 + offLaneThreat * 0.22 + 0.08;
    const oldCross = oldCutVal / (markP * 0.66);
    console.log(`    markP=${markP.toFixed(2)}(사용횟수 기준)  신규 교차pred*=${newCross.toFixed(3)}   구식 교차pred*=${oldCross > 1 ? '>1.0(항상 cut승)' : oldCross.toFixed(3)}`);
  }
  console.log('');
}
console.log('해석: 신규 교차pred*가 aggressive(0.7)보다 낮으면 balanced(0.85)뿐 아니라 aggressive까지 mark 우세로 넘어가');
console.log('"예측가능(safe/balanced)→mark, 불가(aggressive/direct)→cut" 니치 경계(policy.js:154-156 주석 의도)가 무너진다.');
console.log('구식은 offLaneThreat=0일 때 교차>1(cut이 pred 불문 상수라 markP=0.6 첫사용에도 못 이김 → mark 항상 우세) 였음을 보라 —');
console.log('즉 6R 이전엔 정반대 편향(mark 과다 우세)이었고, e72de93은 그걸 되돌리다 못해 반대로 넘어갔을 수 있다.\n');

// --- 2) 실사용 픽률 그리드 (reset/loss × 4성향) ------------------------------
console.log(`=== 2) 실사용 픽률 그리드 — pressPolicy, A1, n=${N}/성향 (cut/mark/press 니치 생존 여부) ===`);
const grid = {};
for (const entry of ['reset', 'loss']) {
  console.log(`  [진입 '${entry}']  성향        press  cut  mark drop foul | 실점%`);
  grid[entry] = {};
  for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
    const pick = { dp_press: 0, dp_cut: 0, dp_mark: 0, dp_drop: 0, dp_foul: 0 };
    let conceded = 0, enter = 0, decisions = 0;
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
        if (r.conceded === true) conceded++;
        if (r.recovered || r.conceded !== undefined || r.restarted) break;
        if (!r.ok) break;
      }
    }
    const tot = decisions || 1;
    const f = (x) => (x / tot * 100).toFixed(0).padStart(4);
    grid[entry][disp] = { cut: pick.dp_cut / tot * 100, mark: pick.dp_mark / tot * 100, press: pick.dp_press / tot * 100 };
    console.log(`             ${disp.padEnd(11)}${f(pick.dp_press)} ${f(pick.dp_cut)} ${f(pick.dp_mark)} ${f(pick.dp_drop)} ${f(pick.dp_foul)} | ${(conceded / (enter || 1) * 100).toFixed(1)}`);
  }
}
console.log('\n판정:');
for (const entry of ['reset', 'loss']) {
  const cutDead = Object.values(grid[entry]).every((v) => v.cut < 5);
  const markDead = Object.values(grid[entry]).every((v) => v.mark < 5);
  console.log(`  [${entry}] cut 전 성향 <5%: ${cutDead ? '⚠ 니치 소멸' : '생존'}  /  mark 전 성향 <5%: ${markDead ? '⚠ 니치 소멸' : '생존'}`);
  if (!cutDead && !markDead) {
    // 니치 겹침 판정: balanced에서 mark가 설계의도(우세)와 달리 cut에 밀리는지
    const b = grid[entry].balanced;
    console.log(`    balanced: cut=${b.cut.toFixed(1)}% vs mark=${b.mark.toFixed(1)}% → ${b.cut > b.mark ? '⚠ 설계의도(예측가능→mark) 위반, cut이 balanced까지 잠식' : '설계의도대로 mark 우세'}`);
  }
}
