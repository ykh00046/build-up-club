import { ACTION_LABELS } from './tactics.js';
import { SHOT_ZONES } from './shots.js';
import { josa } from '../util/josa.js';
import { t, getLang } from '../career/i18n.js';

// Valid line-intent combinations → their i18n key. The map doubles as the
// validity filter (invalid group/intent pairs resolve to undefined and drop),
// while the display value is resolved through t() so it follows the language.
const INTENT_KEYS = {
  front: { pin: 'rep.intent.front.pin', drop: 'rep.intent.front.drop' },
  mid: { between: 'rep.intent.mid.between', support: 'rep.intent.mid.support' },
  back: { overlap: 'rep.intent.back.overlap', hold: 'rep.intent.back.hold' },
};

function topAction(history = []) {
  const counts = new Map();
  for (const action of history) counts.set(action, (counts.get(action) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
}

function joinIntents(lineIntents = {}) {
  return Object.entries(lineIntents)
    .map(([group, intent]) => INTENT_KEYS[group]?.[intent])
    .filter(Boolean)
    .map((key) => t(key))
    .join(' · ');
}

function pickWorked(state) {
  const f = state.facts || {};
  const helpful = (state.lastTacticalFactors || []).filter((x) => x.multiplier < 1);
  if ((f.defensivePressWins || 0) > 0) return t('rep.worked.press').replace('{n}', String(f.defensivePressWins));
  if (f.situationsResolved > 0) return t('rep.worked.situations').replace('{n}', String(f.situationsResolved));
  if (f.windowsUsed > 0) return t('rep.worked.windows').replace('{n}', String(f.windowsUsed));
  if (f.linesBroken > 0) return t('rep.worked.lines').replace('{n}', String(f.linesBroken));
  if ((state.scanFactor || 0) >= 0.5) return t('rep.worked.scan'); // E7
  if (helpful[0]) return helpful[0].label;
  return joinIntents(state.lineIntents) || t('rep.worked.structure');
}

function pickRead(state) {
  const active = state.situations?.active || [];
  const costly = (state.lastTacticalFactors || []).filter((x) => x.multiplier > 1);
  if (active.length) {
    const title = t(`sit.${active.at(-1).id}.title`);
    return getLang() === 'en'
      ? t('rep.read.situation').replace('{x}', title)
      : `${josa(title, '이', '가')} 해결되지 않은 채 남았습니다.`;
  }
  if (state.adaptRead) return t('rep.read.adapt').replace('{x}', ACTION_LABELS[state.adaptRead] ?? state.adaptRead);
  if (costly[0]) return costly[0].label;
  const top = topAction(state.actionHistory);
  if (top && top[1] >= 2) return t('rep.read.overused').replace('{x}', ACTION_LABELS[top[0]] ?? top[0]);
  return t('rep.read.none');
}

function pickDecisive(outcome, state) {
  const zoneDef = outcome?.zoneId ? SHOT_ZONES.find((z) => z.id === outcome.zoneId) : null;
  const zoneName = zoneDef ? (getLang() === 'en' ? zoneDef.en : zoneDef.ko) : (outcome?.zoneId ?? '');
  const zone = outcome?.zoneId ? t('rep.decisive.zone').replace('{x}', zoneName) : '';
  const xg = outcome?.xg != null ? ` · xG ${Math.round(outcome.xg * 100)}%` : '';
  const tone = outcome?.tone === 'goal' ? t('rep.tone.goal') : outcome?.tone === 'near' ? t('rep.tone.near') : t('rep.tone.end');
  return `${tone}${zone}${xg}${t('rep.decisive.turn').replace('{n}', String(state.turn))}`;
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
  if ((f.baits || 0) >= 2 && (f.switches || 0) >= 1) return t('rep.sup.qual');
  if ((f.linesBroken || 0) >= 2 || (f.windowsUsed || 0) >= 1) return t('rep.sup.pos');
  if ((f.situationsResolved || 0) >= 1 || (f.runs || 0) >= 2 || (f.switches || 0) >= 1) return t('rep.sup.num');
  return t('rep.sup.none');
}

// 수비 전환 노출 읽기 (E1, research §3.1). 볼을 잃었을 때 역습 위험을, 통제 신호
// (상황 해결·라인 통과·후방 안정)로 가늠한다. 마무리 국면 도달은 전환 안정.
function classifyTransition(state, outcome) {
  const f = state.facts || {};
  const tone = outcome?.tone;
  if ((f.defensivePressWins || 0) > 0) return t('rep.trans.press').replace('{n}', String(f.defensivePressWins));
  if ((f.counterpressWins || 0) > 0) return t('rep.trans.counter').replace('{n}', String(f.counterpressWins));
  if (tone === 'goal' || tone === 'near') return t('rep.trans.stable');
  const controlled = (f.situationsResolved || 0) >= 1 || (f.linesBroken || 0) >= 2 || state.lineIntents?.back === 'hold';
  if (controlled) return t('rep.trans.mid');
  return t('rep.trans.high');
}

function pickNext(state, outcome) {
  const active = state.situations?.active || [];
  if (active.some((s) => s.id === 'pressure_surge')) return t('rep.next.pressure');
  if (active.some((s) => s.id === 'flank_lock')) return t('rep.next.flank');
  if (active.some((s) => s.id === 'counter_risk')) return t('rep.next.counter');
  if (state.adaptRead) return t('rep.next.adapt').replace('{x}', ACTION_LABELS[state.adaptRead] ?? state.adaptRead);
  if (outcome?.tone === 'fail') {
    // 실패 원인을 직격해 신규 유저가 "왜 졌는지"를 1패에 배우게 한다.
    const kind = outcome?.kind;
    const tailored = {
      intercepted: 'rep.next.intercepted',
      tackled: 'rep.next.tackled',
      trapped: 'rep.next.trapped',
      collapsed: 'rep.next.collapsed',
      press_broken: 'rep.next.pressbroken',
    }[kind];
    if (tailored) return t(tailored);
    // 서두름: 압박을 유인(bait)하지 않고 일찍 잃은 경우.
    if ((state.turn ?? 99) <= 2 && (state.facts?.baits || 0) === 0) return t('rep.next.rushed');
    return t('rep.next.fail');
  }
  if (outcome?.tone === 'near') return t('rep.next.near');
  return t('rep.next.success');
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
