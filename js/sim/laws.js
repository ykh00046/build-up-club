// The referee. Encodes the Laws of the Game that govern when play stops and
// how it restarts:
//   Law 9  — ball in/out of play (wholly over a boundary line)
//   Law 10 — the goal (wholly over the goal line, between posts, under bar)
//   Law 11 — offside (position judged the moment the ball is played)
//   Law 15 — throw-in   (out over a touchline)
//   Law 16 — goal kick  (out over goal line, last touch by attackers)
//   Law 17 — corner kick(out over goal line, last touch by defenders)
//
// Fouls (Law 12) / free kicks (Law 13) / penalties (Law 14) are detected in the
// match loop on contact and routed through this module's restart spots.

import { FIELD, defendingGoalX, inPenaltyArea, clampToField } from './field.js';
import { BALL_R } from './physics.js';

// Which team defends the goal at goalX (0 or 105)?
export function defendingTeamAt(state, goalX) {
  for (const t of Object.keys(state.teams)) {
    if (defendingGoalX(state.teams[t].dir) === goalX) return t;
  }
  return null;
}
export function attackingTeamAt(state, goalX) {
  const d = defendingTeamAt(state, goalX);
  return d === 'L' ? 'R' : 'L';
}

// Did the whole ball cross a goal line between the posts and under the bar?
function isGoal(ball, goalX) {
  if (goalX === 0 && ball.x > -BALL_R) return false;
  if (goalX === FIELD.W && ball.x < FIELD.W + BALL_R) return false;
  return ball.y >= FIELD.goalYMin && ball.y <= FIELD.goalYMax && ball.z <= FIELD.goalHeight;
}

// Per-frame dead-ball check. Returns a decision or null while play continues.
//   { kind: 'goal', scoringTeam }
//   { kind: 'restart', type, team, spot }
export function evaluateDeadBall(state) {
  const b = state.ball;
  const lastTeam = state.players.find((p) => p.id === b.lastTouch)?.team ?? null;

  // ── Over a goal line (x) ────────────────────────────────────────────────
  if (b.x < -BALL_R || b.x > FIELD.W + BALL_R) {
    const goalX = b.x < 0 ? 0 : FIELD.W;
    if (isGoal(b, goalX)) {
      return { kind: 'goal', scoringTeam: attackingTeamAt(state, goalX) };
    }
    const defending = defendingTeamAt(state, goalX);
    const attacking = defending === 'L' ? 'R' : 'L';
    // Last touch decides: attackers out → goal kick; defenders out → corner.
    if (lastTeam === defending) {
      // Corner to attackers, on the side the ball went out.
      const cornerY = b.y < FIELD.cy ? 0.5 : FIELD.H - 0.5;
      return { kind: 'restart', type: 'corner_kick', team: attacking,
        spot: { x: goalX === 0 ? 0.5 : FIELD.W - 0.5, y: cornerY } };
    }
    // Goal kick to defenders (placed in their goal area).
    const gkx = goalX === 0 ? FIELD.goalAreaDepth - 0.5 : FIELD.W - FIELD.goalAreaDepth + 0.5;
    return { kind: 'restart', type: 'goal_kick', team: defending, spot: { x: gkx, y: FIELD.cy } };
  }

  // ── Over a touchline (y) ────────────────────────────────────────────────
  if (b.y < -BALL_R || b.y > FIELD.H + BALL_R) {
    const throwTeam = lastTeam === 'L' ? 'R' : 'L';
    const spot = clampToField(b.x, b.y < 0 ? 0.3 : FIELD.H - 0.3);
    return { kind: 'restart', type: 'throw_in', team: throwTeam ?? 'L', spot };
  }

  return null;
}

// ─── Offside (Law 11) ─────────────────────────────────────────────────────────
// A player is in an offside POSITION if, in the opponent's half, they are nearer
// the opponent goal line than BOTH the ball and the second-to-last opponent.
// (Being level is onside.) Position alone is not an offence — it becomes one
// only when that player gets involved, which the match loop tracks.

// x of the second-to-last defender of `defendingTeam` (GK is usually last).
export function secondLastLineX(state, defendingTeam, goalX) {
  const xs = state.players
    .filter((p) => p.team === defendingTeam)
    .map((p) => p.x)
    .sort((a, b) => (goalX === 0 ? a - b : b - a)); // nearest own goal first
  // Index 1 = second nearest to own goal line = second-to-last defender.
  return xs.length >= 2 ? xs[1] : (xs[0] ?? goalX);
}

// Is attacker `p` (of attackingTeam, attacking toward goalX) in an offside
// position right now, given the ball position?
export function isInOffsidePosition(p, state, attackingTeam, goalX, ball) {
  const dir = goalX === FIELD.W ? 1 : -1;
  const halfway = FIELD.W / 2;
  // Must be in the opponent half.
  if (dir > 0 ? p.x <= halfway : p.x >= halfway) return false;
  const defending = attackingTeam === 'L' ? 'R' : 'L';
  const lineX = secondLastLineX(state, defending, goalX);
  const ahead = (a, b) => (dir > 0 ? a > b + 0.05 : a < b - 0.05);
  // Ahead of BOTH the second-last defender and the ball.
  return ahead(p.x, lineX) && ahead(p.x, ball.x);
}

// Snapshot the offside-position teammates at the instant a pass is struck.
export function offsideSnapshot(state, kicker) {
  const team = kicker.team;
  const dir = state.teams[team].dir;
  const goalX = dir > 0 ? FIELD.W : 0;
  const ids = new Set();
  for (const p of state.players) {
    if (p.team !== team || p.id === kicker.id) continue;
    if (isInOffsidePosition(p, state, team, goalX, state.ball)) ids.add(p.id);
  }
  return { team, ids, goalX };
}

export { inPenaltyArea };
