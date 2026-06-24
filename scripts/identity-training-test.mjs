import {
  activeTrainingEffects, club, hardReset, normalizeState, settleMatch, tickEffects, recordCareerSnapshot,
} from '../js/career/club.js';
import { matchSetup, resolveScoreline } from '../js/career/mods.js';
import {
  addIdentityXp, applyTrainingChoice, identitySummary, inferIdentityFromMatch, trainingOptionsFromReport,
  updateIdentityStreak, addScenarioWin, dominantIdentityFromGains,
  identityLevel, IDENTITY_LEVEL_THRESHOLDS, IDENTITY_ACTIONS, activeIdentityLevel,
} from '../js/career/identity.js';
import { tacticalFactors, tacticalRiskMultiplier, createTacticalState } from '../js/engine/tactics.js';

let fail = 0;
const ok = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗ FAIL'} ${message}`);
  if (!condition) fail++;
};

console.log('=== 클럽 정체성·훈련 루프 ===\n');
hardReset();

addIdentityXp({ wing: 5, positional: 2 });
ok(identitySummary().id === 'wing', '가장 높은 XP가 클럽 정체성으로 표시');

const state = {
  facts: { linesBroken: 1, switches: 2, runs: 0, situationsResolved: 0, decisionsMade: 0 },
  actionHistory: ['switch', 'switch', 'to_feet'],
  lineIntents: { back: 'overlap' },
};
const gains = inferIdentityFromMatch(state, { tone: 'near' });
ok(gains.wing > gains.positional, '전환 중심 경기는 측면 전환형 XP를 더 많이 생성');

const options = trainingOptionsFromReport({ read: '전환 반복을 상대가 읽기 시작했습니다.', next: '전환을 자세히 쓰세요.' }, state);
ok(options.some((o) => o.id === 'wide_switch'), '전환이 읽힌 리포트는 전환/중앙 훈련을 제안');

const beforeMf = club.levels.mf;
const summary = applyTrainingChoice(options.find((o) => o.id === 'central_combo'));
ok(club.levels.mf === beforeMf + 1, '훈련 선택이 포지션 레벨을 올림');
ok(summary.id === 'positional' || club.identityXp.positional >= 4, '훈련 선택이 정체성 XP를 올림');
ok(activeTrainingEffects().some((e) => e.id === 'central_combo'), '훈련 선택이 다음 경기 전술 효과를 저장');

const setup = matchSetup(100);
ok(setup.trainingEffects.some((e) => e.id === 'central_combo'), '다음 경기 셋업에 훈련 효과가 전달');
ok(setup.trainingScore.execAdd > 0, '훈련 효과가 스코어라인 수행 보정으로 집계');

const withoutTraining = { ...setup, trainingScore: { execAdd: 0, xgMul: 1, concedeMul: 1 } };
const trainedScore = resolveScoreline({ tone: 'near', decisionsMade: 1, xg: 0.2 }, setup, () => 0.99);
const baseScore = resolveScoreline({ tone: 'near', decisionsMade: 1, xg: 0.2 }, withoutTraining, () => 0.99);
ok(trainedScore.exec > baseScore.exec, '훈련 효과가 경기 수행 지표에 실제 반영');

club.matchday += 1;
tickEffects();
ok(!activeTrainingEffects().some((e) => e.id === 'central_combo'), '1경기 훈련 효과는 다음 경기 후 만료');

const migrated = normalizeState({ levels: { fw: 3 }, record: { w: 2 }, identityXp: { wing: 5 } });
ok(migrated.saveVersion >= 2, '구 저장 데이터에 saveVersion을 부여');
ok(migrated.levels.gk === 1 && migrated.levels.fw === 3, '누락된 포지션 레벨을 기본값으로 보정');
ok(Array.isArray(migrated.trainingEffects), '구 저장 데이터에 trainingEffects 배열을 추가');
ok(migrated.identityXp.wing === 5 && migrated.identityXp.positional === 0, '정체성 XP 누락 키를 보정');

// ── nextEffect 도출: actions/score/multiplier → "다음 경기 효과" 텍스트 ──
// 4개 분기(전환/압박/마무리/기본) 각 2옵션 = 8종 전부 nextEffect 가 도출되고,
// actions/score 종류에 맞는 키워드(위험도↓/수행 +/xG ×/실점 ×)를 포함해야 한다.
hardReset();
const branches = [
  { report: { read: '전환 반복 읽힘', next: '전환 자세히' }, facts: { switches: 2 } },
  { report: { read: '압박 상황 누적', next: '탈출 강화' }, facts: { situationsResolved: 1 } },
  { report: { read: '마무리 부족', next: '침투 마무리', decisive: 'xG 0.4' }, facts: {} },
  { report: { read: '', next: '' }, facts: {} },
];
const allOptions = branches.flatMap((b) => trainingOptionsFromReport(b.report, { facts: b.facts }));

let nextOk = 0;
for (const opt of allOptions) {
  if (typeof opt.nextEffect !== 'string' || opt.nextEffect.length === 0) { ok(false, `${opt.id}: nextEffect 도출됨`); continue; }
  const expectAct = (opt.actions || []).length > 0;
  const expectExec = (opt.score && opt.score.execAdd > 0);
  const expectXg = (opt.score && opt.score.xgMul > 1);
  const expectConc = (opt.score && opt.score.concedeMul < 1);
  const valid = (!expectAct || opt.nextEffect.includes('위험도 ↓'))
    && (!expectExec || opt.nextEffect.includes('수행 +'))
    && (!expectXg || opt.nextEffect.includes('xG ×'))
    && (!expectConc || opt.nextEffect.includes('실점 ×'));
  ok(valid, `${opt.id}: nextEffect "${opt.nextEffect}" 가 actions/score 매핑과 일치`);
  if (valid) nextOk++;
}
ok(nextOk === allOptions.length, `모든 훈련 옵션(${allOptions.length}종) nextEffect 도출 일관`);

// effect.nextEffect 저장 — applyTrainingChoice 후 활성 effect 에 라벨이 남는지
hardReset();
const effOpts = trainingOptionsFromReport({ read: '전환 반복 읽힘', next: '' }, { facts: { switches: 2 } });
const pick = effOpts.find((o) => o.id === 'central_combo');
applyTrainingChoice(pick);
const stored = activeTrainingEffects().find((e) => e.id === 'central_combo');
ok(stored && typeof stored.nextEffect === 'string' && stored.nextEffect === pick.nextEffect,
   `effect.nextEffect 저장 ("${stored?.nextEffect}" === 옵션 nextEffect)`);
ok(stored.nextEffect.includes('원투') && stored.nextEffect.includes('수행 +'),
   `central_combo nextEffect 내용 점검 ("${stored?.nextEffect}")`);

// ── careerHistory (roadmap 고도화: 커리어 히스토리 차트) ──
hardReset();
ok(Array.isArray(club.careerHistory) && club.careerHistory.length === 0, 'freshState: careerHistory 빈 배열');
// settleMatch + points 갱신 후 recordCareerSnapshot 호출 시 스냅샷 push
settleMatch('w'); club.points += 3; recordCareerSnapshot();
ok(club.careerHistory.length === 1, '매치 종료 후 스냅샷 1개 push');
ok(club.careerHistory[0].matchday === 1 && club.careerHistory[0].points === 3, `스냅샷1 matchday=1, points=3 (${club.careerHistory[0].points})`);
ok(typeof club.careerHistory[0].identityXp === 'object', '스냅샷1 identityXp 객체 포함');
settleMatch('d'); club.points += 1; recordCareerSnapshot();
ok(club.careerHistory.length === 2, '2경기 후 스냅샷 2개');
ok(club.careerHistory[1].matchday === 2 && club.careerHistory[1].points === 4, '스냅샷2 matchday=2, points=4');
// identityXp 스냅샷이 시점별로 독립
club.identityXp.positional = 10;
recordCareerSnapshot();
ok(club.careerHistory[2].identityXp.positional === 10, '스냅샷3 시점 identityXp 기록 (positional=10)');
club.identityXp.positional = 50;
ok(club.careerHistory[2].identityXp.positional === 10, '이후 XP 변화가 이전 스냅샷에 영향 없음 (불변 사본)');
// 마이그레이션: saveVersion 3 → 4, careerHistory 보정
const migHist = normalizeState({ saveVersion: 3, levels: { fw: 3 } });
ok(migHist.saveVersion === 6, "구 저장(saveVersion 3) → 6 갱신");
ok(Array.isArray(migHist.careerHistory) && migHist.careerHistory.length === 0, '마이그레이션: careerHistory 빈 배열 보정');
// 부분 마이그레이션: 기존 히스토리 보존 (최근 50)
const migHist2 = normalizeState({ careerHistory: [{ matchday: 1, points: 3 }, { matchday: 2, points: 4 }] });
ok(migHist2.careerHistory.length === 2 && migHist2.careerHistory[1].matchday === 2, '기존 히스토리 보존');

// ── firstPlay (roadmap 고도화: 온보딩 튜토리얼) ──
hardReset();
ok(club.firstPlay === true, 'freshState: firstPlay=true (신규 세이브)');
// firstPlay=false 저장 후 normalizeState 보존
const migFirst = normalizeState({ firstPlay: false, levels: { fw: 3 } });
ok(migFirst.firstPlay === false, 'firstPlay=false 보존');
// 구 저장(firstPlay 없음) → true 보정
const migFirstOld = normalizeState({ saveVersion: 4, levels: { fw: 3 } });
ok(migFirstOld.firstPlay === true, '구 저장(firstPlay 누락) → true 보정');
ok(migFirstOld.saveVersion === 6, "구 저장(saveVersion 4) → 6 갱신");
// 명시적 falsy 값 처리
ok(normalizeState({ firstPlay: 0 }).firstPlay === false, 'firstPlay=0 → false (falsy 변환)');
ok(normalizeState({ firstPlay: 1 }).firstPlay === true, 'firstPlay=1 → true');

// ── 시즌 목표 추적: identityStreak / scenarioWins / 마이그레이션(saveVersion 3) ──
hardReset();
ok(club.identityStreak && club.identityStreak.id === null && club.identityStreak.count === 0, 'freshState: identityStreak 기본 {id:null,count:0}');
ok(club.scenarioWins && typeof club.scenarioWins === 'object', 'freshState: scenarioWins 빈 객체');
ok(club.seasonGoalsDone && typeof club.seasonGoalsDone === 'object', 'freshState: seasonGoalsDone 빈 객체');

// dominantIdentityFromGains — 최대값 정체성 추출
ok(dominantIdentityFromGains({ positional: 1, direct: 3, wing: 2, pressproof: 0 }) === 'direct', 'gains 최대값 정체성 추출');
ok(dominantIdentityFromGains({ positional: 0, direct: 0, wing: 0, pressproof: 0 }) === null, 'gains 전부 0 → null');

// updateIdentityStreak — 연속 누적 / 변경 시 리셋
updateIdentityStreak('wing');
ok(club.identityStreak.count === 1 && club.identityStreak.id === 'wing', '첫 streak: wing count=1');
updateIdentityStreak('wing');
ok(club.identityStreak.count === 2, '같은 정체성 연속: count=2');
updateIdentityStreak('positional');
ok(club.identityStreak.id === 'positional' && club.identityStreak.count === 1, '정체성 변경 시 리셋: positional count=1');
updateIdentityStreak(null);
ok(club.identityStreak.id === null && club.identityStreak.count === 0, '빈 gains → streak 리셋');

// addScenarioWin — 셀별 누적
addScenarioWin('B1');
addScenarioWin('B1');
addScenarioWin('C2');
ok(club.scenarioWins.B1 === 2, 'scenarioWins 셀별 누적 (B1=2)');
ok(club.scenarioWins.C2 === 1, 'scenarioWins 다른 셀 독립 (C2=1)');
ok(!club.scenarioWins.A1, 'scenarioWins 미호출 셀은 미존재');

// 마이그레이션: saveVersion 3 + 누락 필드 보정
const migrated2 = normalizeState({ saveVersion: 2, levels: { fw: 3 }, identityXp: { wing: 5 } });
ok(migrated2.saveVersion === 6, "구 저장(saveVersion 2) → 6 로 갱신");
ok(migrated2.identityStreak && migrated2.identityStreak.id === null && migrated2.identityStreak.count === 0, '마이그레이션: identityStreak 기본값 보정');
ok(migrated2.scenarioWins && typeof migrated2.scenarioWins === 'object' && Object.keys(migrated2.scenarioWins).length === 0, '마이그레이션: scenarioWins 빈 객체 보정');
ok(migrated2.seasonGoalsDone && Object.keys(migrated2.seasonGoalsDone).length === 0, '마이그레이션: seasonGoalsDone 빈 객체 보정');

// 부분 마이그레이션: identityStreak 일부만 있어도 보정
const migrated3 = normalizeState({ identityStreak: { id: 'wing' }, scenarioWins: { A1: 3 } });
ok(migrated3.identityStreak.id === 'wing' && migrated3.identityStreak.count === 0, '부분 마이그레이션: identityStreak.id 보존, count 보정');
ok(migrated3.scenarioWins.A1 === 3, '부분 마이그레이션: scenarioWins 보존');

// 레거시 철학 id 마이그레이션 — counter→direct, gegen→pressproof (Sprint 4 id 정합)
const migCounter = normalizeState({ philosophy: 'counter' });
ok(migCounter.philosophy === 'direct', '레거시 philosophy counter → direct');
const migGegen = normalizeState({ philosophy: 'gegen' });
ok(migGegen.philosophy === 'pressproof', '레거시 philosophy gegen → pressproof');
const migUnchanged = normalizeState({ philosophy: 'positional' });
ok(migUnchanged.philosophy === 'positional', '변경 없는 id(positional)는 보존');
const migNull = normalizeState({ philosophy: null });
ok(migNull.philosophy === null, 'philosophy null 은 그대로');

// ── 정체성 레벨 (roadmap P4) ──
ok(IDENTITY_LEVEL_THRESHOLDS.length === 4, '레벨 임계값 4종 (Lv1~4)');
ok(identityLevel(0) === 1, 'xp=0 → Lv1');
ok(identityLevel(7) === 1, 'xp=7 → Lv1 (임계 8 미만)');
ok(identityLevel(8) === 2, 'xp=8 → Lv2');
ok(identityLevel(19) === 2, 'xp=19 → Lv2');
ok(identityLevel(20) === 3, 'xp=20 → Lv3');
ok(identityLevel(39) === 3, 'xp=39 → Lv3');
ok(identityLevel(40) === 4, 'xp=40 → Lv4');
ok(identityLevel(100) === 4, 'xp=100 → Lv4 (상한)');
ok(identityLevel(-5) === 1, '음수 xp → Lv1 보정');

// IDENTITY_ACTIONS — 4종 정체성 관련 액션 정의
ok(Object.keys(IDENTITY_ACTIONS).length === 4, 'IDENTITY_ACTIONS 4종');
ok(IDENTITY_ACTIONS.positional.includes('bounce') && IDENTITY_ACTIONS.positional.includes('third_man'), 'positional 관련 액션: bounce/third_man');
ok(IDENTITY_ACTIONS.direct.includes('into_space'), 'direct 관련 액션: into_space');
ok(IDENTITY_ACTIONS.wing.includes('switch'), 'wing 관련 액션: switch');
ok(IDENTITY_ACTIONS.pressproof.includes('hold') && IDENTITY_ACTIONS.pressproof.includes('carry'), 'pressproof 관련 액션: hold/carry');

// activeIdentityLevel — club.philosophy + identityXp 기반
hardReset();
club.philosophy = 'positional';
ok(activeIdentityLevel() === null || activeIdentityLevel().level === 1, 'positional xp=0 → Lv1');
club.identityXp.positional = 20;
const ail = activeIdentityLevel();
ok(ail && ail.id === 'positional' && ail.level === 3 && ail.actions.includes('bounce'), 'positional xp=20 → Lv3 + actions');
hardReset();
club.philosophy = null;
ok(activeIdentityLevel() === null, 'philosophy=null → null');

// ── Lv3 위험도 보정 (tacticalFactors) ──
// state.identityLevel 주입 시 Lv3+ 관련 액션에 0.97 factor 추가.
function cleanState(identityLevel) {
  return {
    ...createTacticalState(), turn: 0, pressure: 22,
    lineIntents: { front: 'pin', mid: 'level', back: 'hold' },
    trainingEffects: [],
    scenario: { scheme: 'man' },   // man 은 bounce/third_man 유리(0.90) — identity 와 같은 액션
    identityLevel,
  };
}
// identityLevel 없음 → identity factor 미발생
const noId = cleanState(null);
ok(!tacticalFactors(noId, 'bounce').some((f) => f.id.startsWith('identity_')), 'identityLevel null → identity factor 없음');
// Lv2 → 미발생 (임계 3)
const lv2 = cleanState({ id: 'positional', level: 2, actions: ['bounce', 'third_man'] });
ok(!tacticalFactors(lv2, 'bounce').some((f) => f.id === 'identity_lv2'), 'Lv2 → identity factor 미발생');
// Lv3 + 관련 액션 → 0.97 factor
const lv3 = cleanState({ id: 'positional', level: 3, actions: ['bounce', 'third_man'] });
const lv3Factors = tacticalFactors(lv3, 'bounce');
ok(lv3Factors.some((f) => f.id === 'identity_lv3' && Math.abs(f.multiplier - 0.97) < 0.001), 'Lv3 + 관련 액션 → 0.97 factor 발생');
// Lv3 + 비관련 액션 → 미발생
const lv3Other = tacticalFactors(lv3, 'switch');
ok(!lv3Other.some((f) => f.id.startsWith('identity_')), 'Lv3 + 비관련 액션(switch) → identity factor 없음');
// Lv4 → 더 강한 factor id (여전 0.97, id만 lv4)
const lv4 = cleanState({ id: 'positional', level: 4, actions: ['bounce', 'third_man'] });
ok(tacticalFactors(lv4, 'bounce').some((f) => f.id === 'identity_lv4'), 'Lv4 → identity_lv4 factor');
// 위험도 실제 감소 확인
const baseRisk = tacticalRiskMultiplier(cleanState(null), 'bounce');
const lv3Risk = tacticalRiskMultiplier(lv3, 'bounce');
ok(lv3Risk < baseRisk, `Lv3 시 관련 액션 위험도 감소 (${baseRisk.toFixed(3)} → ${lv3Risk.toFixed(3)})`);

console.log(fail === 0 ? '\n✅ 정체성·훈련 루프 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
