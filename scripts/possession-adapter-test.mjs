// Phase 2b 어댑터 회귀 — docs/symmetric-duel-design.md.
// 합성 엔진 객체({ state })로 검증하므로 engine.js 미import → 샌드박스 실행 가능.
// 어댑터가 engine.state 에 전환을 "안전하게·최소로" 적용하는지 고정한다.

import { applyOpponentBuildStep, applyPossession, applyPossessionEvent } from '../js/engine/possession-adapter.js';
import { resolvePossession } from '../js/engine/possession.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };

function makeEngine(possession = 'us', holderId = 'us-cm') {
  return {
    state: {
      status: 'live', possession, holderId, phase: 'PROGRESSION',
      matchDecision: { id: 'defensive_press' },
      transition: { kind: 'intercepted' },
      defensivePress: { regainP: 0.5 },
      ball: { x: 45, y: 34 },
      players: [
        { id: 'us-gk', side: 'us', role: 'GK', x: 5, y: 34, orientation: 'FACING' },
        { id: 'us-cb', side: 'us', role: 'CB', x: 18, y: 30, orientation: 'FACING' },
        { id: 'us-cm', side: 'us', role: 'CM', x: 45, y: 34, orientation: 'AWAY' },
        { id: 'opp-gk', side: 'opp', role: 'GK', x: 100, y: 34, orientation: 'AWAY' },
        { id: 'opp-cb', side: 'opp', role: 'CB', x: 85, y: 30, orientation: 'AWAY' },
        { id: 'opp-cm', side: 'opp', role: 'CM', x: 60, y: 40, orientation: 'AWAY' },
      ],
    },
  };
}

console.log('=== 소유권 어댑터 테스트 (Phase 2b) ===\n');

// [1] 턴오버 적용 — 소유/점유자/페이즈 갱신 + 결정상태 정리 + 볼 동기화
const e = makeEngine('us');
const applied = applyPossessionEvent(e, 'turnover');
ok(applied && applied.possession === 'opp', '적용된 descriptor 반환(opp)');
ok(e.state.possession === 'opp', 'state.possession = opp');
ok(e.state.holderId === 'opp-gk', 'state.holderId = opp 최후방 빌더');
ok(e.state.phase === 'BUILDUP', 'state.phase = BUILDUP');
ok(e.state.matchDecision === null && e.state.transition === null && e.state.defensivePress === null, '진행 중 결정/전환/압박 창 정리');
ok(e.state.ball.x === 100 && e.state.ball.y === 34, '볼이 새 점유자 발밑으로 동기화');
ok(e.state.players.find((p) => p.id === 'opp-gk').orientation === 'FACING', '새 점유자는 전방을 향함');

// [2] 가드 — 존재하지 않는 점유자면 적용하지 않고 state 불변
const e2 = makeEngine('us');
const before = JSON.stringify(e2.state);
const bad = applyPossession(e2, { possession: 'opp', holderId: 'ghost', phase: 'BUILDUP' });
ok(bad === null, '없는 선수 점유자 → null');
ok(JSON.stringify(e2.state) === before, '실패 시 state 불변');

// [3] 가드 — 잘못된 입력
ok(applyPossession(null, { holderId: 'x' }) === null, 'engine 없음 → null');
ok(applyPossession(makeEngine(), null) === null, 'transition 없음 → null');
ok(applyPossessionEvent(makeEngine(), 'unknown') === null, '미지 이벤트 → null');

// [4] 왕복 — 턴오버 두 번이면 소유가 us 로 복귀
const e3 = makeEngine('us');
applyPossessionEvent(e3, 'turnover');   // → opp
applyPossessionEvent(e3, 'turnover');   // → us
ok(e3.state.possession === 'us', '턴오버 × 2 → us 복귀');
ok(e3.state.holderId === 'us-gk', '복귀 시 us 최후방 빌더');

// [5] 리셋/리게인도 동일 경로로 적용됨
const e4 = makeEngine('us');
applyPossessionEvent(e4, 'reset');
ok(e4.state.possession === 'us' && e4.state.holderId === 'us-gk', '리셋: us GK로 적용');

const e5 = makeEngine('opp', 'opp-cb');  // 우리가 압박 중(상대 점유)
applyPossessionEvent(e5, 'press_regain', { at: { x: 80, y: 30 } });
ok(e5.state.possession === 'us', '리게인: us 점유로 적용');

// [6] 상대 빌드업 한 수 — dry-run best 를 실제 opp holder 로 적용
const eBuild = makeEngine('us');
applyPossessionEvent(eBuild, 'turnover');
const beforeX = eBuild.state.players.find((p) => p.id === eBuild.state.holderId).x;
const buildStep = applyOpponentBuildStep(eBuild);
const afterHolder = eBuild.state.players.find((p) => p.id === eBuild.state.holderId);
ok(buildStep?.ok && buildStep.action === 'opp_to_feet', '상대 빌드업 한 수 적용');
ok(afterHolder.side === 'opp', '상대 빌드업: 새 holder 는 opp');
ok(afterHolder.x < beforeX, '상대 빌드업: -x 방향으로 전진');
ok(eBuild.state.ball.x === afterHolder.x && eBuild.state.ball.y === afterHolder.y, '상대 빌드업: 볼 동기화');
ok(applyOpponentBuildStep(makeEngine('us')) === null, 'us 점유에서는 상대 빌드업 적용 안 함');

const eRepeat = makeEngine('us');
applyPossessionEvent(eRepeat, 'turnover');
const repeated = [];
for (let i = 0; i < 8; i++) {
  const result = applyOpponentBuildStep(eRepeat);
  repeated.push(result);
  if (!result?.ok) break;
}
ok(repeated.filter((r) => r?.ok).length >= 1, '반복 상대 빌드업: 적어도 한 수 전진');
ok(repeated.some((r) => !r?.ok), '반복 상대 빌드업: 전진 없는 반복은 안전 중단');
const stalled = repeated.find((r) => r?.stalled);
ok(!stalled || stalled.at?.x != null, 'stalled 결과는 리게인 지점 포함');

// [7] resolvePossession 과 일관 — 어댑터는 그 결과를 그대로 반영
const e6 = makeEngine('us');
const want = resolvePossession(e6.state, 'turnover');
const got = applyPossessionEvent(makeEngine('us'), 'turnover');
ok(got.holderId === want.holderId && got.possession === want.possession, 'FSM 결과와 어댑터 적용 일치');

console.log(fail === 0 ? '\n소유권 어댑터 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
