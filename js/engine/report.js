import { ACTION_LABELS } from './tactics.js';
import { josa } from '../util/josa.js';

const INTENT_LABELS = {
  front: { pin: '전방 고정', drop: '전방 내려와 연결' },
  mid: { between: '중원 라인 사이', support: '중원 빌드업 보조' },
  back: { overlap: '풀백 전진', hold: '후방 안정' },
};

function topAction(history = []) {
  const counts = new Map();
  for (const action of history) counts.set(action, (counts.get(action) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
}

function joinIntents(lineIntents = {}) {
  return Object.entries(lineIntents)
    .map(([group, intent]) => INTENT_LABELS[group]?.[intent])
    .filter(Boolean)
    .join(' · ');
}

function pickWorked(state) {
  const f = state.facts || {};
  const helpful = (state.lastTacticalFactors || []).filter((x) => x.multiplier < 1);
  if (f.situationsResolved > 0) return `상황 대응 ${f.situationsResolved}회로 상대 변화를 다시 흔들었습니다.`;
  if (f.windowsUsed > 0) return `열린 공간을 ${f.windowsUsed}회 활용해 압박 뒤를 공략했습니다.`;
  if (f.linesBroken > 0) return `라인 ${f.linesBroken}개를 통과하며 전진 구조는 만들었습니다.`;
  if ((state.scanFactor || 0) >= 0.5) return '스캔으로 압박을 미리 읽어 전진이 안정적이었습니다.'; // E7
  if (helpful[0]) return helpful[0].label;
  return joinIntents(state.lineIntents) || '전술 구조를 유지했습니다.';
}

function pickRead(state) {
  const active = state.situations?.active || [];
  const costly = (state.lastTacticalFactors || []).filter((x) => x.multiplier > 1);
  if (active.length) return `${josa(active.at(-1).title, '이', '가')} 해결되지 않은 채 남았습니다.`;
  if (state.adaptRead) return `${ACTION_LABELS[state.adaptRead] ?? state.adaptRead} 반복을 상대가 읽기 시작했습니다.`;
  if (costly[0]) return costly[0].label;
  const top = topAction(state.actionHistory);
  if (top && top[1] >= 2) return `${ACTION_LABELS[top[0]] ?? top[0]} 비중이 높았습니다. 다음엔 한 번 변주가 필요합니다.`;
  return '상대에게 뚜렷하게 읽힌 패턴은 없었습니다.';
}

function pickDecisive(outcome, state) {
  const zone = outcome?.zoneId ? ` · 슛 존 ${outcome.zoneId}` : '';
  const xg = outcome?.xg != null ? ` · xG ${Math.round(outcome.xg * 100)}%` : '';
  const tone = outcome?.tone === 'goal' ? '득점' : outcome?.tone === 'near' ? '찬스' : '공격 종료';
  return `${tone}${zone}${xg} · ${state.turn}턴`;
}

function clampUnit(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// 결과를 실제 축구 지표 언어로 설명한다 (enhancement-plan E2). 새 시뮬레이션 없이
// 이미 집계 중인 facts·xG를 재표현만 한다.
//  - packing : 라인 브레이킹 = 패스·드리블로 제친 상대 라인 수 (facts.linesBroken)
//  - xt      : 기대 위협 지수 — 전진 행동의 가중합을 0~100으로 근사
//  - xg      : 마무리 찬스의 질 (outcome.xg)
//  - dominance: 빌드업 지배력 — 유인·전진·해결 종합 0~100
function buildMetrics(state, outcome) {
  const f = state.facts || {};
  const packing = f.linesBroken || 0;
  const xtRaw = packing * 0.14 + (f.windowsUsed || 0) * 0.12 + (f.switches || 0) * 0.09
    + (f.runs || 0) * 0.05 + (f.situationsResolved || 0) * 0.08 + (f.decisionsMade || 0) * 0.03;
  const domRaw = (f.baits || 0) * 0.04 + packing * 0.12 + (f.switches || 0) * 0.08
    + (f.windowsUsed || 0) * 0.10 + (f.situationsResolved || 0) * 0.09 + (f.runs || 0) * 0.04;
  return {
    packing,
    xt: Math.round(clampUnit(xtRaw) * 100),
    dominance: Math.round(clampUnit(domRaw) * 100),
    xg: outcome?.xg != null ? Math.round(outcome.xg * 100) : null,
  };
}

// 만든 우위 분류 (E3, research §2.3). facts로부터 어떤 우위를 만들었는지 읽어
// 결과를 우위 언어로 설명한다. 질적(유인→전환 고립) > 위치(라인 사이/배후) > 수적.
function classifySuperiority(f = {}) {
  if ((f.baits || 0) >= 2 && (f.switches || 0) >= 1) return '질적 우위 — 유인 후 전환으로 약측 1v1 고립';
  if ((f.linesBroken || 0) >= 2 || (f.windowsUsed || 0) >= 1) return '위치 우위 — 라인 사이·배후를 점유';
  if ((f.situationsResolved || 0) >= 1 || (f.runs || 0) >= 2 || (f.switches || 0) >= 1) return '수적 우위 — 상황·침투로 국지적 과부하';
  return '뚜렷한 우위는 만들지 못했습니다';
}

// 수비 전환 노출 읽기 (E1, research §3.1). 볼을 잃었을 때 역습 위험을, 통제 신호
// (상황 해결·라인 통과·후방 안정)로 가늠한다. 마무리 국면 도달은 전환 안정.
function classifyTransition(state, outcome) {
  const f = state.facts || {};
  const tone = outcome?.tone;
  if ((f.counterpressWins || 0) > 0) return `카운터프레스 ${f.counterpressWins}회 성공 — 5초 안에 되찾아 재공격`;
  if (tone === 'goal' || tone === 'near') return '전환 안정 — 마무리 국면까지 도달, 레스트 어택 확보';
  const controlled = (f.situationsResolved || 0) >= 1 || (f.linesBroken || 0) >= 2 || state.lineIntents?.back === 'hold';
  if (controlled) return '전환 노출 중간 — 통제된 상실, 카운터프레스 5초 안에 회복 가능';
  return '전환 노출 높음 — 무리한 전개 후 역습 위험. 다음엔 후방 안정으로 레스트 디펜스를 먼저 갖추세요';
}

function pickNext(state, outcome) {
  const active = state.situations?.active || [];
  if (active.some((s) => s.id === 'pressure_surge')) return '압박 강화가 보이면 기다리기보다 빠른 원터치 발밑 연결로 첫 압박선을 바로 벗기세요.';
  if (active.some((s) => s.id === 'flank_lock')) return '전환이 읽히면 중앙 조합으로 수비를 다시 모은 뒤 약측을 여세요.';
  if (active.some((s) => s.id === 'counter_risk')) return '풀백 전진 후 공격이 막히면 후방 안정으로 역습 리스크를 먼저 줄이세요.';
  if (state.adaptRead) return `${ACTION_LABELS[state.adaptRead] ?? state.adaptRead}를 한 번 쉬고 다른 루트로 시작하세요.`;
  if (outcome?.tone === 'fail') return '다음 시도는 전진보다 출구 확보를 먼저 보고, 첫 패스 전 압박수를 한 번 더 움직이세요.';
  if (outcome?.tone === 'near') return '찬스까지는 만들었습니다. 마지막 패스 직전 슛 각도와 압박 거리를 한 번 더 확인하세요.';
  return '성공 루트가 보였습니다. 같은 구조를 반복하기 전 한 번 다른 액션으로 상대 적응을 늦추세요.';
}

export function buildTacticalReport(state, outcome) {
  return {
    worked: pickWorked(state),
    read: pickRead(state),
    decisive: pickDecisive(outcome, state),
    next: pickNext(state, outcome),
    metrics: buildMetrics(state, outcome),
    superiority: classifySuperiority(state.facts),
    transition: classifyTransition(state, outcome),
  };
}
