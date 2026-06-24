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

// ── E2: 결과 지표 언어화 (패킹·xT·xG·지배력) ──
const m = buildTacticalReport(makeState({
  facts: { baits: 2, linesBroken: 3, switches: 1, windowsUsed: 1, runs: 2, situationsResolved: 1, decisionsMade: 1 },
}), { tone: 'goal', xg: 0.42 }).metrics;
ok(m && m.packing === 3, 'E2: 패킹 = 라인 브레이킹 수(linesBroken)');
ok(m.xg === 42, 'E2: xG는 outcome.xg를 % 정수로');
ok(m.xt >= 0 && m.xt <= 100, 'E2: xT 지수 0~100 범위');
ok(m.dominance >= 0 && m.dominance <= 100, 'E2: 지배력 0~100 범위');
const mLow = buildTacticalReport(makeState({ facts: { linesBroken: 0, baits: 0 } }), { tone: 'fail' }).metrics;
ok(m.xt > mLow.xt && m.dominance > mLow.dominance, 'E2: 전진 많을수록 xT·지배력 증가(단조)');
const mNoXg = buildTacticalReport(makeState(), { tone: 'fail' }).metrics;
ok(mNoXg.xg === null, 'E2: 슛 없으면 xG=null(안전)');

console.log(fail === 0 ? '\n✅ 전술 리포트 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
