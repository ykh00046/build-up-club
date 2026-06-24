// 커리어 변주: 디비전 미션, 3~5경기 간격 선택 이벤트, 경기 후 컨디션.
// 상태 변경은 club.js의 공개 API만 사용해 저장/프레스티지 규칙과 분리한다.

import {
  activeTrainingEffects, club, division, addEffect, grantLevels, upgradeCost, save,
} from './club.js';

const MISSIONS = [
  { title: '첫 승점', desc: '리그 경기에서 승리하세요.', reward: 70, check: (x) => x.result === 'w' },
  { title: '잠근 뒷문', desc: '무실점으로 승점을 얻으세요.', reward: 320, check: (x) => x.cleanSheet && x.result !== 'l' },
  { title: '두 번의 마침표', desc: '한 경기에서 2골 이상 기록하세요.', reward: 1500, check: (x) => x.ourGoals >= 2 },
  { title: '상승 기류', desc: '2연승을 달성하세요.', reward: 7200, check: (x) => x.result === 'w' && club.streakW >= 2 },
  { title: '완성된 빌드업', desc: '결정적 빌드업을 득점과 승리로 끝내세요.', reward: 42000, check: (x) => x.tone === 'goal' && x.result === 'w' },
];

export function currentMission() {
  const mission = MISSIONS[club.divIdx];
  if (!mission) return null;
  return { ...mission, done: !!club.missionsDone[club.divIdx] };
}

export function checkMission(context = {}) {
  const idx = club.divIdx;
  const mission = MISSIONS[idx];
  if (!mission || club.missionsDone[idx] || !mission.check(context)) return null;
  club.missionsDone[idx] = true;
  club.cash += mission.reward;
  club.totalEarned += mission.reward;
  club.runEarned += mission.reward;
  return { ...mission, done: true };
}

export function effectsSummary() {
  const formEffects = club.effects.map((effect) => ({
    label: effect.label || '컨디션 변화',
    tone: effect.tone || 'good',
    left: effect.until == null ? null : Math.max(0, effect.until - club.matchday),
  }));
  const trainingEffects = activeTrainingEffects().map((effect) => ({
    label: `훈련 · ${effect.label}`,
    nextEffect: effect.nextEffect || null,
    tone: effect.tone || 'good',
    left: effect.until == null ? null : Math.max(0, effect.until - club.matchday),
  }));
  return [...formEffects, ...trainingEffects];
}

export function shouldTriggerEvent(gap, roll) {
  return gap >= 5 || (gap >= 3 && roll < 0.5);
}

function managerEvent() {
  const until = club.matchday + 3;
  return {
    type: 'manager', kicker: '감독 결정', title: '다음 3경기의 방향',
    desc: '짧은 일정 동안 팀의 무게중심을 선택하세요. 선택은 실제 전력에 반영됩니다.',
    choices: [
      {
        label: '전진 패스에 집중', desc: '공격 +12%, 수비 -4%',
        apply: () => addEffect({ type: 'form', atkMul: 1.12, defMul: 0.96, until, label: '공격 방침', tone: 'good' }),
      },
      {
        label: '후방 안정 우선', desc: '수비 +12%, 공격 -4%',
        apply: () => addEffect({ type: 'form', atkMul: 0.96, defMul: 1.12, until, label: '수비 방침', tone: 'good' }),
      },
    ],
  };
}

function scoutEvent() {
  const makeChoice = (pos, label) => ({
    label, desc: `${label} 영구 +1`,
    cost() { return Math.max(25, Math.round(upgradeCost(pos) * 0.72)); },
    apply() {
      const cost = this.cost();
      if (club.cash < cost) return false;
      club.cash -= cost;
      grantLevels(pos, 1);
      return true;
    },
  });
  return {
    type: 'scout', kicker: '스카우트 보고', title: '즉시 전력감이 도착했습니다',
    desc: '정가보다 저렴하게 한 포지션을 보강할 수 있습니다. 이번 기회만 유효합니다.',
    choices: [makeChoice('mf', '미드필더 영입'), makeChoice('df', '수비수 영입')],
  };
}

function academyEvent() {
  return {
    type: 'academy', kicker: '아카데미', title: '유망주 한 명을 올릴 수 있습니다',
    desc: '공격 전개와 마무리 중 장기적으로 강화할 지점을 선택하세요.',
    choices: [
      { label: '플레이메이커 승격', desc: '미드필더 영구 +1', apply: () => grantLevels('mf', 1) },
      { label: '피니셔 승격', desc: '공격수 영구 +1', apply: () => grantLevels('fw', 1) },
    ],
  };
}

export function maybeCareerEvent(rng = Math.random) {
  const gap = club.matchday - club.lastEventMatchday;
  if (!shouldTriggerEvent(gap, rng())) return null;
  const factories = [managerEvent, scoutEvent, academyEvent];
  return factories[Math.min(factories.length - 1, Math.floor(rng() * factories.length))]();
}

export function applyEventChoice(event, choiceIndex) {
  const choice = event?.choices?.[choiceIndex];
  if (!choice || typeof choice.apply !== 'function') return false;
  const cost = typeof choice.cost === 'function' ? choice.cost.call(choice) : Number(choice.cost || 0);
  if (cost > 0 && club.cash < cost) return false;
  if (choice.apply.call(choice) === false) return false;
  club.lastEventMatchday = club.matchday;
  save();
  return true;
}

export function rollPostMatchCondition(context = {}, rng = Math.random) {
  if (rng() >= 0.14) return null;
  const bad = context.result === 'l' || context.tone === 'fail';
  if (bad) {
    const positions = ['fw', 'mf', 'df', 'gk'];
    const pos = positions[Math.min(positions.length - 1, Math.floor(rng() * positions.length))];
    const names = { fw: '공격수', mf: '미드필더', df: '수비수', gk: '골키퍼' };
    addEffect({ type: 'injury', pos, dLevel: -1, until: club.matchday + 2, label: `${names[pos]} 경미한 부상`, tone: 'bad' });
    return { tone: 'bad', text: `${names[pos]}가 경미한 부상으로 2경기 동안 전력이 감소합니다.` };
  }
  addEffect({ type: 'form', atkMul: 1.06, defMul: 1.06, until: club.matchday + 2, label: '좋은 흐름', tone: 'good' });
  return { tone: 'good', text: '좋은 흐름을 타 2경기 동안 공수 전력이 상승합니다.' };
}
