// 압박 정책 밸런스 회귀 — docs/symmetric-duel-design.md.
// pressPolicy 가 세 선택(dp_press/dp_cut/dp_drop)을 모두 살려 쓰는지(어느 하나 독식 금지)
// regainP × 상대 레인위험 스윕으로 고정한다. policy.js 는 engine.js 를 import 하지 않으므로
// (evaluator.js → pitch.js 만) 샌드박스에서 실행 가능.

import { pressPolicy } from '../js/engine/policy.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function view(regainP, cutP, bestRisk, altRisk) {
  return {
    situation: { id: 'defensive_press' },
    pressRead: { regainP, cutP },
    oppBuildRead: {
      best: { risk: bestRisk, safety: 1 - bestRisk, target: { id: 'b' } },
      gamble: { risk: altRisk, target: { id: 'g' } },
      trap: { risk: altRisk, target: { id: 't' } },
    },
  };
}

console.log('=== 압박 정책 밸런스 (분포) ===\n');

// 엔진 관계 모사: cutP ≈ regainP - 0.05, 둘째 레인은 best 보다 조금 위험.
const counts = { dp_press: 0, dp_cut: 0, dp_drop: 0 };
let total = 0;
for (let regainP = 0.15; regainP <= 0.70001; regainP += 0.05) {
  for (let bestRisk = 0.1; bestRisk <= 0.9001; bestRisk += 0.1) {
    const cutP = clamp(regainP - 0.05, 0.1, 0.68);
    const altRisk = Math.min(0.95, bestRisk + 0.2);
    const c = pressPolicy(view(regainP, cutP, bestRisk, altRisk)).choiceId;
    counts[c] = (counts[c] || 0) + 1;
    total++;
  }
}
const pct = (n) => Math.round((n / total) * 1000) / 10;
console.log(`  표본 ${total}`);
for (const k of ['dp_press', 'dp_cut', 'dp_drop']) console.log(`  ${k}  ${counts[k]}  ${pct(counts[k])}%`);

ok(counts.dp_press > 0 && counts.dp_cut > 0 && counts.dp_drop > 0, '세 선택이 모두 등장(독식 없음)');
const maxShare = Math.max(...Object.values(counts)) / total;
ok(maxShare <= 0.75, `최다 선택 비중 ${Math.round(maxShare * 100)}% ≤ 75% (쏠림 해소)`);

// 경계 직관 — 각 선택이 마땅한 상황에서 실제로 선택되는지
ok(pressPolicy(view(0.7, 0.6, 0.7, 0.85)).choiceId === 'dp_press', '높은 리게인+노출된 캐리어 → 강하게 압박');
ok(pressPolicy(view(0.2, 0.18, 0.1, 0.18)).choiceId === 'dp_drop', '상대 안전 탈출(저위험) → 후퇴');

// 기존 정책-테스트 케이스 회귀 (사용자 어서션 유지 확인)
const laneCut = pressPolicy({
  situation: { id: 'defensive_press' }, pressRead: { regainP: 0.43, cutP: 0.39 },
  oppBuildRead: { best: { risk: 0.22, safety: 0.78 }, gamble: { risk: 0.48 }, trap: { risk: 0.72 } },
});
ok(laneCut.choiceId === 'dp_cut', '회귀: 위험 레인 존재 → 차단(dp_cut)');
const safeDrop = pressPolicy({
  situation: { id: 'defensive_press' }, pressRead: { regainP: 0.43, cutP: 0.39 },
  oppBuildRead: { best: { risk: 0.08, safety: 0.93 }, gamble: { risk: 0.16 }, trap: { risk: 0.2 } },
});
ok(safeDrop.choiceId === 'dp_drop', '회귀: 상대 최선 탈출 안전 → 후퇴(dp_drop)');

console.log(fail === 0 ? '\n압박 밸런스 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
