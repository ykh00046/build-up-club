// Field of play geometry (Law 1) — single source of truth for every line,
// box and goal the referee and AI reason about. All meters, origin at the
// bottom-left corner of the pitch.
//
//   x: 0 (left goal line) ────────────────► 105 (right goal line)
//   y: 0 (bottom touchline) ──────────────► 68 (top touchline)
//
// Team 'L' defends the x=0 goal and attacks right; team 'R' defends x=105.

export const FIELD = {
  W: 105,
  H: 68,
  // Goal: 7.32 m wide, centred on the goal line, 2.44 m tall (z).
  goalWidth: 7.32,
  goalHeight: 2.44,
  cy: 34,                       // pitch centre y
  goalYMin: 34 - 7.32 / 2,      // 30.34
  goalYMax: 34 + 7.32 / 2,      // 37.66
  // Penalty area: 16.5 m deep, 40.32 m wide.
  penaltyDepth: 16.5,
  penaltyHalfW: 40.32 / 2,      // 20.16
  // Goal area (6-yard box): 5.5 m deep, 18.32 m wide.
  goalAreaDepth: 5.5,
  goalAreaHalfW: 18.32 / 2,     // 9.16
  penaltySpot: 11,             // distance from goal line
  centreRadius: 9.15,          // also the required opponent distance at restarts
  cornerArc: 1,
};

// The goal mouth a team is attacking (where it wants to score), by direction.
// dir = +1 → attacking right (x=105); dir = -1 → attacking left (x=0).
export function attackingGoalX(dir) { return dir > 0 ? FIELD.W : 0; }
export function defendingGoalX(dir) { return dir > 0 ? 0 : FIELD.W; }

// Is point inside the penalty area defended at goalX (0 or 105)?
export function inPenaltyArea(x, y, goalX) {
  const inY = y >= FIELD.cy - FIELD.penaltyHalfW && y <= FIELD.cy + FIELD.penaltyHalfW;
  if (!inY) return false;
  return goalX === 0 ? x <= FIELD.penaltyDepth : x >= FIELD.W - FIELD.penaltyDepth;
}

export function inGoalArea(x, y, goalX) {
  const inY = y >= FIELD.cy - FIELD.goalAreaHalfW && y <= FIELD.cy + FIELD.goalAreaHalfW;
  if (!inY) return false;
  return goalX === 0 ? x <= FIELD.goalAreaDepth : x >= FIELD.W - FIELD.goalAreaDepth;
}

export function penaltySpotFor(goalX) {
  return { x: goalX === 0 ? FIELD.penaltySpot : FIELD.W - FIELD.penaltySpot, y: FIELD.cy };
}

// Clamp a point to just inside the playing field (used to place restart spots).
export function clampToField(x, y, margin = 0.2) {
  return {
    x: Math.max(margin, Math.min(FIELD.W - margin, x)),
    y: Math.max(margin, Math.min(FIELD.H - margin, y)),
  };
}
