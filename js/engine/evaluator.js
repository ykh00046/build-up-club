import { clamp } from '../data/pitch.js';

const ACTION_KO = {
  to_feet: '발밑 연결',
  pass_space: '공간 패스',
  hold: '기다리기',
  carry: '운반',
  shoot: '슛',
};

function holderLabel(engine) {
  return engine.holder?.()?.label ?? '볼 소유자';
}

function pct(value) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function actionLabel(action) {
  return ACTION_KO[action] ?? action;
}

function candidateLabel(candidate) {
  if (!candidate) return '';
  if (candidate.action === 'shoot') return `${holderLabel(candidate.engine)} ${actionLabel(candidate.action)}`;
  return `${candidate.target?.label ?? '동료'} ${actionLabel(candidate.action)}`;
}

function buildPassCandidates(engine, limit) {
  const h = engine.holder?.();
  if (!h || typeof engine.scanOptions !== 'function') return [];
  return engine.scanOptions(limit).map((opt) => {
    const targetX = opt.action === 'pass_space' ? opt.target.x + 10 : opt.target.x;
    const progress = targetX - h.x;
    const reward = opt.score + clamp(progress / 48, -0.15, 0.45);
    return {
      type: 'pass',
      action: opt.action,
      target: opt.target,
      risk: opt.risk,
      safety: 1 - opt.risk,
      score: opt.score,
      progress,
      reward,
      engine,
      reason: opt.why ?? null,
    };
  });
}

// carry 후보 — 보드가 패스만 세우면 "운반으로 첫 압박수를 끌어내라"는 브리핑과
// 모순되고 추천의 92%가 pass_space로 단조해진다(자기대국 감사). 전방 3방향
// (직진·하프스페이스 대각)을 previewCarry(디스패치와 동일식)로 재고 최고 1개만
// 후보로. 보상 통화는 패스 후보와 동일 단위(safety 0.50 / fwd 0.22 / phase 0.28)
// + 유인 보너스(carry는 TRIGGER 1.10 커밋 유도 + baits 적립) − 압박 +4 비용.
const PHASE_LINES_EV = { PROGRESSION: 40, FINAL_THIRD: 68 };
function buildCarryCandidate(engine) {
  const h = engine.holder?.();
  if (!h || typeof engine.previewCarry !== 'function') return null;
  const state = engine.state;
  // 연속 운반 차단 — 열린 공간 운반은 위험이 거의 없어(base 0.04) 후보로 상시
  // 노출하면 "걸어서 전진" 스팸이 된다(측정: goal 19→36% 붕괴). 직전이 운반이면
  // 후보 자체를 내리지 않는다: 운반→패스→운반 리듬만 추천.
  if ((state.actionHistory ?? []).slice(-2).includes('carry')) return null;
  const aims = [
    { x: h.x + 9, y: h.y },
    { x: h.x + 7, y: h.y - 6 },
    { x: h.x + 7, y: h.y + 6 },
  ];
  let best = null;
  for (const aim of aims) {
    const p = engine.previewCarry(aim);
    if (!p || p.risk >= 0.88) continue;
    const progress = p.to.x - h.x;
    if (progress < 2) continue;                      // 전진성 없는 운반은 제외
    const phaseBonus = (state.phase === 'BUILDUP' && p.to.x > PHASE_LINES_EV.PROGRESSION) ? 0.28
      : (state.phase === 'PROGRESSION' && p.to.x > PHASE_LINES_EV.FINAL_THIRD) ? 0.28 : 0;
    const baitBonus = 0.04;   // 커밋 유인 EV — 과대평가 시 carry 스팸(위 주석) 재발
    const score = (1 - p.risk) * 0.50 + clamp(progress / 55, -0.3, 1) * 0.22 + phaseBonus + baitBonus - 0.03;
    const reward = score + clamp(progress / 48, -0.15, 0.45);
    const cand = {
      type: 'pass',
      action: 'carry',
      target: h,
      point: p.to,
      risk: p.risk,
      safety: 1 - p.risk,
      score,
      progress,
      reward,
      engine,
      reason: null,
    };
    if (!best || cand.reward - cand.risk * 0.62 > best.reward - best.risk * 0.62) best = cand;
  }
  return best;
}

function buildShotCandidate(engine) {
  const shot = engine.previewShot?.();
  if (!shot) return null;
  return {
    type: 'shot',
    action: 'shoot',
    target: engine.holder?.(),
    risk: clamp(1 - shot.xg, 0.05, 0.95),
    safety: shot.xg,
    score: shot.xg + 0.34,
    progress: 0,
    reward: shot.xg + 0.42,
    shot,
    engine,
  };
}

function repeatedActionPenalty(state, action) {
  const recent = state?.actionHistory ?? [];
  const count = recent.filter((id) => id === action).length;
  return count >= 2 ? Math.min(0.28, (count - 1) * 0.14) : 0;
}

function annotate(candidate, state) {
  if (!candidate) return null;
  const repeat = repeatedActionPenalty(state, candidate.action);
  const adapted = state?.adaptRead === candidate.action ? 0.22 : 0;
  const trap = clamp(candidate.risk + repeat + adapted - Math.max(0, candidate.reward - 0.55) * 0.16, 0, 1);
  return {
    ...candidate,
    opponentRead: clamp(repeat + adapted, 0, 1),
    trapScore: trap,
    net: candidate.reward - candidate.risk * 0.62 - repeat * 0.35 - adapted * 0.4,
  };
}

export function evaluateBoard(engine, options = {}) {
  if (!engine?.state || engine.state.status !== 'live') return null;
  if (engine.holder?.()?.side !== 'us') return null;
  const limit = options.limit ?? 10;
  const state = engine.state;
  const candidates = [
    ...buildPassCandidates(engine, limit),
    buildCarryCandidate(engine),
    buildShotCandidate(engine),
  ].filter(Boolean).map((candidate) => annotate(candidate, state));

  if (!candidates.length) {
    return {
      phase: state.phase,
      holder: engine.holder?.() ?? null,
      candidates: [],
      best: null,
      gamble: null,
      trap: null,
      reset: null,
      summary: '최선: 리셋하거나 기다리며 압박을 다시 끌어내세요.',
    };
  }

  const byNet = [...candidates].sort((a, b) => b.net - a.net);
  const best = byNet[0];
  const gamble = [...candidates]
    .filter((c) => c !== best && c.reward >= 0.54 && c.risk >= 0.28)
    .sort((a, b) => (b.reward - b.risk * 0.35) - (a.reward - a.risk * 0.35))[0]
    ?? byNet.find((c) => c !== best)
    ?? null;
  const trap = [...candidates]
    .filter((c) => c !== best && (c.trapScore >= 0.48 || c.risk >= 0.5))
    .sort((a, b) => b.trapScore - a.trapScore)[0]
    ?? gamble;

  // Safe recycle outlet: the lowest-risk backward/square pass that keeps the
  // ball alive. Surfaced when the recommended attack is dicey so the player has
  // a real "reset the attack" option instead of being forced into a read lane.
  const holderX = engine.holder?.()?.x ?? 0;
  const reset = [...candidates]
    .filter((c) => c.type === 'pass' && (c.target?.x ?? 99) <= holderX + 3 && c.risk < 0.2)
    .sort((a, b) => a.risk - b.risk)[0] ?? null;

  return {
    phase: state.phase,
    holder: engine.holder?.() ?? null,
    candidates,
    best,
    gamble,
    trap,
    reset,
    summary: formatBoardRead({ best, gamble, trap }),
  };
}

export function formatCandidate(candidate, mode = 'best') {
  if (!candidate) return '';
  const label = candidateLabel(candidate);
  if (candidate.type === 'shot') {
    return `${label} - xG ${pct(candidate.shot.xg)}`;
  }
  const safety = pct(candidate.safety);
  const progress = candidate.progress >= 1 ? `, 전진 +${Math.round(candidate.progress)}m` : '';
  if (mode === 'trap') {
    const read = candidate.opponentRead >= 0.2 ? ', 반복 패턴 읽힘' : '';
    return `${label} - 차단 위험 ${pct(candidate.risk)}${read}`;
  }
  if (mode === 'gamble') return `${label} - 보상 큼, 위험 ${pct(candidate.risk)}${progress}`;
  return `${label} - 안전 ${safety}${progress}`;
}

export function formatBoardRead(read) {
  if (!read?.best) return '최선: 리셋하거나 기다리며 압박을 다시 끌어내세요.';
  const parts = [`최선: ${formatCandidate(read.best, 'best')}`];
  if (read.gamble) parts.push(`도박: ${formatCandidate(read.gamble, 'gamble')}`);
  if (read.trap) parts.push(`덫: ${formatCandidate(read.trap, 'trap')}`);
  return parts.join(' / ');
}
