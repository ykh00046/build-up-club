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
  const dl = s.defenseLoop || null;
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
    // 압박 읽기 — 공격 국면 압박 모드(defensivePress) 또는 수비 국면(defenseLoop).
    // 수비 국면은 5택 판단 재료(지목 신뢰도·파울 예산·누적 카운터)까지 노출한다.
    pressRead: dp ? { regainP: dp.regainP, cutP: dp.cutP }
      : dl ? {
          regainP: dl.regainP, cutP: dl.cutP, markP: dl.markP ?? 0.7, pred: dl.pred ?? 1,
          steps: dl.steps, beaten: dl.beaten, contained: dl.contained,
          fouls: s.facts?.fouls ?? 0,
        }
      : null,
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
  if (b.action === 'hold') {
    return { kind: 'engine_action', actionId: 'hold', confidence: b.safety, reason: 'lanes closed — bait the press' };
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
// 수비 국면(defend)에서는 5택 — 지목 마크(성향 신뢰도 EV)와 전술 파울(위기 밸브,
// 파울 예산 2회 내)까지 판단한다. (자기대국 수비 수준 상향 — 3R)
export function pressPolicy(view) {
  const pr = view.pressRead;
  const sid = view.situation?.id;
  if (!view.situation || !pr || (sid !== 'defensive_press' && sid !== 'defend')) {
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
    // 내려서기 base = "안전한 탈출은 압박이 무의미" — 상대 최선 탈출이 저위험이면
    // 쫓아도 못 잡으니(press 성공률↓) 블록을 유지한다. 위협 레인이 있으면(risky)
    // press/cut이 이겨 drop이 밀린다.
    dp_drop: 0.14 + (1 - laneThreat) * 0.5,
  };
  if (sid === 'defend') {
    // 지목 마크 EV ≈ 적중률(pred) × markP — 위협 레인이 갈릴수록 선점 가치↑.
    values.dp_mark = (pr.markP ?? 0.7) * (pr.pred ?? 1) * (0.40 + offLaneThreat * 0.5);
    // 위기 에스컬레이션 사다리 — 뺏을 가망(regain/cut/mark 최선)과 파울 예산으로
    // 갈린다: (1) 가망 있으면 위 3택으로 뺏는다. (2) 가망 없고(<0.4) 이미 벗겨져
    // 슛이 임박하면 → 파울 예산이 남을 땐 전술 파울로 리셋(공격을 후방으로 되돌림),
    // (3) 파울까지 소진했으면 내려서기로 데미지 컨트롤(블록으로 슛 xG를 깎는 최후
    // 수단) — base보다 클 때만 승격. drop은 순EV로 늘 열등이라 이 지점에서만 최선.
    const bestOdds = Math.max(pr.regainP ?? 0, pr.cutP ?? 0, (pr.markP ?? 0) * (pr.pred ?? 1));
    const beatenDeep = (pr.beaten ?? 0) >= 1 && (pr.steps ?? 0) >= 1;
    const regainPoor = bestOdds < 0.40;
    const foulLeft = (pr.fouls ?? 0) < 2;
    values.dp_foul = beatenDeep ? (foulLeft ? (regainPoor ? 0.62 : 0.34) : 0.01) : 0.01;
    if (regainPoor && (pr.steps ?? 0) >= 1 && !foulLeft) {
      values.dp_drop = Math.max(values.dp_drop, 0.40 + (pr.contained ?? 0) * 0.10 + (1 - bestOdds) * 0.25);
    }
  }
  // choices가 없는 합성 뷰(테스트/프로브)는 필터 생략 — 있는 그대로 최댓값.
  const legal = new Set((view.situation.choices ?? []).map((c) => c.id));
  const [choiceId, value] = Object.entries(values)
    .filter(([id]) => legal.size === 0 || legal.has(id))
    .sort((a, b) => b[1] - a[1])[0];
  const REASONS = {
    dp_press: 'press the exposed carrier',
    dp_cut: 'cut the dangerous escape lane',
    dp_mark: 'predictable side — jump the expected receiver',
    dp_foul: 'beaten and in danger — burn a foul to reset',
    dp_drop: 'opp escape is safe — drop into block',
  };
  return { kind: 'situation_choice', choiceId, confidence: Math.min(0.95, Math.max(0.05, value)), reason: REASONS[choiceId] };
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
