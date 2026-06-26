import { addEffect, addTrainingEffect, club, grantLevels, save } from './club.js';
import { ACTION_LABELS } from '../engine/tactics.js';

// 시즌 목표 추적 헬퍼 (season-goals.js 와 main.js 경기 정산이 호출).
// dominantId: 이번 경기 우세 정체성 id (inferIdentityFromMatch gains 의 최대값).
// 직전 경기와 같으면 count++, 다르면 { id: dominantId, count: 1 } 로 리셋.
export function updateIdentityStreak(dominantId) {
  const cur = club.identityStreak || { id: null, count: 0 };
  if (!dominantId) { club.identityStreak = { id: null, count: 0 }; return club.identityStreak; }
  if (cur.id === dominantId) club.identityStreak = { id: dominantId, count: (cur.count || 0) + 1 };
  else club.identityStreak = { id: dominantId, count: 1 };
  return club.identityStreak;
}

// 시나리오 셀별 승 누적 — 승(result==='w')일 때만 호출.
export function addScenarioWin(cell) {
  if (!cell) return club.scenarioWins || {};
  club.scenarioWins = { ...(club.scenarioWins || {}) };
  club.scenarioWins[cell] = (club.scenarioWins[cell] || 0) + 1;
  return club.scenarioWins;
}

// gains 객체에서 우세 정체성 id 추출 (동점이면 임의 하나, 빈 gains 면 null).
export function dominantIdentityFromGains(gains = {}) {
  const entries = Object.entries(gains).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// ── 정체성 레벨 (roadmap P4) ──
// identityXp 누적 → Lv1~4. 임계값은 장기 플레이에서 자연스럽게 도달하도록 설정.
//   Lv1(0+): 표시만 / Lv2(8+): / Lv3(20+): 관련 액션 위험도 소폭 안정화
//   Lv4(40+): 고유 퍽 해금 게이트 (philosophy.js T4)
export const IDENTITY_LEVEL_THRESHOLDS = [0, 8, 20, 40];

export function identityLevel(xp) {
  const v = Math.max(0, Number(xp) || 0);
  let lv = 1;
  for (let i = 0; i < IDENTITY_LEVEL_THRESHOLDS.length; i++) {
    if (v >= IDENTITY_LEVEL_THRESHOLDS[i]) lv = i + 1;
  }
  return lv;
}

// 각 정체성의 "관련 액션" — Lv3+ 에서 위험도 보정을 받을 행동.
// positional(점유 조립)=조합 플레이 / direct(직선 전진)=침투 / wing(측면 전환)=전환
// pressproof(압박 회피)=지연·운반 회피. design §4.3 획득 기준과 대응.
export const IDENTITY_ACTIONS = {
  positional: ['to_feet'],        // 짧은 발밑 연결(원투·써드맨은 dt로 자연 발생)
  direct: ['pass_space'],         // 전방 공간 패스·침투
  wing: ['pass_space'],           // 측면 공간 패스(전환 흡수)
  pressproof: ['hold', 'carry'],
};

// 현재 클럽의 주 정체성 레벨 + 관련 액션 — engine state.identityLevel 로 주입됨.
// { id, level, actions } 또는 null(정체성 미확정/레벨 1 미만 의미 없음).
export function activeIdentityLevel() {
  const id = club.philosophy;
  if (!id) return null;
  const xp = club.identityXp?.[id] ?? 0;
  const level = identityLevel(xp);
  return { id, level, actions: IDENTITY_ACTIONS[id] || [] };
}

// 스캐닝(E7, research §3.7): 수신 전 지각. 읽기 계열 정체성(점유 조립·압박 회피)의
// 누적이 클럽의 사전 스캔 능력을 키운다 → 전진 패스·수신이 안정. 0~1, 60XP에서 최대.
// 별도 저장 필드 없이 기존 identityXp에서 파생(마이그레이션 불필요).
export function scanFactor() {
  const xp = club.identityXp || {};
  const reading = (xp.positional || 0) + (xp.pressproof || 0);
  return Math.min(1, reading / 60);
}

export const IDENTITIES = {
  positional: { label: '점유 조립형', desc: '짧은 발밑 연결로 라인 사이 전개', color: '#5dd6c5' },
  direct: { label: '직선 전진형', desc: '공간 패스·침투·빠른 마무리', color: '#f5a623' },
  wing: { label: '측면 전환형', desc: '측면 공간 패스·오버랩·약측 공략', color: '#5aa9f0' },
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
  const ah = state.actionHistory || [];
  const cnt = (id) => ah.filter((a) => a === id).length;
  const spaceFwd = Math.max(0, cnt('pass_space') - (f.switches || 0)); // 전방 공간 패스(측면 전환 제외)
  const gains = {
    positional: (f.linesBroken || 0) * 2 + cnt('to_feet') * 1.5,
    direct: (f.runs || 0) * 3 + spaceFwd * 3 + (outcome?.tone === 'goal' ? 2 : 0),
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

// 다음 경기 효과를 설명하는 라벨 도출 — actions/score/multiplier 에서 텍스트로.
// UI(결과 화면 배지 + 허브 칩) 양쪽에서 재사용하며, 엔진 보정과의 정합성은
// trainingOptionsFromReport 가 내는 actions/score 자체이므로 여기선 표현만 담당.
// roadmap P2: "선택 전 다음 경기 효과를 알 수 있어야 한다."
function formatEffectText(option) {
  const parts = [];
  const acts = (option.actions || []).map((a) => ACTION_LABELS[a] || a).join('·');
  const mul = option.multiplier ?? 0.88;
  if (acts && mul < 1) parts.push(`${acts} 위험도 ↓`);
  const score = option.score || {};
  if (score.execAdd > 0) parts.push(`수행 +${score.execAdd.toFixed(2)}`);
  if (score.xgMul && score.xgMul > 1) parts.push(`xG ×${score.xgMul.toFixed(2)}`);
  if (score.concedeMul && score.concedeMul < 1) parts.push(`실점 ×${score.concedeMul.toFixed(2)}`);
  return parts.join(' / ') || '다음 경기 보정';
}

export function trainingOptionsFromReport(report, state) {
  const read = `${report?.read || ''} ${report?.next || ''}`;
  const f = state?.facts || {};
  const make = (o) => ({ ...o, nextEffect: formatEffectText(o) });
  if (read.includes('전환') || f.switches >= 2) {
    return [
      make({ id: 'wide_switch', label: '측면 전환 훈련', desc: '측면 전환형 XP +4 · DF +1 · 다음 경기 측면 공간 패스 위험 감소', pos: 'df', identity: 'wing', actions: ['pass_space'], score: { execAdd: 0.04 } }),
      make({ id: 'central_combo', label: '짧은 연결 훈련', desc: '점유 조립형 XP +4 · MF +1 · 다음 경기 짧은 발밑 연결 강화', pos: 'mf', identity: 'positional', actions: ['to_feet'], score: { execAdd: 0.04 } }),
    ];
  }
  if (read.includes('압박') || f.situationsResolved > 0 || f.decisionsMade > 0) {
    return [
      make({ id: 'press_escape', label: '압박 탈출 훈련', desc: '압박 회피형 XP +4 · MF +1 · 다음 경기 압박 탈출 행동 강화', pos: 'mf', identity: 'pressproof', actions: ['hold', 'carry'], score: { execAdd: 0.03 } }),
      make({ id: 'rest_defense', label: '후방 균형 훈련', desc: '압박 회피형 XP +3 · DF +1 · 2경기 수비 폼/실점 억제', pos: 'df', identity: 'pressproof', effect: 'def', actions: ['hold'], score: { concedeMul: 0.93 }, duration: 2 }),
    ];
  }
  if (read.includes('마무리') || report?.decisive?.includes('xG')) {
    return [
      make({ id: 'finish_run', label: '침투 마무리 훈련', desc: '직선 전진형 XP +4 · FW +1 · 다음 경기 공간 침투/마무리 보정', pos: 'fw', identity: 'direct', actions: ['pass_space'], score: { xgMul: 1.06 } }),
      make({ id: 'short_combo', label: '짧은 연결 반복 훈련', desc: '점유 조립형 XP +4 · MF +1 · 다음 경기 짧은 발밑 연결 강화', pos: 'mf', identity: 'positional', actions: ['to_feet'], score: { execAdd: 0.04 } }),
    ];
  }
  return [
    make({ id: 'buildout', label: '빌드업 기본기', desc: '점유 조립형 XP +3 · MF +1 · 다음 경기 짧은 연결 안정', pos: 'mf', identity: 'positional', actions: ['to_feet'], score: { execAdd: 0.03 } }),
    make({ id: 'vertical', label: '전진 타이밍', desc: '직선 전진형 XP +3 · FW +1 · 다음 경기 공간 침투 타이밍 강화', pos: 'fw', identity: 'direct', actions: ['pass_space'], score: { execAdd: 0.03 } }),
  ];
}

function trainingEffectFromOption(option) {
  if (!option?.actions?.length && !option?.score) return null;
  const duration = Math.max(1, option.duration || 1);
  return {
    id: option.id,
    label: option.label,
    nextEffect: option.nextEffect || formatEffectText(option),
    tone: 'good',
    until: club.matchday + duration,
    actions: option.actions || [],
    multiplier: option.multiplier || 0.88,
    score: option.score || {},
  };
}

export function applyTrainingChoice(option) {
  if (!option) return null;
  grantLevels(option.pos, 1);
  addIdentityXp({ [option.identity]: option.id === 'rest_defense' ? 3 : 4 });
  const trainingEffect = trainingEffectFromOption(option);
  if (trainingEffect) addTrainingEffect(trainingEffect);
  if (option.effect === 'def') {
    addEffect({ type: 'form', defMul: 1.06, until: club.matchday + 2, label: '후방 균형 훈련', tone: 'good' });
  }
  save();
  return identitySummary();
}
