// Phase 2b 엔진 연결 회귀 — 호출 지점 하나만 검증한다.
// possessionTurnoverLoop 옵션이 켜진 경우에만 카운터프레스 후퇴/실패가 시도 종료 대신
// 상대 소유 빌드업으로 전환된다. 기본 엔진 경로는 기존처럼 종료된다.

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };

function openSyntheticTurnover(engine) {
  engine.state.transition = {
    kind: 'intercepted',
    detail: {},
    loss: { x: 42, y: 34 },
    msLeft: 5000,
    regainP: 0,
  };
  engine.state.matchDecision = {
    id: 'transition',
    choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }],
  };
}

console.log('=== 소유권 엔진 연결 테스트 (Phase 2b) ===\n');

const defaultEngine = createEngine(getScenario('A1'), 301);
openSyntheticTurnover(defaultEngine);
const defaultResult = defaultEngine.chooseSituationOption('cp_retreat');
ok(defaultResult.ok && defaultResult.recovered === false, '기본 경로: cp_retreat 처리');
ok(defaultEngine.state.status === 'over', '기본 경로: 기존처럼 시도 종료');
ok(defaultEngine.state.outcome?.kind === 'intercepted', '기본 경로: 기존 outcome 유지');
ok(defaultEngine.advanceOpponentBuildUp?.().rejected === true, '기본 경로: 상대 빌드업 전개 메서드 비활성');

const loopEngine = createEngine(getScenario('A1'), 302, { possessionTurnoverLoop: true });
openSyntheticTurnover(loopEngine);
const loopResult = loopEngine.chooseSituationOption('cp_retreat');
ok(loopResult.ok && loopResult.turnover?.possession === 'opp', '옵션 경로: turnover descriptor 반환');
ok(loopEngine.state.status === 'live', '옵션 경로: 시도 종료 대신 live 유지');
ok(loopEngine.state.outcome === null, '옵션 경로: outcome 생성 안 함');
ok(loopEngine.state.possession === 'opp', '옵션 경로: 상대 소유로 전환');
ok(loopEngine.holder()?.side === 'opp', '옵션 경로: 실제 holder 도 상대 선수');
ok(loopEngine.state.phase === 'BUILDUP', '옵션 경로: 상대 빌드업으로 재시작');
ok(loopEngine.state.matchDecision === null && loopEngine.state.transition === null, '옵션 경로: 전환 결정창 정리');

const beforeHolder = loopEngine.holder();
const step = loopEngine.advanceOpponentBuildUp();
ok(step.ok && step.action === 'opp_to_feet', '옵션 경로: 상대 빌드업 한 수 실행');
ok(loopEngine.holder()?.side === 'opp', '상대 빌드업: holder 는 계속 상대');
ok(loopEngine.holder()?.id === step.targetId, '상대 빌드업: dry-run best 대상이 새 holder');
ok(loopEngine.holder()?.x < beforeHolder.x, '상대 빌드업: 상대 공격 방향(-x)으로 전진');
const ball = loopEngine.ballPos();
ok(ball.x === loopEngine.holder().x && ball.y === loopEngine.holder().y, '상대 빌드업: 볼 위치 동기화');

const repeatEngine = createEngine(getScenario('A1'), 303, { possessionTurnoverLoop: true });
openSyntheticTurnover(repeatEngine);
repeatEngine.chooseSituationOption('cp_retreat');
const repeated = [];
for (let i = 0; i < 8; i++) {
  const result = repeatEngine.advanceOpponentBuildUp();
  repeated.push(result);
  if (!result.ok || result.regained) break;
}
ok(repeated.filter((r) => r.ok).length >= 2, '반복 상대 빌드업: 최소 2수 전진');
ok(repeated.some((r) => r.stalled && r.regained), '반복 상대 빌드업: 정체 시 우리 리게인으로 전환');
ok(repeated.filter((r) => r.ok).every((r) => r.progress >= 1), '반복 상대 빌드업: 성공 수는 모두 전진성 보유');
ok(repeatEngine.state.possession === 'us' && repeatEngine.holder()?.side === 'us', '반복 상대 빌드업: 리게인 후 우리 소유');

const diversePaths = new Set();
for (let seed = 4000; seed < 4040; seed++) {
  const diverseEngine = createEngine(getScenario('A1'), seed, {
    possessionTurnoverLoop: true,
    opponentBuildDisposition: 'aggressive',
  });
  openSyntheticTurnover(diverseEngine);
  diverseEngine.chooseSituationOption('cp_retreat');
  const path = [];
  for (let i = 0; i < 8 && diverseEngine.state.possession === 'opp'; i++) {
    const result = diverseEngine.advanceOpponentBuildUp();
    path.push(result?.ok ? `${result.fromId}->${result.targetId}` : result?.stalled ? 'stalled' : 'stop');
    if (!result?.ok || result.regained) break;
  }
  diversePaths.add(path.join('|'));
}
ok(diversePaths.size >= 2, `상대 성향 옵션: aggressive 루트 다양화 (${diversePaths.size}종)`);

console.log(fail === 0 ? '\n소유권 엔진 연결 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
