// 실시간 자기대국 게이트(로드맵 A1) — '사람 페이스 + 실시간 레이어'의 밸런스 계약.
// 캘리브레이션(2026-07-07, N=300): 0.6s goal20/붕괴0 · 1.5s goal23.7/붕괴0.7 ·
// 3.2s goal35.3/붕괴17. 계약:
//  ① 보통 페이스(1.5s)는 정지 selfplay(~23.5%)와 같은 밴드 — 시계가 정상 플레이를
//     해치지 않는다(P1: 결정의 게임).
//  ② 느린 페이스(3.2s)는 붕괴가 뚜렷이 증가 — 시계가 문다(뭉갬의 비용 실재).
//  ③ 타임아웃 없음(정책이 결말을 냄), 게이지 단조(느릴수록 높음).
// 알려진 관찰(수용, B4 튜닝 후보): 꾸물이의 goal%가 오히려 높은 붐-버스트(드리프트
// 누적+런 발달 — 살아남으면 강해짐, 단 40%는 죽음). 방향 계약만 게이트.

import { runBatch } from './realtime-selfplay-probe.mjs';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };

console.log('=== 실시간 자기대국 게이트 ===\n');

const N = 120;
const fast = runBatch(N, 1500);
const slow = runBatch(N, 3200);

console.log(`  [1.5s] goal ${fast.goalPct.toFixed(1)}% 붕괴 ${fast.collapsePct.toFixed(1)}% 게이지 ${fast.avgPressure.toFixed(0)} timeout ${fast.timeoutPct.toFixed(1)}%`);
console.log(`  [3.2s] goal ${slow.goalPct.toFixed(1)}% 붕괴 ${slow.collapsePct.toFixed(1)}% 게이지 ${slow.avgPressure.toFixed(0)} timeout ${slow.timeoutPct.toFixed(1)}%\n`);

// ① 보통 페이스 = 정지 밸런스 밴드(여유 마진)
ok(fast.goalPct >= 14 && fast.goalPct <= 32, `보통 페이스 goal ${fast.goalPct.toFixed(1)}% ∈ [14,32] (정지 selfplay ~23.5 동등)`);
ok(fast.collapsePct <= 4, `보통 페이스 붕괴 ${fast.collapsePct.toFixed(1)}% ≤ 4 (시계가 정상 플레이를 안 문다)`);

// ② 시계가 문다 — 느린 페이스 붕괴 뚜렷
ok(slow.collapsePct >= fast.collapsePct + 6, `느린 페이스 붕괴 ${slow.collapsePct.toFixed(1)}% ≥ 보통+6pp (뭉갬의 비용)`);
ok(slow.collapsePct >= 8, `느린 페이스 붕괴 ${slow.collapsePct.toFixed(1)}% ≥ 8 (절대 하한)`);

// ③ 결말·단조
ok(fast.timeoutPct <= 2 && slow.timeoutPct <= 2, `타임아웃 ${fast.timeoutPct.toFixed(1)}/${slow.timeoutPct.toFixed(1)}% ≤ 2`);
ok(slow.avgPressure > fast.avgPressure + 5, `게이지 단조(느림 ${slow.avgPressure.toFixed(0)} > 보통 ${fast.avgPressure.toFixed(0)}+5)`);

// ④ EV 순서(B4 붐-버스트 수리) — 뭉갬이 goal EV에서도 이기면 안 된다(드리프트-게이지
//    커플링으로 꾸물이 35.3→20.0% 교정). 표본 노이즈 여유 +6pp.
ok(slow.goalPct <= fast.goalPct + 6, `EV 순서: 꾸물이 goal ${slow.goalPct.toFixed(1)}% ≤ 보통 ${fast.goalPct.toFixed(1)}%+6`);
ok(Number.isFinite(fast.goalPct) && Number.isFinite(slow.collapsePct), 'NaN 없음');

console.log(fail === 0 ? '\n실시간 자기대국 게이트 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
