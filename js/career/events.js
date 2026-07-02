// 커리어 변주: 디비전 미션, 3~5경기 간격 선택 이벤트, 경기 후 컨디션.
// 상태 변경은 club.js의 공개 API만 사용해 저장/프레스티지 규칙과 분리한다.

import {
  activeTrainingEffects, club, division, addEffect, grantLevels, upgradeCost, save,
} from './club.js';
import { t, loc } from './i18n.js';

const MISSIONS = [
  { title: { ko: '첫 승점', en: 'First points' }, desc: { ko: '리그 경기에서 승리하세요.', en: 'Win a league match.' }, reward: 70, check: (x) => x.result === 'w' },
  { title: { ko: '잠근 뒷문', en: 'Back door locked' }, desc: { ko: '무실점으로 승점을 얻으세요.', en: 'Take points with a clean sheet.' }, reward: 320, check: (x) => x.cleanSheet && x.result !== 'l' },
  { title: { ko: '두 번의 마침표', en: 'Two finishes' }, desc: { ko: '한 경기에서 2골 이상 기록하세요.', en: 'Score 2+ goals in one match.' }, reward: 1500, check: (x) => x.ourGoals >= 2 },
  { title: { ko: '상승 기류', en: 'On the rise' }, desc: { ko: '2연승을 달성하세요.', en: 'Put together a 2-match win streak.' }, reward: 7200, check: (x) => x.result === 'w' && club.streakW >= 2 },
  { title: { ko: '완성된 빌드업', en: 'Complete build-up' }, desc: { ko: '결정적 빌드업을 득점과 승리로 끝내세요.', en: 'Finish a decisive build-up with a goal and a win.' }, reward: 42000, check: (x) => x.tone === 'goal' && x.result === 'w' },
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
    label: effect.label || { ko: '컨디션 변화', en: 'Condition change' },
    tone: effect.tone || 'good',
    left: effect.until == null ? null : Math.max(0, effect.until - club.matchday),
  }));
  const trainingEffects = activeTrainingEffects().map((effect) => ({
    label: t('events.training').replace('{x}', loc(effect.label)),
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
    type: 'manager', kicker: { ko: '감독 결정', en: 'Manager call' }, title: { ko: '다음 3경기의 방향', en: 'Direction for the next 3 matches' },
    desc: { ko: '짧은 일정 동안 팀의 무게중심을 선택하세요. 선택은 실제 전력에 반영됩니다.', en: "Pick where the team's weight sits over a short run. Your choice affects real strength." },
    choices: [
      {
        label: { ko: '전진 패스에 집중', en: 'Focus on forward passing' }, desc: { ko: '공격 +12%, 수비 -4%', en: 'Attack +12%, Defense −4%' },
        apply: () => addEffect({ type: 'form', atkMul: 1.12, defMul: 0.96, until, label: { ko: '공격 방침', en: 'Attacking brief' }, tone: 'good' }),
      },
      {
        label: { ko: '후방 안정 우선', en: 'Prioritize a stable back' }, desc: { ko: '수비 +12%, 공격 -4%', en: 'Defense +12%, Attack −4%' },
        apply: () => addEffect({ type: 'form', atkMul: 0.96, defMul: 1.12, until, label: { ko: '수비 방침', en: 'Defensive brief' }, tone: 'good' }),
      },
    ],
  };
}

function scoutEvent() {
  const makeChoice = (pos, label, desc) => ({
    label, desc,
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
    type: 'scout', kicker: { ko: '스카우트 보고', en: 'Scout report' }, title: { ko: '즉시 전력감이 도착했습니다', en: 'A ready-made signing has arrived' },
    desc: { ko: '정가보다 저렴하게 한 포지션을 보강할 수 있습니다. 이번 기회만 유효합니다.', en: 'Strengthen one position below market price. This offer is one-time only.' },
    choices: [
      makeChoice('mf', { ko: '미드필더 영입', en: 'Sign a midfielder' }, { ko: '미드필더 영구 +1', en: 'Midfielder +1 (permanent)' }),
      makeChoice('df', { ko: '수비수 영입', en: 'Sign a defender' }, { ko: '수비수 영구 +1', en: 'Defender +1 (permanent)' }),
      // 무료 탈출구 — 두 영입 모두 유료라 자금이 없으면 이벤트 모달(비해제형)에
      // 갇히는 소프트락이 있었다(감사 C6). 이벤트엔 항상 0원 선택지가 있어야 한다.
      { label: { ko: '제안 거절', en: 'Decline the offer' }, desc: { ko: '비용 없음 — 다음 기회를 기다립니다', en: 'No cost — wait for the next window' }, cost: () => 0, apply: () => true },
    ],
  };
}

function academyEvent() {
  return {
    type: 'academy', kicker: { ko: '아카데미', en: 'Academy' }, title: { ko: '유망주 한 명을 올릴 수 있습니다', en: 'You can promote one prospect' },
    desc: { ko: '공격 전개와 마무리 중 장기적으로 강화할 지점을 선택하세요.', en: 'Choose where to build long-term strength: ball progression or finishing.' },
    choices: [
      { label: { ko: '플레이메이커 승격', en: 'Promote a playmaker' }, desc: { ko: '미드필더 영구 +1', en: 'Midfielder +1 (permanent)' }, apply: () => grantLevels('mf', 1) },
      { label: { ko: '피니셔 승격', en: 'Promote a finisher' }, desc: { ko: '공격수 영구 +1', en: 'Striker +1 (permanent)' }, apply: () => grantLevels('fw', 1) },
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
    const names = {
      fw: { ko: '공격수', en: 'Striker' }, mf: { ko: '미드필더', en: 'Midfielder' },
      df: { ko: '수비수', en: 'Defender' }, gk: { ko: '골키퍼', en: 'Keeper' },
    };
    const nm = names[pos];
    addEffect({ type: 'injury', pos, dLevel: -1, until: club.matchday + 2, label: { ko: `${nm.ko} 경미한 부상`, en: `${nm.en} minor injury` }, tone: 'bad' });
    return { tone: 'bad', text: { ko: `${nm.ko}가 경미한 부상으로 2경기 동안 전력이 감소합니다.`, en: `${nm.en} has a minor injury — strength reduced for 2 matches.` } };
  }
  addEffect({ type: 'form', atkMul: 1.06, defMul: 1.06, until: club.matchday + 2, label: { ko: '좋은 흐름', en: 'Good run' }, tone: 'good' });
  return { tone: 'good', text: { ko: '좋은 흐름을 타 2경기 동안 공수 전력이 상승합니다.', en: 'Riding a good run — attack and defense up for 2 matches.' } };
}
