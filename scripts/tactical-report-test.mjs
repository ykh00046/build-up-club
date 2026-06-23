import { buildTacticalReport } from '../js/engine/report.js';
import { createTacticalState } from '../js/engine/tactics.js';

let fail = 0;
const ok = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗ FAIL —'} ${message}`);
  if (!condition) fail++;
};

function makeState(overrides = {}) {
  return {
    ...createTacticalState(),
    turn: 7,
    lineIntents: { front: 'pin', mid: 'between', back: 'hold' },
    facts: {
      baits: 1, linesBroken: 1, switches: 0, windowsUsed: 0, runs: 0,
      situationsTriggered: 0, situationsResolved: 0, decisionsMade: 0,
    },
    ...overrides,
  };
}

console.log('=== 전술 결과 리포트 ===\n');

let report = buildTacticalReport(makeState(), { tone: 'near', xg: 0.31, zoneId: 'cutback' });
ok(report.worked.includes('라인'), '전진 사실을 잘 먹힌 전술로 설명');
ok(report.decisive.includes('xG 31%'), '결정적 장면에 xG 반영');
ok(report.next.includes('찬스'), '근접 실패에는 마무리 추천 제공');

report = buildTacticalReport(makeState({
  adaptRead: 'switch',
  actionHistory: ['switch', 'switch', 'switch'],
}), { tone: 'fail' });
ok(report.read.includes('전환'), '읽힌 반복 액션을 리포트에 표시');
ok(report.next.includes('전환'), '다음 경기 추천이 읽힌 액션 회피로 연결');

report = buildTacticalReport(makeState({
  facts: { situationsResolved: 1, linesBroken: 0 },
}), { tone: 'goal' });
ok(report.worked.includes('상황 대응'), '상황 해결을 성공 원인으로 표시');

console.log(fail === 0 ? '\n✅ 전술 리포트 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
