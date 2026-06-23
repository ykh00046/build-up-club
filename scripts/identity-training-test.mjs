import { hardReset, club } from '../js/career/club.js';
import {
  addIdentityXp, applyTrainingChoice, identitySummary, inferIdentityFromMatch, trainingOptionsFromReport,
} from '../js/career/identity.js';

let fail = 0;
const ok = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗ FAIL —'} ${message}`);
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

const options = trainingOptionsFromReport({ read: '전환 반복을 상대가 읽기 시작했습니다.', next: '전환을 쉬세요.' }, state);
ok(options.some((o) => o.id === 'wide_switch'), '전환이 읽힌 리포트는 전환/중앙 훈련을 제안');

const beforeMf = club.levels.mf;
const summary = applyTrainingChoice(options.find((o) => o.id === 'central_combo'));
ok(club.levels.mf === beforeMf + 1, '훈련 선택이 포지션 레벨을 올림');
ok(summary.id === 'positional' || club.identityXp.positional >= 4, '훈련 선택이 정체성 XP를 올림');

console.log(fail === 0 ? '\n✅ 정체성·훈련 루프 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
