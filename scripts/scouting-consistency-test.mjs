// 상대 스카우팅 메타데이터 ↔ 엔진 일관성 검증.
// design-direction.md §5.4 / roadmap-plan.md §4-P1 완료기준:
//   "브리핑 추천과 실제 엔진 보정이 일치한다."
// 각 scheme 의 recommendActions 는 엔진에서 유리(≤ 1.0), cautionActions 는
// 불리(≥ 1.0)해야 한다. 일치하지 않으면 플레이어에게 거짓 안내가 된다.

import { tacticalRiskMultiplier } from '../js/engine/tactics.js';
import { SCOUTING, getScouting } from '../js/data/scouting.js';
import { SCENARIOS, getScenario } from '../js/data/scenarios.js';

let fail = 0;
const ok = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗ FAIL'} ${message}`);
  if (!condition) fail++;
};

// scheme factor 만 격리: momentum=50(±0 factor), fatigue=0, 빈 히스토리,
// 어떤 lineIntent factor 도 터지지 않는 의도값.
function cleanState(scheme) {
  return {
    momentum: 50,
    fatigue: 0,
    actionHistory: [],
    currentAction: null,
    adaptRead: null,
    situations: { active: [], seen: {}, resolved: [] },
    lastTacticalFactors: [],
    matchDecision: null,
    decisionBoost: null,
    trainingEffects: [],
    lineIntents: { front: 'pin', mid: 'level', back: 'hold' },
    scenario: { scheme },
  };
}

console.log('=== 상대 스카우팅 ↔ 엔진 일관성 ===\n');

const baseRisk = tacticalRiskMultiplier(cleanState('man'), 'to_feet');
ok(Math.abs(baseRisk - 1) < 0.001, `격리 상태 기준 위험도 = 1.0 (실제 ${baseRisk.toFixed(3)})`);

const schemes = ['man', 'zonal', 'gegen', 'hybrid', 'midblock', 'lowblock'];
for (const scheme of schemes) {
  const meta = getScouting(scheme);
  ok(meta !== null, `${scheme}: 스카우팅 메타데이터 존재`);
  ok(typeof meta.style === 'string' && meta.style.length > 0, `${scheme}: 성향(style) 문구 있음`);
  ok(typeof meta.weakness === 'string' && meta.weakness.length > 0, `${scheme}: 약점(weakness) 문구 있음`);
  ok(Array.isArray(meta.recommendActions) && meta.recommendActions.length > 0, `${scheme}: 추천 행동 1개 이상`);
  ok(Array.isArray(meta.cautionActions), `${scheme}: 주의 행동 배열 정의됨`);

  const state = cleanState(scheme);
  for (const actionId of meta.recommendActions) {
    const risk = tacticalRiskMultiplier(state, actionId);
    ok(risk <= 1.0, `${scheme}: 추천 ${actionId} 가 엔진에서 유리 (위험도 ${risk.toFixed(3)} ≤ 1.0)`);
  }
  for (const actionId of meta.cautionActions) {
    const risk = tacticalRiskMultiplier(state, actionId);
    ok(risk >= 1.0, `${scheme}: 주의 ${actionId} 가 엔진에서 불리 (위험도 ${risk.toFixed(3)} ≥ 1.0)`);
  }
}

const lookupSchemes = ['man', 'zonal', 'gegen', 'hybrid', 'midblock', 'lowblock', 'unknown'];
ok(getScouting('unknown') === null, '알 수 없는 scheme 은 null 반환');
ok(lookupSchemes.filter((s) => SCOUTING[s]).length === 6, 'SCOUTING 은 6종 scheme 포함(미드블록·로우블록 추가)');

// ── E9: 모든 scheme 에 압박 덫(trap) 서술이 채워짐 ──
for (const s of ['man', 'zonal', 'gegen', 'hybrid', 'midblock', 'lowblock']) {
  ok(typeof SCOUTING[s].trap === 'string' && SCOUTING[s].trap.length > 10, `E9: ${s} 압박 덫 서술 존재`);
}

// ── 모든 시나리오 셀의 scheme 이 SCOUTING 키와 일치 (E1/E2 포함) ──
const cells = Object.keys(SCENARIOS);
ok(cells.includes('E1') && cells.includes('E2'), `신규 셀 E1, E2 정의됨 (현재 ${cells.length}개 셀)`);
ok(getScenario('E1') !== null && getScenario('E1').cell === 'E1', 'getScenario("E1") 조회');
ok(getScenario('E2') !== null && getScenario('E2').cell === 'E2', 'getScenario("E2") 조회');
for (const cell of cells) {
  const scn = SCENARIOS[cell];
  ok(SCOUTING[scn.scheme] != null, `${cell}: scheme "${scn.scheme}" 가 SCOUTING 키와 일치`);
  ok(typeof scn.buildOurs === 'function' && typeof scn.buildOpp === 'function', `${cell}: buildOurs/buildOpp 함수 정의`);
  ok(scn.briefing && scn.oppPlan && scn.primaryEdge && scn.hint && scn.targetShot, `${cell}: 핵심 필드 채워짐`);
}

console.log(fail === 0 ? '\n✅ 스카우팅 일관성 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
