// Phase 0 정책 토대 — docs/symmetric-duel-design.md.
//
// 계약: 정책은 engine.state 를 직접 수정하지 않는다. PolicyView 를 읽고
// PolicyAction 을 "반환만" 한다. 실제 상태 변경은 executePolicyAction 이
// 기존 엔진 API(dispatch / chooseSituationOption / openPressingMode)로 수행한다.
// 확률 판정은 엔진만 한다. 정책은 DOM 을 읽지 않는다.

import { evaluateBoard } from './evaluator.js';
import { oppBuildDryRun } from './dry-run.js';
import { PITCH_W } from '../data/pitch.js';

// 애니메이션 정착 — dispatch 후 busy 가 풀릴 때까지 update 펌프(헤드리스 공통 idiom).
export function settle(engine, maxSteps = 200, dtMs = 16) {
  for (let i = 0; i < maxSteps && engine.busy; i++) engine.update(dtMs);
}

// 현재 상태 → 정책이 읽을 관측값(PolicyView).
// Phase 0: 좌표 미러 없이 기존 엔진에서 안전히 읽을 수 있는 값만 채운다.
export function buildPolicyView(engine, side = 'us') {
  const s = engine.state;
  const holder = engine.holder?.() ?? null;
  const md = s.matchDecision || null;
  const board = (!md && holder?.side === 'us') ? evaluateBoard(engine) : null;
  const oppBuild = oppBuildDryRun(engine);
  const dp = s.defensivePress || null;
  return {
    side,
    possession: holder?.side === 'opp' ? 'opp' : 'us',
    phase: s.phase,
    holderId: s.holderId,
    turn: s.turn,
    status: s.status,
    recentActions: [...(s.actionHistory ?? [])],
    legalActions: legalActionsFor(engine, md, holder),
    boardRead: board,
    oppBuildRead: oppBuild,
    pressRead: dp ? { regainP: dp.regainP, cutP: dp.cutP } : null,
    situation: md
      ? { id: md.id, choices: md.choices.map((c) => ({ id: c.id, label: c.label, desc: c.desc })) }
      : null,
  };
}

function legalActionsFor(engine, md, holder) {
  if (md) return md.choices.map((c) => c.id);
  if (holder?.side !== 'us') return [];
  const acts = ['to_feet', 'pass_space', 'carry', 'hold', 'press_mode'];
  if (engine.shotZoneNow?.()) acts.push('shoot');
  return acts;
}

// PolicyAction 을 기존 엔진 API 로 실행. 정책은 절대 state 를 직접 안 건드린다.
export function executePolicyAction(engine, action) {
  if (!action || action.kind === 'noop') return { ok: false, noop: true };
  if (action.kind === 'situation_choice') return engine.chooseSituationOption(action.choiceId);
  if (action.kind === 'engine_action') {
    if (action.actionId === 'press_mode') return engine.openPressingMode();
    return engine.dispatch(action.actionId, action.targetId ?? null, action.point ?? undefined);
  }
  return { ok: false, rejected: true };
}

// ── 기본 정책 3종 ─────────────────────────────────────────────────

// 공격: boardRead.best 를 고른다. 좋은 슛이면 슛, 좋은 패스면 패스, 없으면 기다리기.
export function attackPolicy(view) {
  const b = chooseAttackCandidate(view);
  if (!b) return { kind: 'engine_action', actionId: 'hold', confidence: 0.2, reason: 'no good option, recycle' };
  if (b.type === 'shot') {
    return { kind: 'engine_action', actionId: 'shoot', confidence: b.safety, reason: `shot xG ${Math.round((b.safety ?? 0) * 100)}%` };
  }
  if (b.action === 'carry' && b.point) {
    return { kind: 'engine_action', actionId: 'carry', point: b.point, confidence: b.safety, reason: 'carry to bait/advance' };
  }
  if (b.action === 'pass_space') {
    return { kind: 'engine_action', actionId: 'pass_space', point: { x: Math.min((b.target?.x ?? 0) + 10, PITCH_W - 2), y: b.target?.y }, confidence: b.safety, reason: 'best space lane' };
  }
  return { kind: 'engine_action', actionId: 'to_feet', targetId: b.target?.id, confidence: b.safety, reason: 'best safe lane' };
}

function chooseAttackCandidate(view) {
  const candidates = view.boardRead?.candidates ?? [];
  if (view.legalActions.includes('shoot')) {
    const shot = candidates.find((candidate) => candidate.type === 'shot');
    if (shot && (shot.safety >= 0.12 || view.turn >= 10)) return shot;
  }
  const repeatedSpace = view.recentActions?.slice(-2).every((action) => action === 'pass_space');
  const ranked = [...candidates]
    .filter((candidate) => candidate.action !== 'shoot')
    .map((candidate) => ({
      candidate,
      value: candidate.net
        - (repeatedSpace && candidate.action === 'pass_space' ? 0.32 : 0)
        + (candidate.action === 'to_feet' && repeatedSpace ? 0.12 : 0),
    }))
    .sort((a, b) => b.value - a.value);
  return ranked[0]?.candidate ?? view.boardRead?.best ?? null;
}

// 압박: 압박 결정이 열려 있으면 regainP/cutP/실패비용으로 강압·차단·후퇴를 고른다.
export function pressPolicy(view) {
  const pr = view.pressRead;
  if (!view.situation || view.situation.id !== 'defensive_press' || !pr) {
    return { kind: 'noop', reason: 'no press decision' };
  }
  const read = view.oppBuildRead ?? null;
  const best = read?.best ?? null;
  const trap = read?.trap ?? null;
  const gamble = read?.gamble ?? null;
  const bestSafety = best ? (best.safety ?? (1 - (best.risk ?? 0))) : 0.5;
  const carrierRisk = best?.risk ?? 0;
  const laneThreat = Math.max(best?.risk ?? 0, gamble?.risk ?? 0, trap?.risk ?? 0);
  const offLaneThreat = Math.max(0, laneThreat - carrierRisk);
  const values = {
    dp_press: pr.regainP * pr.regainP * 1.25 + carrierRisk * 0.14 - bestSafety * 0.08,
    dp_cut: pr.cutP * (0.35 + offLaneThreat * 0.8) + laneThreat * 0.08,
    dp_drop: 0.14 + (1 - laneThreat) * 0.5,
  };
  const [choiceId, value] = Object.entries(values).sort((a, b) => b[1] - a[1])[0];
  const reason = choiceId === 'dp_press' ? 'press the exposed carrier'
    : choiceId === 'dp_cut' ? 'cut the dangerous escape lane'
    : 'opp escape is safe — drop into block';
  return { kind: 'situation_choice', choiceId, confidence: Math.min(0.95, Math.max(0.05, value)), reason };
}

function summarizeLane(candidate) {
  if (!candidate) return null;
  return {
    targetId: candidate.target?.id ?? null,
    label: candidate.target?.label ?? null,
    risk: Math.round((candidate.risk ?? 0) * 100) / 100,
    safety: Math.round((candidate.safety ?? 0) * 100) / 100,
    net: Math.round((candidate.net ?? 0) * 100) / 100,
  };
}

function laneName(lane) {
  return lane?.label ?? lane?.targetId ?? 'unknown';
}

function buildPressingOpinion(action, best, trap, pressRead) {
  const choice = action.choiceId;
  if (choice === 'dp_press') {
    return `강하게 붙는다. 리게인 ${Math.round((pressRead?.regainP ?? 0) * 100)}%, 최선 탈출 레인 위험 ${Math.round((best?.risk ?? 0) * 100)}%.`;
  }
  if (choice === 'dp_cut') {
    return `패스길을 먼저 닫는다. ${laneName(trap ?? best)} 쪽 위험 레인이 열렸고 차단 성공 ${Math.round((pressRead?.cutP ?? 0) * 100)}%.`;
  }
  return `물러난다. 직접 압박 성공 ${Math.round((pressRead?.regainP ?? 0) * 100)}%라서 실패 비용이 더 크다.`;
}

function buildBuildUpOpinion(best) {
  if (!best) return '탈압박 쪽은 확실한 출구가 없다. 리셋하거나 압박을 더 끌어내야 한다.';
  return `${laneName(best)}에게 풀어낸다. 안전도 ${Math.round((best.safety ?? 0) * 100)}%, 전진 보상 ${Math.round((best.net ?? 0) * 100)}점.`;
}

export function buildPressDecisionTrace(view, action) {
  if (!view?.situation || view.situation.id !== 'defensive_press' || action?.kind !== 'situation_choice') return null;
  const read = view.oppBuildRead ?? null;
  const best = summarizeLane(read?.best);
  const gamble = summarizeLane(read?.gamble);
  const trap = summarizeLane(read?.trap);
  return {
    choiceId: action.choiceId,
    reason: action.reason ?? null,
    confidence: Math.round((action.confidence ?? 0) * 100) / 100,
    holderId: read?.holderId ?? null,
    holderAssumption: read?.holderAssumption ?? null,
    pressingOpinion: buildPressingOpinion(action, best, trap, view.pressRead),
    buildUpOpinion: buildBuildUpOpinion(best),
    best,
    gamble,
    trap,
  };
}

// 결합 정책: 상황이면 압박/상황 정책, 아니면 공격 정책. 스톨 방지 폴백 포함.
export function aiPolicy(view) {
  if (view.situation) {
    const press = pressPolicy(view);
    if (press.kind !== 'noop') return press;
    const first = view.situation.choices[0];
    return first ? { kind: 'situation_choice', choiceId: first.id, reason: 'default situation choice' } : { kind: 'noop' };
  }
  return attackPolicy(view);
}

// PolicyAction 형태 검증(테스트·하니스 공용).
export function isValidPolicyAction(a) {
  if (!a || typeof a !== 'object') return false;
  if (a.kind === 'noop') return true;
  if (a.kind === 'situation_choice') return typeof a.choiceId === 'string';
  if (a.kind === 'engine_action') return typeof a.actionId === 'string';
  return false;
}
