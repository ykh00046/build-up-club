// Phase 2b (아주 얇게) — resolvePossession 결과를 엔진 상태에 적용하는 어댑터.
//
// 여기서부터 "실제 플레이 경로"에 닿는다. 그래서 최소 침습 원칙:
//   - engine.js 를 수정하지 않는다(별도 모듈). 나중에 엔진/하니스가 이 함수를 "호출"만 한다.
//   - engine.state 의 필수 필드만 바꾼다(possession/holderId/phase + 전환 시 정리).
//   - 존재하는 선수만 점유자로 삼는다(가드).
//   - 아직 어디서도 자동 호출하지 않는다 — 인기척 없이 붙여두고, 연결은 다음 슬라이스에서.
//
// engine.state 만 읽고/쓰므로 합성 { state } 객체로도 동작 → 샌드박스 테스트 가능.

import { resolvePossession } from './possession.js';
import { oppBuildDryRun } from './dry-run.js';
import { PHASE_LINES, PITCH_W } from '../data/pitch.js';
import { chooseOppBuild } from './opp-build-policy.js';

// 전환 descriptor 를 엔진 state 에 적용. 적용하면 적용된 descriptor 를, 못 하면 null 반환.
export function applyPossession(engine, transition) {
  const state = engine?.state;
  if (!state || !transition) return null;
  const holder = state.players?.find((p) => p.id === transition.holderId);
  if (!holder) return null;                       // 안전: 실존 선수만 점유자로

  state.possession = transition.possession;
  state.holderId = transition.holderId;
  state.phase = transition.phase ?? 'BUILDUP';

  // 전환 순간 진행 중이던 결정/압박 창은 종료해 상태 불일치를 막는다.
  state.matchDecision = null;
  state.transition = null;
  state.defensivePress = null;

  // 새 점유자는 전방을 향하고, 볼을 그 발밑으로 동기화(있으면).
  if (holder.orientation !== undefined) holder.orientation = 'FACING';
  if (state.ball && Number.isFinite(holder.x)) { state.ball.x = holder.x; state.ball.y = holder.y; }

  return { ...transition };
}

// 편의: 이벤트로부터 바로 계산 + 적용. (resolvePossession → applyPossession)
export function applyPossessionEvent(engine, event, options = {}) {
  const t = resolvePossession(engine?.state, event, options);
  return t ? applyPossession(engine, t) : null;
}

function phaseFor(side, x) {
  const progress = side === 'opp' ? PITCH_W - x : x;
  if (progress > PHASE_LINES.FINAL_THIRD) return 'FINAL_THIRD';
  if (progress > PHASE_LINES.PROGRESSION) return 'PROGRESSION';
  return 'BUILDUP';
}

export function applyOpponentBuildStep(engine, options = {}) {
  const state = engine?.state;
  if (!state || state.status !== 'live' || state.possession !== 'opp') return null;
  const read = oppBuildDryRun(engine, options);
  // best 만 고르지 않고 성향(options.disposition)에 따라 best/gamble/trap 중 선택 → 상대 빌드업 다양성.
  const choice = chooseOppBuild(read, options.disposition, options.rng);
  const targetId = choice?.target?.id;
  const target = state.players?.find((p) => p.id === targetId && p.side === 'opp');
  if (!target) return null;
  const fromId = state.holderId;
  const from = state.players?.find((p) => p.id === fromId);
  const progress = from ? from.x - target.x : choice.progress;
  if (progress < 1) {
    return {
      ok: false,
      stalled: true,
      reason: 'no forward opponent build-up lane',
      fromId,
      targetId: target.id,
      at: from ? { x: from.x, y: from.y } : { x: target.x, y: target.y },
    };
  }
  state.turn++;
  state.currentAction = 'opp_to_feet';
  state.holderId = target.id;
  state.phase = phaseFor('opp', target.x);
  if (target.orientation !== undefined) target.orientation = 'FACING';
  if (state.ball && Number.isFinite(target.x)) { state.ball.x = target.x; state.ball.y = target.y; }
  return {
    ok: true,
    action: 'opp_to_feet',
    fromId,
    targetId: target.id,
    phase: state.phase,
    progress,
    risk: choice.risk,
    safety: choice.safety,
    disposition: options.disposition ?? 'best',
  };
}
