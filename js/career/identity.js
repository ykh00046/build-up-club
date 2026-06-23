import { addEffect, club, grantLevels, save } from './club.js';

export const IDENTITIES = {
  positional: { label: '점유형', desc: '원투·써드맨·라인 사이 전개', color: '#5dd6c5' },
  direct: { label: '직선 전진형', desc: '공간 패스·침투·빠른 마무리', color: '#f5a623' },
  wing: { label: '측면 전환형', desc: '전환·오버랩·약측 공략', color: '#5aa9f0' },
  pressproof: { label: '압박 회피형', desc: '리셋·상황 대응·후방 안정', color: '#c8a0e8' },
};

function ensureStore() {
  club.identityXp = { positional: 0, direct: 0, wing: 0, pressproof: 0, ...(club.identityXp || {}) };
  return club.identityXp;
}

export function identitySummary() {
  const xp = ensureStore();
  const entries = Object.entries(xp).sort((a, b) => b[1] - a[1]);
  const [id, value] = entries[0];
  return { id, value, xp, ...(IDENTITIES[id] || IDENTITIES.positional) };
}

export function inferIdentityFromMatch(state, outcome) {
  const f = state.facts || {};
  const gains = {
    positional: (f.linesBroken || 0) * 2 + (state.actionHistory || []).filter((a) => a === 'bounce' || a === 'third_man').length * 3,
    direct: (f.runs || 0) * 3 + (state.actionHistory || []).filter((a) => a === 'into_space').length * 3 + (outcome?.tone === 'goal' ? 2 : 0),
    wing: (f.switches || 0) * 4 + (state.lineIntents?.back === 'overlap' ? 2 : 0),
    pressproof: (f.situationsResolved || 0) * 4 + (f.decisionsMade || 0) * 2 + (state.lineIntents?.back === 'hold' ? 1 : 0),
  };
  const max = Math.max(1, ...Object.values(gains));
  const normalized = {};
  for (const [id, value] of Object.entries(gains)) normalized[id] = Math.max(0, Math.round((value / max) * Math.min(max, 6)));
  return normalized;
}

export function addIdentityXp(gains = {}) {
  const xp = ensureStore();
  for (const [id, value] of Object.entries(gains)) {
    if (xp[id] == null) xp[id] = 0;
    xp[id] += Math.max(0, Number(value) || 0);
  }
  return identitySummary();
}

export function trainingOptionsFromReport(report, state) {
  const read = `${report?.read || ''} ${report?.next || ''}`;
  const f = state?.facts || {};
  if (read.includes('전환') || f.switches >= 2) {
    return [
      { id: 'wide_switch', label: '전환 패턴 훈련', desc: '측면 전환형 XP +4 · DF +1', pos: 'df', identity: 'wing' },
      { id: 'central_combo', label: '중앙 조합 훈련', desc: '점유형 XP +4 · MF +1', pos: 'mf', identity: 'positional' },
    ];
  }
  if (read.includes('압박') || f.situationsResolved > 0 || f.decisionsMade > 0) {
    return [
      { id: 'press_escape', label: '압박 탈출 훈련', desc: '압박 회피형 XP +4 · MF +1', pos: 'mf', identity: 'pressproof' },
      { id: 'rest_defense', label: '후방 균형 훈련', desc: '압박 회피형 XP +3 · DF +1 · 2경기 수비 흐름', pos: 'df', identity: 'pressproof', effect: 'def' },
    ];
  }
  if (read.includes('마무리') || report?.decisive?.includes('xG')) {
    return [
      { id: 'finish_run', label: '침투 마무리 훈련', desc: '직선 전진형 XP +4 · FW +1', pos: 'fw', identity: 'direct' },
      { id: 'third_man', label: '써드맨 반복 훈련', desc: '점유형 XP +4 · MF +1', pos: 'mf', identity: 'positional' },
    ];
  }
  return [
    { id: 'buildout', label: '빌드업 기본기', desc: '점유형 XP +3 · MF +1', pos: 'mf', identity: 'positional' },
    { id: 'vertical', label: '전진 타이밍', desc: '직선 전진형 XP +3 · FW +1', pos: 'fw', identity: 'direct' },
  ];
}

export function applyTrainingChoice(option) {
  if (!option) return null;
  grantLevels(option.pos, 1);
  addIdentityXp({ [option.identity]: option.id === 'rest_defense' ? 3 : 4 });
  if (option.effect === 'def') {
    addEffect({ type: 'form', defMul: 1.06, until: club.matchday + 2, label: '후방 균형 훈련', tone: 'good' });
  }
  save();
  return identitySummary();
}
