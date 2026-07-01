// Phase 2 소유권 전환 FSM 회귀 — docs/symmetric-duel-design.md.
// engine.js 미import → 샌드박스 실행 가능. 전환 후 누가/어디서 빌드업하는지를 고정한다.

import { resolvePossession, deepestBuilder, goalkeeper, attackDir } from '../js/engine/possession.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };

// us 는 +x 공격(낮은 x에서 빌드업), opp 는 -x 공격(높은 x에서 빌드업).
function makeState(possession = 'us', holderId = 'us-cm') {
  return {
    status: 'live', possession, holderId,
    players: [
      { id: 'us-gk', side: 'us', role: 'GK', x: 5, y: 34 },
      { id: 'us-cb', side: 'us', role: 'CB', x: 18, y: 30 },
      { id: 'us-cm', side: 'us', role: 'CM', x: 45, y: 34 },
      { id: 'opp-gk', side: 'opp', role: 'GK', x: 100, y: 34 },
      { id: 'opp-cb', side: 'opp', role: 'CB', x: 85, y: 30 },
      { id: 'opp-cm', side: 'opp', role: 'CM', x: 60, y: 40 },
    ],
  };
}

console.log('=== 소유권 전환 FSM 테스트 (Phase 2) ===\n');

// [1] 방향·최후방 빌더
ok(attackDir('us') === 1 && attackDir('opp') === -1, '공격 방향 us=+x, opp=-x');
const s = makeState();
ok(deepestBuilder(s.players, 'us').id === 'us-gk', 'us 최후방 빌더 = 최소 x(GK)');
ok(deepestBuilder(s.players, 'opp').id === 'opp-gk', 'opp 최후방 빌더 = 최대 x(GK)');
ok(deepestBuilder(s.players, 'us', { includeGk: false }).id === 'us-cb', 'GK 제외 시 us 최후방 = CB');

// [2] 턴오버 — 소유 플립 + 상대 최후방부터 + mirror 플래그
const t = resolvePossession(makeState('us'), 'turnover');
ok(t.possession === 'opp', '턴오버: us→opp 소유 플립');
ok(t.holderId === 'opp-gk', '턴오버: 새 점유자 = opp 최후방 빌더');
ok(t.phase === 'BUILDUP', '턴오버: 빌드업으로 재시작');
ok(t.mirror === true, '턴오버: opp 점유면 mirror=true (엔진은 미러로 빌드업)');
const t2 = resolvePossession(makeState('opp', 'opp-cm'), 'turnover');
ok(t2.possession === 'us' && t2.holderId === 'us-gk' && t2.mirror === false, '턴오버: opp→us, mirror=false');

// [3] 왕복 불변 — 턴오버 두 번이면 원래 소유로
const once = resolvePossession(makeState('us'), 'turnover');
const twice = resolvePossession({ ...makeState('us'), possession: once.possession }, 'turnover');
ok(twice.possession === 'us', '턴오버 × 2 = 원래 소유 복귀');

// [4] 리셋 — 현재 점유 측 GK
const r = resolvePossession(makeState('us'), 'reset');
ok(r.possession === 'us' && r.holderId === 'us-gk', '리셋: 현재 측 GK로');

// [5] 압박 성공 — 압박 측(us) 점유, 회복 지점 근처 선수
const pressState = makeState('opp', 'opp-cb');       // 상대가 점유(우리가 압박 중)
const reg = resolvePossession(pressState, 'press_regain', { at: { x: 80, y: 30 } });
ok(reg.possession === 'us', '리게인: 압박 측(us) 점유');
ok(reg.holderId === 'us-cm', '리게인: 회복 지점에서 가장 가까운 us 선수(CM)');
ok(reg.mirror === false, '리게인: us 점유면 mirror=false');

// [6] 재시작 — 지정 측 킥오프
const restart = resolvePossession(makeState('us'), 'restart', { side: 'opp' });
ok(restart.possession === 'opp' && restart.holderId === 'opp-gk', '재시작: 지정 측(opp) 킥오프');

// [7] 가드 + 읽기 전용
ok(resolvePossession(makeState('us'), 'unknown_event') === null, '미지 이벤트 → null');
ok(resolvePossession(null, 'turnover') === null, 'null state → null');
const before = JSON.stringify(makeState('us'));
const live = makeState('us');
resolvePossession(live, 'turnover');
ok(JSON.stringify(live) === before, 'FSM 은 state 를 변경하지 않음(읽기 전용)');

// [8] possession 미설정 시 holder 로 추론
const inferred = resolvePossession({ status: 'live', holderId: 'opp-cm', players: makeState().players }, 'turnover');
ok(inferred.possession === 'us', 'possession 미설정 시 holder side 로 추론(opp 점유 → 턴오버 → us)');

console.log(fail === 0 ? '\n소유권 전환 FSM 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
