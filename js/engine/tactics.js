import { clamp } from '../data/pitch.js';
import { t } from '../career/i18n.js';

// ACTION_LABELS is read everywhere as `ACTION_LABELS[id]`. Routing it through a
// Proxy keeps every existing call site working unchanged while making the value
// language-reactive (resolves t('actlbl.<id>') at access time). Only the five
// known action ids resolve; any other key returns undefined so call sites'
// `?? id` / `|| a` fallbacks behave exactly as before.
const ACTION_LABEL_IDS = ['to_feet', 'pass_space', 'hold', 'carry', 'shoot'];
export const ACTION_LABELS = new Proxy(
  {},
  {
    get: (_target, id) => (ACTION_LABEL_IDS.includes(id) ? t(`actlbl.${id}`) : undefined),
    has: (_target, id) => ACTION_LABEL_IDS.includes(id),
    ownKeys: () => [...ACTION_LABEL_IDS],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: undefined }),
  },
);

const AGGRESSIVE = new Set(['pass_space', 'carry']);

export function createTacticalState() {
  return {
    momentum: 50, fatigue: 0, actionHistory: [], currentAction: null, adaptRead: null,
    situations: { active: [], seen: {}, resolved: [] }, lastTacticalFactors: [],
    matchDecision: null, decisionBoost: null,
  };
}

function recentCount(state, actionId) {
  return state.actionHistory.filter((id) => id === actionId).length;
}

function addFactor(list, id, label, multiplier) {
  if (Math.abs(multiplier - 1) >= 0.025) list.push({ id, label, multiplier });
}

export function tacticalFactors(state, actionId) {
  if (!actionId) return [];
  const factors = [];
  const reps = recentCount(state, actionId);
  if (reps >= 3) addFactor(factors, 'adaptation', t('fac.adaptation').replace('{x}', ACTION_LABELS[actionId] ?? actionId), 1 + (reps - 2) * 0.16);
  if (AGGRESSIVE.has(actionId)) addFactor(factors, 'fatigue', t('fac.fatigue').replace('{n}', String(Math.round(state.fatigue))), 1 + (state.fatigue / 100) * 0.25);
  addFactor(factors, 'momentum', t('fac.momentum').replace('{n}', String(Math.round(state.momentum))), 1 - ((state.momentum - 50) / 100) * 0.18);

  for (const effect of state.trainingEffects || []) {
    if (effect.actions?.includes(actionId)) addFactor(factors, `training_${effect.id}`, t('fac.training').replace('{x}', effect.label), effect.multiplier || 0.88);
  }

  // 라인 의도 — 공간 지향 모델 어휘. 원투/써드맨은 짧은 발밑 연쇄로 자연 발생,
  // 전환은 공간 패스로 흡수.
  const li = state.lineIntents;
  if (li.front === 'drop' && actionId === 'to_feet') addFactor(factors, 'front_drop', t('fac.front_drop'), 0.88);
  if (li.mid === 'between' && actionId === 'to_feet') addFactor(factors, 'mid_between', t('fac.mid_between'), 0.90);
  if (li.back === 'overlap' && actionId === 'pass_space') addFactor(factors, 'back_overlap', t('fac.back_overlap'), 0.92);
  const scheme = state.scenario?.scheme;
  // 대인: 등 뒤 공간 침투로 마크를 벗긴다 / 같은 발밑 반복은 추적당함.
  if (scheme === 'man' && actionId === 'pass_space') addFactor(factors, 'opp_man_space', t('fac.opp_man_space'), 0.90);
  if (scheme === 'man' && actionId === 'to_feet' && reps >= 2) addFactor(factors, 'opp_man_read', t('fac.opp_man_read'), 1.12);
  // 지역: 빠른 측면 전환(공간 패스)에 흔들림.
  if (scheme === 'zonal' && actionId === 'pass_space') addFactor(factors, 'opp_zonal_shift', t('fac.opp_zonal_shift'), 0.92);
  // 게겐: 원터치 발밑 연결로 첫 파도 우회 / 기다리기·운반은 즉시 압살.
  if (scheme === 'gegen' && actionId === 'to_feet') addFactor(factors, 'opp_gegen_bypass', t('fac.opp_gegen_bypass'), 0.90);
  if (scheme === 'gegen' && (actionId === 'hold' || actionId === 'carry')) addFactor(factors, 'opp_gegen_swarm', t('fac.opp_gegen_swarm'), 1.14);
  // 하이브리드: 공간 패스로 커버 섀도우를 우회.
  if (scheme === 'hybrid' && actionId === 'pass_space') addFactor(factors, 'opp_hybrid_shadow', t('fac.opp_hybrid_shadow'), 0.93);
  // 미드블록: 앞 공간 운반은 유리, 압축된 중앙으로의 공간 패스는 불리.
  if (scheme === 'midblock' && actionId === 'carry') addFactor(factors, 'opp_midblock_space', t('fac.opp_midblock_space'), 0.92);
  if (scheme === 'midblock' && actionId === 'pass_space') addFactor(factors, 'opp_midblock_compact', t('fac.opp_midblock_compact'), 1.08);
  // 로우블록: 좌우 전환(공간 패스)·앞 공간 운반은 유리.
  if (scheme === 'lowblock' && actionId === 'carry') addFactor(factors, 'opp_lowblock_front', t('fac.opp_lowblock_front'), 0.93);
  if (scheme === 'lowblock' && actionId === 'pass_space') addFactor(factors, 'opp_lowblock_shift', t('fac.opp_lowblock_shift'), 0.90);
  // 정체성 레벨 보정 — roadmap P4. Lv3+ 에서 주 정체성 관련 액션 위험도 소폭 안정화(0.97).
  // state.identityLevel 은 applyClubBoost 가 club.philosophy/identityXp 기반으로 주입.
  const il = state.identityLevel;
  if (il && il.level >= 3 && Array.isArray(il.actions) && il.actions.includes(actionId)) {
    addFactor(factors, `identity_lv${il.level}`, t('fac.identity').replace('{n}', String(il.level)), 0.97);
  }
  for (const situation of state.situations?.active ?? []) {
    const multiplier = situation.modifiers?.[actionId];
    if (multiplier) addFactor(factors, situation.id, t(`sit.${situation.id}.factor`), multiplier);
  }
  if (state.decisionBoost && state.turn <= state.decisionBoost.expiresTurn && state.decisionBoost.actions.includes(actionId)) {
    addFactor(factors, 'decision_boost', state.decisionBoost.label, state.decisionBoost.multiplier);
  }
  return factors;
}

export function tacticalRiskMultiplier(state, actionId) {
  return clamp(tacticalFactors(state, actionId).reduce((m, factor) => m * factor.multiplier, 1), 0.55, 2.2);
}

// 로직 전용(키/modifiers/duration/solutions). 표시 문자열(title/detail/factorLabel)은
// 활성화 시점에 t()로 해석한다 — matchDecision과 동일 패턴이라 언어 토글 후 새 경기에서
// 올바른 언어로 잡힌다. (consumer는 engine/report가 t(`sit.${id}...`)를 직접 쓰거나
// main.js가 situation.title/detail을 읽음.)
const SITUATIONS = {
  pressure_surge: {
    duration: 3, solutions: ['to_feet'],
    modifiers: { hold: 1.22, carry: 1.15, to_feet: 0.90 },
  },
  flank_lock: {
    duration: 4, solutions: ['to_feet'],
    modifiers: { pass_space: 1.28, to_feet: 0.90 },
  },
  counter_risk: {
    duration: 2, solutions: [],
    modifiers: { pass_space: 1.12, carry: 1.12 },
  },
};

function activate(state, id) {
  const store = state.situations;
  if (store.seen[id] || store.active.some((s) => s.id === id)) return null;
  const cfg = SITUATIONS[id];
  const situation = {
    id,
    ...cfg,
    title: t(`sit.${id}.title`),
    detail: t(`sit.${id}.detail`),
    factorLabel: t(`sit.${id}.factor`),
    expiresTurn: state.turn + cfg.duration,
  };
  store.active.push(situation); store.seen[id] = true;
  return { type: 'activated', situation };
}

export function prepareSituations(state, actionId) {
  const events = [];
  const store = state.situations;
  for (const situation of store.active.filter((s) => state.turn > s.expiresTurn)) events.push({ type: 'expired', situation });
  store.active = store.active.filter((s) => state.turn <= s.expiresTurn);
  if (state.decisionBoost && state.turn > state.decisionBoost.expiresTurn) state.decisionBoost = null;
  if (state.pressure >= 65) { const event = activate(state, 'pressure_surge'); if (event) events.push(event); }
  if ((state.facts?.switches ?? 0) >= 2) { const event = activate(state, 'flank_lock'); if (event) events.push(event); }
  if (state.lineIntents.back === 'overlap' && AGGRESSIVE.has(actionId)) {
    const event = activate(state, 'counter_risk'); if (event) events.push(event);
  }
  if (!state.situations.seen.tempo_choice && !state.matchDecision && state.turn >= 3 && state.pressure >= 55) {
    state.situations.seen.tempo_choice = true;
    state.matchDecision = {
      id: 'tempo_choice',
      title: t('dec.tempo_choice.title'),
      detail: t('dec.tempo_choice.detail'),
      choices: [
        { id: 'accelerate', label: t('dec.tempo_choice.accelerate.label'), desc: t('dec.tempo_choice.accelerate.desc') },
        { id: 'reset', label: t('dec.tempo_choice.reset.label'), desc: t('dec.tempo_choice.reset.desc') },
      ],
    };
    events.push({ type: 'decision', decision: state.matchDecision });
  }
  if (!state.matchDecision && store.active.some((s) => s.id === 'flank_lock') && !store.seen.flank_lock_choice) {
    store.seen.flank_lock_choice = true;
    state.matchDecision = {
      id: 'flank_lock_choice',
      title: t('dec.flank_lock_choice.title'),
      detail: t('dec.flank_lock_choice.detail'),
      choices: [
        { id: 'central_combo', label: t('dec.flank_lock_choice.central_combo.label'), desc: t('dec.flank_lock_choice.central_combo.desc') },
        { id: 'reswitch', label: t('dec.flank_lock_choice.reswitch.label'), desc: t('dec.flank_lock_choice.reswitch.desc') },
      ],
    };
    events.push({ type: 'decision', decision: state.matchDecision });
  }
  if (!state.matchDecision && store.active.some((s) => s.id === 'counter_risk') && !store.seen.counter_choice) {
    store.seen.counter_choice = true;
    state.matchDecision = {
      id: 'counter_choice',
      title: t('dec.counter_choice.title'),
      detail: t('dec.counter_choice.detail'),
      choices: [
        { id: 'secure_back', label: t('dec.counter_choice.secure_back.label'), desc: t('dec.counter_choice.secure_back.desc') },
        { id: 'overload_wide', label: t('dec.counter_choice.overload_wide.label'), desc: t('dec.counter_choice.overload_wide.desc') },
      ],
    };
    events.push({ type: 'decision', decision: state.matchDecision });
  }
  return events;
}

export function updateTacticalState(state, actionId, ok) {
  if (!actionId) return [];
  state.momentum = clamp(state.momentum + (ok ? 7 : -10), 0, 100);
  const tire = AGGRESSIVE.has(actionId) ? 9 : actionId === 'hold' ? -7 : 3;
  state.fatigue = clamp(state.fatigue + tire, 0, 100);
  state.actionHistory.push(actionId);
  if (state.actionHistory.length > 5) state.actionHistory.shift();
  state.adaptRead = recentCount(state, actionId) >= 3 ? actionId : null;
  if (!ok) return [];
  const resolved = state.situations.active.filter((s) => s.solutions.includes(actionId));
  state.situations.active = state.situations.active.filter((s) => !s.solutions.includes(actionId));
  for (const situation of resolved) state.situations.resolved.push(situation.id);
  return resolved.map((situation) => ({ type: 'resolved', situation }));
}

export function resolveCounterRisk(state) {
  const resolved = state.situations.active.filter((s) => s.id === 'counter_risk');
  state.situations.active = state.situations.active.filter((s) => s.id !== 'counter_risk');
  for (const situation of resolved) state.situations.resolved.push(situation.id);
  return resolved;
}

export function applyMatchDecision(state, choiceId) {
  const decision = state.matchDecision;
  if (!decision) return null;
  const choice = decision.choices.find((c) => c.id === choiceId);
  if (!choice) return null;
  state.matchDecision = null;
  if (choiceId === 'accelerate') {
    state.momentum = clamp(state.momentum + 8, 0, 100);
    state.fatigue = clamp(state.fatigue + 10, 0, 100);
    state.pressure = clamp(state.pressure + 4, 0, 100);
    state.decisionBoost = {
      actions: ['pass_space', 'to_feet'],
      label: t('dec.accelerate.boost'),
      multiplier: 0.88,
      expiresTurn: state.turn + 2,
    };
    return { choice, text: t('dec.accelerate.text'), tone: 'success' };
  }
  if (choiceId === 'central_combo') {
    state.momentum = clamp(state.momentum + 6, 0, 100);
    state.decisionBoost = {
      actions: ['to_feet'],
      label: t('dec.central_combo.boost'),
      multiplier: 0.84,
      expiresTurn: state.turn + 2,
    };
    return { choice, text: t('dec.central_combo.text'), tone: 'success' };
  }
  if (choiceId === 'reswitch') {
    state.fatigue = clamp(state.fatigue + 8, 0, 100);
    state.decisionBoost = {
      actions: ['pass_space'],
      label: t('dec.reswitch.boost'),
      multiplier: 0.86,
      expiresTurn: state.turn + 1,
    };
    return { choice, text: t('dec.reswitch.text'), tone: 'success' };
  }
  if (choiceId === 'secure_back') {
    state.lineIntents.back = 'hold';
    const resolved = resolveCounterRisk(state);
    state.facts.situationsResolved = (state.facts.situationsResolved || 0) + resolved.length;
    state.pressure = clamp(state.pressure + 3, 0, 100);
    return { choice, text: t('dec.secure_back.text'), tone: 'success' };
  }
  if (choiceId === 'overload_wide') {
    state.fatigue = clamp(state.fatigue + 7, 0, 100);
    state.decisionBoost = {
      actions: ['pass_space'],
      label: t('dec.overload_wide.boost'),
      multiplier: 0.88,
      expiresTurn: state.turn + 2,
    };
    return { choice, text: t('dec.overload_wide.text'), tone: 'warn' };
  }
  state.pressure = clamp(state.pressure - 10, 0, 100);
  state.momentum = clamp(state.momentum + 3, 0, 100);
  state.fatigue = clamp(state.fatigue - 5, 0, 100);
  return { choice, text: t('dec.reset.text'), tone: 'info' };
}
