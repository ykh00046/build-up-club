import { buildTacticalReport } from '../js/engine/report.js';
import { createTacticalState } from '../js/engine/tactics.js';
import { resolveScoreline } from '../js/career/mods.js';

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
  adaptRead: 'pass_space',
  actionHistory: ['pass_space', 'pass_space', 'pass_space'],
}), { tone: 'fail' });
ok(report.read.includes('공간 패스'), '읽힌 반복 액션을 리포트에 표시');
ok(report.next.includes('공간 패스'), '다음 경기 추천이 읽힌 액션 회피로 연결');

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

// ── E3: 3대 우위 분류 + 오버로드-투-아이솔레이트 보너스 ──
const supQual = buildTacticalReport(makeState({ facts: { baits: 2, switches: 1 } }), { tone: 'goal' }).superiority;
ok(supQual.includes('질적'), 'E3: 유인2+전환 → 질적 우위로 분류');
const supPos = buildTacticalReport(makeState({ facts: { linesBroken: 2, baits: 0, switches: 0 } }), { tone: 'goal' }).superiority;
ok(supPos.includes('위치'), 'E3: 라인 돌파 → 위치 우위로 분류');
const supNone = buildTacticalReport(makeState({ facts: { baits: 0, linesBroken: 0, switches: 0, runs: 0, windowsUsed: 0, situationsResolved: 0 } }), { tone: 'fail' }).superiority;
ok(supNone.includes('못'), 'E3: 무행동 → 우위 없음으로 분류');
// 오버로드→전환 고립이 스코어라인 exec를 끌어올려 평균 득점이 증가(단조)
const NM = { execMul: 1, xgMul: 1, concedeMul: 1, secondGoalBonus: 0, failConcedeRelief: 0 };
function ourGoals(perf, n = 6000) {
  let g = 0, seed = 11;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const setup = { atk: 110, def: 110, oppOVR: 200, trainingScore: {} };
  for (let i = 0; i < n; i++) g += resolveScoreline(perf, setup, rng, NM).ourGoals;
  return g / n;
}
const withIso = ourGoals({ tone: 'goal', xg: 0.3, baits: 2, switches: 1 });
const noIso = ourGoals({ tone: 'goal', xg: 0.3, baits: 1, switches: 0 });
ok(withIso > noIso, `E3: 오버로드→전환 고립이 득점 기여 증가 (${noIso.toFixed(3)}→${withIso.toFixed(3)})`);

// ── E1: 수비 전환 노출 읽기 + 카운터프레스 회복 ──
const tGoal = buildTacticalReport(makeState(), { tone: 'goal', xg: 0.4 }).transition;
ok(tGoal.includes('안정'), 'E1: 마무리 도달 → 전환 안정');
const tCtrl = buildTacticalReport(makeState({ facts: { situationsResolved: 1, linesBroken: 2 } }), { tone: 'fail' }).transition;
ok(tCtrl.includes('중간'), 'E1: 통제된 상실 → 전환 노출 중간(회복 가능)');
const tExpo = buildTacticalReport(makeState({ facts: { situationsResolved: 0, linesBroken: 0 }, lineIntents: { back: 'overlap' } }), { tone: 'fail' }).transition;
ok(tExpo.includes('높음'), 'E1: 무리한 전개 + 상실 → 전환 노출 높음');
// 카운터프레스 회복: 같은 실패라도 지배력↑이면 실점↓ (통제된 상실)
function conc(dominanceHigh) {
  let g = 0, seed = 5;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  // linesBroken/situations로 dominance를 끌어올려 통제된 상실을 모사
  const perf = dominanceHigh
    ? { tone: 'fail', linesBroken: 4, situationsResolved: 2, windowsUsed: 2 }
    : { tone: 'fail', linesBroken: 0 };
  const setup = { atk: 60, def: 100, oppOVR: 260, trainingScore: {} };
  for (let i = 0; i < 8000; i++) g += resolveScoreline(perf, setup, rng, NM).oppGoals;
  return g / 8000;
}
ok(conc(true) < conc(false), `E1: 통제된 상실(지배력↑)이 역습 실점↓ (${conc(true).toFixed(3)} < ${conc(false).toFixed(3)})`);

console.log(fail === 0 ? '\n✅ 전술 리포트 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
