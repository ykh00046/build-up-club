import { club, hardReset } from '../js/career/club.js';
import { addScenarioWin, updateIdentityStreak } from '../js/career/identity.js';
import {
  SEASON_GOALS, activeSeasonGoals, checkSeasonGoal, getSeasonGoal,
} from '../js/career/season-goals.js';
import { divisionPool, scenarioCellForMatchday } from '../js/career/season.js';

let fail = 0;
const ok = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗ FAIL'} ${message}`);
  if (!condition) fail++;
};

console.log('=== 시즌 목표 카드 ===\n');

hardReset();
ok(Object.keys(SEASON_GOALS).length === 2, '시즌 목표 2종 정의');
ok(getSeasonGoal('identity_streak') !== null, 'identity_streak 조회');
ok(getSeasonGoal('scenario_win') !== null, 'scenario_win 조회');
ok(getSeasonGoal('unknown') === null, '알 수 없는 goalId → null');

const active = activeSeasonGoals();
ok(active.length === 2, 'activeSeasonGoals 2개 반환');
ok(active.every((g) => g.done === false), '초기: 모든 목표 done=false');
ok(active.every((g) => typeof g.current() === 'number' && typeof g.target === 'number'), '모든 목표 current/target 수치');

hardReset();
ok(SEASON_GOALS.identity_streak.check() === false, '초기 identity_streak 미달성');
ok(SEASON_GOALS.identity_streak.current() === 0, '초기 진행도 0');
updateIdentityStreak('wing');
updateIdentityStreak('wing');
ok(SEASON_GOALS.identity_streak.check() === false, 'count=2 → 미달성');
ok(SEASON_GOALS.identity_streak.current() === 2, '진행도 2');
updateIdentityStreak('wing');
ok(SEASON_GOALS.identity_streak.check() === true, 'count=3 → 달성 조건 충족');

const beforeCash = club.cash;
const result = checkSeasonGoal('identity_streak');
ok(result && result.done === true, 'checkSeasonGoal 달성 반환');
ok(club.cash === beforeCash + 200, `1회성 보상 지급 (${beforeCash} → ${club.cash})`);
ok(club.seasonGoalsDone.identity_streak === true, 'seasonGoalsDone 기록');
ok(checkSeasonGoal('identity_streak') === null, '이미 달성한 목표 재호출 → null');

hardReset();
const targetCell = SEASON_GOALS.scenario_win.targetCell();
ok(typeof targetCell === 'string' && targetCell.length > 0, `타겟 셀 산출 ("${targetCell}")`);
ok(SEASON_GOALS.scenario_win.check() === false, '초기 scenario_win 미달성');
addScenarioWin(targetCell);
ok(SEASON_GOALS.scenario_win.current() === 1, '1승 → 진행도 1');
ok(SEASON_GOALS.scenario_win.check() === false, '1승 → 미달성');
addScenarioWin(targetCell);
ok(SEASON_GOALS.scenario_win.current() === 2, '2승 → 진행도 2');
ok(SEASON_GOALS.scenario_win.check() === true, '2승 → 달성');

const beforeCash2 = club.cash;
const result2 = checkSeasonGoal('scenario_win');
ok(result2 && result2.done === true, 'scenario_win 달성 반환');
ok(club.cash === beforeCash2 + 300, `scenario_win 보상 지급 (${beforeCash2} → ${club.cash})`);

hardReset();
updateIdentityStreak('wing');
updateIdentityStreak('wing');
updateIdentityStreak('wing');
addScenarioWin(targetCell);
ok(SEASON_GOALS.identity_streak.check() === true, 'identity 달성 + scenario 미달성 공존 가능');
ok(SEASON_GOALS.scenario_win.check() === false, '한 목표 달성이 다른 목표에 영향 없음');

const pool4 = divisionPool(3);
const pool1 = divisionPool(4);
const pool3 = divisionPool(2);
ok(pool4.includes('E1'), `2부 풀에 E1 포함 (${pool4.join(',')})`);
ok(pool1.includes('E1'), `1부 풀에 E1 포함 (${pool1.join(',')})`);
ok(pool3.includes('E2'), `3부 풀에 E2 포함 (${pool3.join(',')})`);
const cells4 = [0, 1, 2, 3].map((m) => scenarioCellForMatchday(3, m));
ok(cells4.includes('E1'), `2부 4경기 로테이션에 E1 등장 (${cells4.join(',')})`);
ok(new Set(cells4).size === 4, '2부 풀 4셀이 중복 없이 로테이션');
const cells3 = [0, 1, 2, 3].map((m) => scenarioCellForMatchday(2, m));
ok(cells3.includes('E2'), `3부 4경기 로테이션에 E2 등장 (${cells3.join(',')})`);

hardReset();
const div2Idx = 3;
const div1Idx = 4;
const div2Target = SEASON_GOALS.scenario_win.targetCell({ divIdx: div2Idx });
const div1Target = SEASON_GOALS.scenario_win.targetCell({ divIdx: div1Idx });
addScenarioWin(div2Target);
addScenarioWin(div2Target);
club.divIdx = div1Idx;
ok(SEASON_GOALS.scenario_win.check({ divIdx: div2Idx }) === true, '승격 후에도 경기 시작 디비전 기준 목표 달성 판정');
ok(SEASON_GOALS.scenario_win.current({ divIdx: div2Idx }) === 2, 'context current 는 경기 시작 디비전 target 을 사용');
if (div1Target !== div2Target) ok(SEASON_GOALS.scenario_win.check({ divIdx: div1Idx }) === false, '현재 디비전 기준과 경기 시작 기준을 구분');

console.log(fail === 0 ? '\n✅ 시즌 목표 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
