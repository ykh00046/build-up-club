// 시즌 목표 카드 — roadmap P3 / design-direction §10.
// 기존 디비전 고정 미션(events.js) 과는 별개의 슬롯.
// 목표는 "플레이 스타일/정체성" 기반으로, 장기 반복 플레이 동기를 만든다.
//
// 각 목표 객체:
//   id, title, desc, reward, target(달성 임계치 — 진행도 표시용)
//   current(ctx)  → 현재 진행도(숫자)
//   targetCell(ctx) → 시나리오 승 목표의 타겟 셀(없으면 null)
//   check(ctx)    → 달성 여부(불리언)
// 보상은 1회성 cash. 달성 시 seasonGoalsDone[id] = true.

import { club } from './club.js';
import { divisionPool } from './season.js';

export const SEASON_GOALS = {
  identity_streak: {
    id: 'identity_streak',
    title: { ko: '정체성 정착', en: 'Identity set' },
    desc: { ko: '같은 클럽 정체성으로 3경기 연속 우세하세요.', en: 'Top the same club identity for 3 matches in a row.' },
    reward: 200,
    target: 3,
    targetCell: () => null,
    current: () => club.identityStreak?.count ?? 0,
    check: () => (club.identityStreak?.count ?? 0) >= 3,
  },
  scenario_win: {
    id: 'scenario_win',
    title: { ko: '상대 압박 돌파', en: 'Break their press' },
    desc: { ko: '이번 디비전의 주요 압박 상대에게 2승을 거두세요.', en: "Beat this division's key pressing opponent twice." },
    reward: 300,
    target: 2,
    targetCell: (ctx = {}) => divisionPool(ctx.divIdx ?? club.divIdx)[0],
    current: (ctx = {}) => {
      const cell = divisionPool(ctx.divIdx ?? club.divIdx)[0];
      return club.scenarioWins?.[cell] ?? 0;
    },
    check: (ctx = {}) => {
      const cell = divisionPool(ctx.divIdx ?? club.divIdx)[0];
      return (club.scenarioWins?.[cell] ?? 0) >= 2;
    },
  },
};

export function getSeasonGoal(goalId) {
  return SEASON_GOALS[goalId] || null;
}

export function activeSeasonGoals() {
  return Object.values(SEASON_GOALS).map((g) => ({
    ...g,
    done: !!club.seasonGoalsDone?.[g.id],
  }));
}

// 단일 목표 달성 판정 + 1회성 보상 지급.
// 이미 달성했으면 null. 달성 조건 미충족이면 null.
// 달성 시 seasonGoalsDone[id]=true, cash 보상, { ...goal, done:true } 반환.
export function checkSeasonGoal(goalId, ctx = {}) {
  const goal = SEASON_GOALS[goalId];
  if (!goal) return null;
  if (club.seasonGoalsDone?.[goalId]) return null;
  if (!goal.check(ctx)) return null;
  club.seasonGoalsDone = { ...(club.seasonGoalsDone || {}), [goalId]: true };
  club.cash += goal.reward;
  club.totalEarned += goal.reward;
  club.runEarned += goal.reward;
  return { ...goal, done: true, context: ctx };
}
