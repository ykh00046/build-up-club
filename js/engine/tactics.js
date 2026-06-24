import { clamp } from '../data/pitch.js';

export const ACTION_LABELS = {
  to_feet: '발밑 패스', into_space: '공간 패스', hold: '기다리기', carry: '운반',
  run_order: '침투 지시', bounce: '원투', third_man: '서드맨', switch: '전환', shoot: '슈팅',
};

const AGGRESSIVE = new Set(['into_space', 'run_order', 'carry', 'third_man', 'switch']);

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
  if (reps >= 3) addFactor(factors, 'adaptation', `상대가 ${ACTION_LABELS[actionId] ?? actionId} 패턴을 읽음`, 1 + (reps - 2) * 0.16);
  if (AGGRESSIVE.has(actionId)) addFactor(factors, 'fatigue', `공격 피로 ${Math.round(state.fatigue)}%`, 1 + (state.fatigue / 100) * 0.25);
  addFactor(factors, 'momentum', `모멘텀 ${Math.round(state.momentum)}`, 1 - ((state.momentum - 50) / 100) * 0.18);

  for (const effect of state.trainingEffects || []) {
    if (effect.actions?.includes(actionId)) addFactor(factors, `training_${effect.id}`, `${effect.label} 효과`, effect.multiplier || 0.88);
  }

  const li = state.lineIntents;
  if (li.front === 'drop' && actionId === 'bounce') addFactor(factors, 'front_drop', '전방 내려와 연결', 0.85);
  if (li.front === 'drop' && actionId === 'into_space') addFactor(factors, 'front_drop_cost', '박스 침투 인원 부족', 1.10);
  if (li.mid === 'between' && actionId === 'to_feet') addFactor(factors, 'mid_between', '중원 라인 사이 배치', 0.90);
  if (li.mid === 'support' && actionId === 'bounce') addFactor(factors, 'mid_support', '중원 빌드업 보조', 0.90);
  if (li.back === 'overlap' && actionId === 'switch') addFactor(factors, 'back_overlap', '풀백 전진으로 전환 거리 증가', 1.08);
  const scheme = state.scenario?.scheme;
  if (scheme === 'man' && (actionId === 'bounce' || actionId === 'third_man')) addFactor(factors, 'opp_man_combo', '대인 압박은 조합 플레이에 취약', 0.90);
  if (scheme === 'man' && actionId === 'to_feet' && reps >= 2) addFactor(factors, 'opp_man_read', '대인 압박이 같은 연결을 추적', 1.12);
  if (scheme === 'zonal' && actionId === 'switch') addFactor(factors, 'opp_zonal_shift', '지역 블록은 빠른 전환에 흔들림', 0.91);
  if (scheme === 'zonal' && actionId === 'into_space') addFactor(factors, 'opp_zonal_lane', '지역 블록의 중앙 밀집', 1.08);
  if (scheme === 'gegen' && (actionId === 'hold' || actionId === 'carry')) addFactor(factors, 'opp_gegen_swarm', '게겐프레스의 즉시 압박', 1.14);
  if (scheme === 'gegen' && (actionId === 'bounce' || actionId === 'third_man')) addFactor(factors, 'opp_gegen_bypass', '첫 파도 우회', 0.88);
  if (scheme === 'hybrid' && actionId === 'third_man') addFactor(factors, 'opp_hybrid_shadow', '하이브리드 압박의 커버 섀도우 우회', 0.93);
  // 정체성 레벨 보정 — roadmap P4. Lv3+ 에서 주 정체성 관련 액션 위험도 소폭 안정화(0.97).
  // state.identityLevel 은 applyClubBoost 가 club.philosophy/identityXp 기반으로 주입.
  const il = state.identityLevel;
  if (il && il.level >= 3 && Array.isArray(il.actions) && il.actions.includes(actionId)) {
    addFactor(factors, `identity_lv${il.level}`, `정체성 ${il.level}숙련 — 관련 액션 안정`, 0.97);
  }
  for (const situation of state.situations?.active ?? []) {
    const multiplier = situation.modifiers?.[actionId];
    if (multiplier) addFactor(factors, situation.id, situation.factorLabel, multiplier);
  }
  if (state.decisionBoost && state.turn <= state.decisionBoost.expiresTurn && state.decisionBoost.actions.includes(actionId)) {
    addFactor(factors, 'decision_boost', state.decisionBoost.label, state.decisionBoost.multiplier);
  }
  return factors;
}

export function tacticalRiskMultiplier(state, actionId) {
  return clamp(tacticalFactors(state, actionId).reduce((m, factor) => m * factor.multiplier, 1), 0.55, 2.2);
}

const SITUATIONS = {
  pressure_surge: {
    title: '상대 압박 강화', detail: '상대가 전진 압박을 시작했습니다. 원투나 서드맨으로 첫 압박선을 벗겨내세요.',
    factorLabel: '강화된 전진 압박', duration: 3, solutions: ['bounce', 'third_man'],
    modifiers: { hold: 1.22, carry: 1.15, bounce: 0.90, third_man: 0.90 },
  },
  flank_lock: {
    title: '측면 봉쇄', detail: '반복된 전환을 읽고 약한 쪽을 미리 닫았습니다. 중앙 조합으로 수비를 다시 모으세요.',
    factorLabel: '상대의 측면 선점', duration: 4, solutions: ['bounce', 'third_man'],
    modifiers: { switch: 1.28, bounce: 0.90, third_man: 0.88 },
  },
  counter_risk: {
    title: '역습 경고', detail: '풀백이 전진한 상태입니다. 공격 실패 시 측면 뒷공간이 크게 열립니다.',
    factorLabel: '풀백 뒤 역습 노출', duration: 2, solutions: [],
    modifiers: { into_space: 1.12, carry: 1.12, third_man: 1.08, switch: 1.10 },
  },
};

function activate(state, id) {
  const store = state.situations;
  if (store.seen[id] || store.active.some((s) => s.id === id)) return null;
  const cfg = SITUATIONS[id];
  const situation = { id, ...cfg, expiresTurn: state.turn + cfg.duration };
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
      title: '템포 선택',
      detail: '상대가 전진할지 기다립니다. 지금 속도를 올릴지, 리셋으로 압박을 빼낼지 고르세요.',
      choices: [
        { id: 'accelerate', label: '바로 전진', desc: '다음 전진 패스 위험↓ · 피로↑' },
        { id: 'reset', label: '리셋', desc: '압박↓ · 모멘텀 소폭↑' },
      ],
    };
    events.push({ type: 'decision', decision: state.matchDecision });
  }
  if (!state.matchDecision && store.active.some((s) => s.id === 'flank_lock') && !store.seen.flank_lock_choice) {
    store.seen.flank_lock_choice = true;
    state.matchDecision = {
      id: 'flank_lock_choice',
      title: '측면 봉쇄 대응',
      detail: '상대가 전환을 미리 닫았습니다. 중앙으로 다시 모을지, 빠르게 재전환할지 선택하세요.',
      choices: [
        { id: 'central_combo', label: '중앙 조합', desc: '원투·써드맨 위험↓' },
        { id: 'reswitch', label: '재전환 강행', desc: '전환 위험↓ · 피로↑' },
      ],
    };
    events.push({ type: 'decision', decision: state.matchDecision });
  }
  if (!state.matchDecision && store.active.some((s) => s.id === 'counter_risk') && !store.seen.counter_choice) {
    store.seen.counter_choice = true;
    state.matchDecision = {
      id: 'counter_choice',
      title: '후방 균형 선택',
      detail: '풀백 뒤 공간이 열렸습니다. 계속 밀어붙일지, 후방을 안정시킬지 결정하세요.',
      choices: [
        { id: 'secure_back', label: '후방 안정', desc: '역습 경고 해결 · 압박 소폭↑' },
        { id: 'overload_wide', label: '측면 과부하', desc: '전환·공간패스 위험↓ · 역습 위험 유지' },
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
      actions: ['into_space', 'third_man', 'switch'],
      label: '템포를 올린 직후',
      multiplier: 0.88,
      expiresTurn: state.turn + 2,
    };
    return { choice, text: '템포를 올렸습니다 — 다음 전진 루트가 잠깐 더 열립니다.', tone: 'success' };
  }
  if (choiceId === 'central_combo') {
    state.momentum = clamp(state.momentum + 6, 0, 100);
    state.decisionBoost = {
      actions: ['bounce', 'third_man'],
      label: '중앙으로 다시 모은 직후',
      multiplier: 0.84,
      expiresTurn: state.turn + 2,
    };
    return { choice, text: '중앙 조합을 택했습니다 — 원투와 써드맨 루트가 열립니다.', tone: 'success' };
  }
  if (choiceId === 'reswitch') {
    state.fatigue = clamp(state.fatigue + 8, 0, 100);
    state.decisionBoost = {
      actions: ['switch'],
      label: '빠른 재전환 타이밍',
      multiplier: 0.86,
      expiresTurn: state.turn + 1,
    };
    return { choice, text: '재전환을 강행합니다 — 짧은 순간 약측이 다시 열립니다.', tone: 'success' };
  }
  if (choiceId === 'secure_back') {
    state.lineIntents.back = 'hold';
    const resolved = resolveCounterRisk(state);
    state.facts.situationsResolved = (state.facts.situationsResolved || 0) + resolved.length;
    state.pressure = clamp(state.pressure + 3, 0, 100);
    return { choice, text: '후방 안정 선택 — 풀백이 남아 역습 경고를 지웠습니다.', tone: 'success' };
  }
  if (choiceId === 'overload_wide') {
    state.fatigue = clamp(state.fatigue + 7, 0, 100);
    state.decisionBoost = {
      actions: ['switch', 'into_space'],
      label: '측면 과부하 유지',
      multiplier: 0.88,
      expiresTurn: state.turn + 2,
    };
    return { choice, text: '측면 과부하를 유지합니다 — 전환과 공간 패스가 잠깐 쉬워집니다.', tone: 'warn' };
  }
  state.pressure = clamp(state.pressure - 10, 0, 100);
  state.momentum = clamp(state.momentum + 3, 0, 100);
  state.fatigue = clamp(state.fatigue - 5, 0, 100);
  return { choice, text: '리셋으로 압박을 빼냈습니다 — 후방 출구가 안정됩니다.', tone: 'info' };
}
