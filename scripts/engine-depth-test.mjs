import {
  applyMatchDecision, createTacticalState, prepareSituations, tacticalFactors,
  tacticalRiskMultiplier, updateTacticalState,
} from '../js/engine/tactics.js';

let fail = 0;
const ok = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗ FAIL —'} ${message}`);
  if (!condition) fail++;
};
function makeState() {
  return {
    ...createTacticalState(), turn: 0, pressure: 22,
    lineIntents: { front: 'pin', mid: 'between', back: 'hold' },
    facts: { switches: 0 },
  };
}

console.log('=== 전술 깊이·경기 상황 ===\n');

let state = makeState();
const base = tacticalRiskMultiplier(state, 'to_feet');
state.actionHistory = ['to_feet', 'to_feet', 'to_feet'];
const repeated = tacticalRiskMultiplier(state, 'to_feet');
ok(repeated > base, `같은 패턴 3회 반복 시 위험 증가 (${base.toFixed(2)} → ${repeated.toFixed(2)})`);

state = makeState();
const freshRun = tacticalRiskMultiplier(state, 'into_space');
state.fatigue = 100;
ok(tacticalRiskMultiplier(state, 'into_space') > freshRun, '피로가 공격적 행동의 위험을 높임');
ok(tacticalRiskMultiplier(state, 'to_feet') === tacticalRiskMultiplier({ ...state, fatigue: 0 }, 'to_feet'), '피로는 안전 연결에 영향을 주지 않음');

state = makeState();
state.lineIntents.front = 'drop';
ok(tacticalRiskMultiplier(state, 'bounce') < 1, '내려와 연결은 원투에 유리');
ok(tacticalRiskMultiplier(state, 'into_space') > 1, '내려와 연결은 즉시 침투에 불리');
ok(tacticalFactors(state, 'bounce').some((f) => f.id === 'front_drop'), '결과 설명용 전술 근거를 제공');

state = makeState();
state.scenario = { scheme: 'man' };
ok(tacticalRiskMultiplier(state, 'third_man') < 1, '대인 압박은 써드맨/원투에 취약');
state = makeState();
state.scenario = { scheme: 'zonal' };
ok(tacticalRiskMultiplier(state, 'switch') < 1, '지역 블록은 빠른 전환에 취약');
state = makeState();
state.scenario = { scheme: 'gegen' };
ok(tacticalRiskMultiplier(state, 'hold') > 1, '게겐프레스는 지연/운반을 더 강하게 압박');

state = makeState();
for (let i = 0; i < 3; i++) updateTacticalState(state, 'switch', true);
ok(state.adaptRead === 'switch', '세 번째 전환부터 상대 적응 경고');
const beforeFailure = state.momentum;
updateTacticalState(state, 'switch', false);
ok(state.momentum < beforeFailure, '실패 시 모멘텀 감소');

state = makeState();
state.pressure = 70; state.turn = 5;
let events = prepareSituations(state, 'hold');
ok(events.some((e) => e.situation.id === 'pressure_surge'), '압박 65 이상에서 상대 압박 강화 발생');
ok(tacticalRiskMultiplier(state, 'hold') > 1, '압박 강화 중 기다리기 위험 증가');
events = updateTacticalState(state, 'bounce', true);
ok(events.some((e) => e.situation.id === 'pressure_surge'), '원투 성공으로 압박 강화 상황 해결');

state = makeState();
state.facts.switches = 2; state.turn = 6;
prepareSituations(state, 'switch');
ok(state.situations.active.some((s) => s.id === 'flank_lock'), '전환 2회 후 측면 봉쇄 발생');
ok(tacticalFactors(state, 'switch').some((f) => f.id === 'flank_lock'), '측면 봉쇄가 추가 전환 위험에 반영');

state = makeState();
state.lineIntents.back = 'overlap'; state.turn = 2;
prepareSituations(state, 'into_space');
ok(state.situations.active.some((s) => s.id === 'counter_risk'), '풀백 전진 상태의 공격적 선택에서 역습 경고 발생');

state = makeState();
state.turn = 3; state.pressure = 58;
events = prepareSituations(state, 'hold');
ok(events.some((e) => e.type === 'decision'), '압박 중반부터 선택형 템포 상황 발생');
const beforePressure = state.pressure;
const decision = applyMatchDecision(state, 'reset');
ok(decision && state.pressure < beforePressure, '리셋 선택은 압박을 낮춤');

state = makeState();
state.turn = 3; state.pressure = 58;
prepareSituations(state, 'hold');
applyMatchDecision(state, 'accelerate');
ok(tacticalFactors(state, 'into_space').some((f) => f.id === 'decision_boost'), '바로 전진 선택은 다음 전진 액션 위험을 낮춤');

state = makeState();
state.facts.switches = 2; state.turn = 6;
prepareSituations(state, 'switch');
prepareSituations(state, 'to_feet');
ok(state.matchDecision?.id === 'flank_lock_choice', '측면 봉쇄 후 대응 선택 발생');
applyMatchDecision(state, 'central_combo');
ok(tacticalFactors(state, 'third_man').some((f) => f.id === 'decision_boost'), '중앙 조합 선택은 써드맨/원투를 강화');

state = makeState();
state.lineIntents.back = 'overlap'; state.turn = 4;
prepareSituations(state, 'into_space');
prepareSituations(state, 'to_feet');
ok(state.matchDecision?.id === 'counter_choice', '역습 경고 후 후방 균형 선택 발생');
applyMatchDecision(state, 'secure_back');
ok(state.lineIntents.back === 'hold', '후방 안정 선택은 풀백을 후방 안정으로 전환');

console.log(fail === 0 ? '\n✅ 전술 깊이·상황 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
