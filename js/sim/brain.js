// Player & team AI. Each frame this sets every player's desired velocity (the
// physics layer turns that into accelerated movement) and, for whoever has the
// ball, returns a single kick intent the match loop executes.
//
// Football, not chess: there is an in-possession team and an out-of-possession
// team. The out-of-possession team presses the ball, covers behind the presser,
// and holds a flat back line (which is what creates the offside trap). The
// in-possession team's carrier shoots / passes / dribbles, while team-mates
// open angles, hold width and time runs onto the last line.

import {
  FIELD, attackingGoalX, defendingGoalX, inPenaltyArea, penaltySpotFor,
} from './field.js';
import { dist, norm, clamp, lerp, distToSegment } from './physics.js';
import { secondLastLineX } from './laws.js';

const HALF = FIELD.W / 2;

function teammates(state, team) { return state.players.filter((p) => p.team === team); }
function opponents(state, team) { return state.players.filter((p) => p.team !== team); }

function nearest(list, pt, exclude) {
  let best = null, bd = Infinity;
  for (const p of list) {
    if (exclude && p.id === exclude.id) continue;
    const d = dist(p, pt);
    if (d < bd) { bd = d; best = p; }
  }
  return { player: best, d: bd };
}

// Is the straight lane from→to free of opponents (within `pad` m of the line,
// and actually between the endpoints)? Used to judge passes.
function laneClear(from, to, opps, pad = 1.6) {
  for (const o of opps) {
    const { d, t } = distToSegment(o, from, to);
    if (t > 0.05 && t < 0.98 && d < pad) return false;
  }
  return true;
}

// Steer a player toward a target point with an arrival slow-down.
function steer(p, target, speedFactor = 1) {
  const dx = target.x - p.x, dy = target.y - p.y;
  const d = Math.hypot(dx, dy);
  let desired = (p.maxSpeed ?? 7) * clamp(speedFactor, 0, 1);
  if (d < 2.5) desired *= d / 2.5;          // arrive: ease off near the target
  if (d < 1e-4) { p.desiredVx = 0; p.desiredVy = 0; return; }
  p.desiredVx = (dx / d) * desired;
  p.desiredVy = (dy / d) * desired;
}

// The flat defensive line x: drop relative to ball, but never deeper than the
// edge of the six-yard box; pushed up to compress space when the ball is far.
function backLineX(state, team) {
  const dir = state.teams[team].dir;
  const goalX = defendingGoalX(dir);
  const ballX = state.ball.x;
  // Distance the ball has advanced into our half (0 at halfway, grows toward us).
  const intoOurHalf = dir > 0 ? (HALF - ballX) : (ballX - HALF);
  // Line sits ~22 m ahead of our goal at halfway, retreats as ball nears.
  let depth = clamp(26 - intoOurHalf * 0.55, 7, 40);
  return goalX === 0 ? depth : FIELD.W - depth;
}

// ─── Off-ball positioning ─────────────────────────────────────────────────────
// Returns the home point a player wants when not directly involved, blending
// formation base with a ball-relative team shift (slide toward the ball, push
// the block up the pitch as the ball advances).
function homePoint(state, p) {
  const dir = state.teams[p.team].dir;
  const b = state.ball;
  // Forward team shift: + when our attack has advanced, − when pinned back.
  const prog = dir > 0 ? (b.x - HALF) / HALF : (HALF - b.x) / HALF; // -1..1
  const inPossession = state.possession === p.team;
  const shiftMag = inPossession ? 20 : 14;
  let tx = p.baseX + dir * prog * (shiftMag / 1) * 0.6;
  // Lateral compaction toward the ball's side.
  let ty = lerp(p.baseY, b.y, p.role === 'GK' ? 0.05 : 0.28);

  if (inPossession) {
    // Attackers stretch the last line; full-backs provide width going forward.
    if (p.role === 'ST' || p.role === 'W') {
      const lineX = secondLastLineX(state, p.team === 'L' ? 'R' : 'L', attackingGoalX(dir));
      tx = dir > 0 ? Math.min(p.baseX + 18, lineX - 0.8) : Math.max(p.baseX - 18, lineX + 0.8);
      if (p.role === 'W') ty = p.baseY < FIELD.cy ? 8 : FIELD.H - 8; // hug touchline
    }
  } else {
    // Defending: hold a flat back line; midfield screens in front of it.
    if (p.role === 'CB' || p.role === 'FB') tx = backLineX(state, p.team);
    else if (p.role === 'DM' || p.role === 'CM') {
      tx = dir > 0 ? backLineX(state, p.team) + 9 : backLineX(state, p.team) - 9;
    }
  }
  return {
    x: clamp(tx, 2, FIELD.W - 2),
    y: clamp(ty, 2, FIELD.H - 2),
  };
}

// ─── Defending ────────────────────────────────────────────────────────────────
function defendTeam(state, team, dt) {
  const opps = opponents(state, team);
  const ballPt = state.ball;
  const mates = teammates(state, team);

  // Closest outfielder presses the ball; next closest gives cover.
  const outfield = mates.filter((p) => p.role !== 'GK');
  const sorted = outfield.slice().sort((a, b) => dist(a, ballPt) - dist(b, ballPt));
  const presser = sorted[0];
  const cover = sorted[1];

  for (const p of mates) {
    if (p.role === 'GK') { goalkeep(state, p); continue; }
    if (p === presser) {
      // Close down the ball, aiming a touch goalside so the carrier is contained.
      const dir = state.teams[team].dir;
      const gx = defendingGoalX(dir);
      const aim = { x: ballPt.x + (gx === 0 ? 0.6 : -0.6), y: ballPt.y };
      steer(p, aim, 1);
      continue;
    }
    if (p === cover) {
      // Sit a few meters behind the presser, between ball and goal.
      const dir = state.teams[team].dir;
      const gx = defendingGoalX(dir);
      const aim = { x: ballPt.x + (gx === 0 ? -6 : 6), y: lerp(ballPt.y, FIELD.cy, 0.4) };
      steer(p, aim, 0.95);
      continue;
    }
    steer(p, homePoint(state, p), 0.85);
  }
}

// ─── Attacking ────────────────────────────────────────────────────────────────
function attackTeam(state, team, dt) {
  const mates = teammates(state, team);
  const carrier = state.players.find((p) => p.id === state.ball.owner);
  let intent = null;

  for (const p of mates) {
    if (p.role === 'GK') {
      if (p === carrier) intent = carrierDecision(state, p) ?? intent;
      else goalkeep(state, p);
      continue;
    }
    if (p === carrier) {
      intent = carrierDecision(state, p) ?? intent;
      continue;
    }
    // Off-ball: take up the home/support point, with attackers timing runs.
    steer(p, supportPoint(state, p, carrier), runSpeed(state, p));
  }
  return intent;
}

function runSpeed(state, p) {
  // Forwards making a run onto the last line sprint; others jog into shape.
  if (p.role === 'ST' || p.role === 'W') return 0.95;
  return 0.8;
}

function supportPoint(state, p, carrier) {
  const base = homePoint(state, p);
  if (!carrier) return base;
  const dir = state.teams[p.team].dir;
  // Stay a touch onside: don't drift beyond the second-last defender unless a
  // ball is already on its way (handled by movement, not teleport).
  const lineX = secondLastLineX(state, p.team === 'L' ? 'R' : 'L', attackingGoalX(dir));
  if ((p.role === 'ST' || p.role === 'W')) {
    const onsideX = dir > 0 ? Math.min(base.x, lineX - 0.5) : Math.max(base.x, lineX + 0.5);
    return { x: onsideX, y: base.y };
  }
  return base;
}

// ─── Ball carrier decision: shoot / pass / dribble / clear ─────────────────────
function carrierDecision(state, p) {
  const dir = state.teams[p.team].dir;
  const goalX = attackingGoalX(dir);
  const goal = { x: goalX, y: FIELD.cy };
  const opps = opponents(state, p.team);
  const mates = teammates(state, p.team).filter((m) => m.id !== p.id && m.role !== 'GK');
  const toGoal = dist(p, goal);
  const pressure = nearest(opps.filter((o) => o.role !== 'GK'), p);

  // Reaction gate: don't fire on the very first frame of control unless rushed.
  const settled = (p.holdTime ?? 0) > 0.16 || (pressure.d < 2.4);

  // 1) Shoot — in range, decent angle, keeper not smothering the lane.
  if (settled && toGoal < 26) {
    const angle = Math.abs(p.y - FIELD.cy);
    const clear = laneClear(p, goal, opps.filter((o) => o.role !== 'GK'), 1.1);
    const goodAngle = angle < 16 || toGoal < 14;
    if (clear && goodAngle) {
      // Aim for the post the keeper is furthest from — that's where goals come
      // from. Leave ~0.7 m inside the post so honest accuracy still scores.
      const gk = opps.find((o) => o.role === 'GK');
      const post = FIELD.goalWidth / 2 - 0.7; // ≈ 2.96 m from centre
      const side = gk ? (gk.y >= FIELD.cy ? -1 : 1) : (p.y < FIELD.cy ? 1 : -1);
      const aimY = clamp(FIELD.cy + side * post, FIELD.goalYMin + 0.3, FIELD.goalYMax - 0.3);
      return kick(p, { x: goalX, y: aimY }, 25 + (p.traits?.shot_power ?? 0.6) * 9, 1.0, 'shot');
    }
  }

  // 2) Pass — best open team-mate that advances the ball.
  if (settled) {
    let best = null, bestScore = -Infinity;
    for (const m of mates) {
      const lane = laneClear(p, m, opps, 1.5);
      if (!lane) continue;
      const prog = (m.x - p.x) * dir;               // forward gain
      const d = dist(p, m);
      if (d > 45) continue;                          // beyond reliable range
      const openness = nearest(opps, m).d;           // space around receiver
      const score = prog * 1.4 + openness * 0.9 - d * 0.12;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    // Only pass if it actually helps (forward, or we're pressured with an out).
    if (best && (bestScore > 6 || pressure.d < 3.5)) {
      const d = dist(p, best);
      const power = clamp(8 + d * 0.62, 9, 26);
      const loft = d > 26 ? clamp(d * 0.12, 2, 6) : 0; // longer balls travel in the air
      return kick(p, best, power, loft, 'pass', best.id);
    }
  }

  // 3) Last-ditch clearance — defender under heavy pressure with no out.
  if (pressure.d < 2.0 && (p.role === 'CB' || p.role === 'FB' || p.role === 'GK')) {
    const aim = { x: dir > 0 ? FIELD.W - 10 : 10, y: p.y < FIELD.cy ? 6 : FIELD.H - 6 };
    return kick(p, aim, 22, 6, 'clear');
  }

  // 4) Dribble: drive into space toward goal, away from the nearest defender.
  const goalDir = norm({ x: goal.x - p.x, y: goal.y - p.y });
  let avoid = { x: 0, y: 0 };
  if (pressure.player && pressure.d < 6) {
    const away = norm({ x: p.x - pressure.player.x, y: p.y - pressure.player.y });
    const w = clamp(1 - pressure.d / 6, 0, 1);
    avoid = { x: away.x * w, y: away.y * w };
  }
  const drive = norm({ x: goalDir.x + avoid.x, y: goalDir.y + avoid.y * 1.2 });
  const target = { x: p.x + drive.x * 6, y: p.y + drive.y * 6 };
  steer(p, target, 0.9);
  return null; // no kick — keep dribbling
}

function kick(p, aim, power, loft, type, targetId = null) {
  return { playerId: p.id, type, aim: { x: aim.x, y: aim.y }, power, loft, targetId };
}

// ─── Goalkeeper ────────────────────────────────────────────────────────────────
function goalkeep(state, gk) {
  const dir = state.teams[gk.team].dir;
  const goalX = defendingGoalX(dir);
  const b = state.ball;
  const goal = { x: goalX, y: FIELD.cy };
  // Stand on the bisector between ball and goal centre, a little off the line.
  const toBall = norm({ x: b.x - goalX, y: b.y - FIELD.cy });
  const threat = dist(b, goal) < 30;
  const standoff = threat ? clamp(dist(b, goal) * 0.18, 1.5, 6.5) : 2.2;
  let tx = goalX + toBall.x * standoff;
  let ty = clamp(FIELD.cy + toBall.y * standoff, FIELD.goalYMin - 1.5, FIELD.goalYMax + 1.5);

  // Shot in flight toward goal: get into its path on the line (set the angle).
  const incoming = (goalX === 0 && b.vx < -3) || (goalX === FIELD.W && b.vx > 3);
  if (incoming && Math.abs(b.vx) > 0.5) {
    const tImpact = (goalX - b.x) / b.vx;        // time for ball to reach the line
    if (tImpact > 0 && tImpact < 2.2) {
      const projY = b.y + b.vy * tImpact;
      ty = clamp(projY, FIELD.goalYMin - 1.2, FIELD.goalYMax + 1.2);
      tx = goalX + (goalX === 0 ? 0.8 : -0.8);
    }
  }
  // Rush out to smother a loose ball inside the box.
  const ballLoose = !state.ball.owner;
  if (ballLoose && inPenaltyArea(b.x, b.y, goalX) && b.z < 1.4) { tx = b.x; ty = b.y; }
  steer(gk, { x: clamp(tx, goalX === 0 ? 0.4 : FIELD.W - 12, goalX === 0 ? 12 : FIELD.W - 0.4), y: ty }, ballLoose ? 1 : 0.85);
}

// While the ball is loose (in flight or rolling, no dribbler), BOTH teams must
// contest it: each side's nearest outfielder sprints onto a lead point ahead of
// the ball, GKs mind their box, everyone else holds shape by last possession.
function pursueLoose(state, dt) {
  const b = state.ball;
  // Lead the ball: aim where it will be shortly, so chasers run onto it.
  const lead = { x: b.x + b.vx * 0.35, y: b.y + b.vy * 0.35 };
  for (const t of Object.keys(state.teams)) {
    const mates = teammates(state, t);
    const chaser = nearest(mates.filter((p) => p.role !== 'GK'), b).player;
    for (const p of mates) {
      if (p.role === 'GK') { goalkeep(state, p); continue; }
      if (p === chaser) steer(p, lead, 1);
      else steer(p, homePoint(state, p), 0.82);
    }
  }
}

// ─── Public entry ─────────────────────────────────────────────────────────────
// Returns the kick intent for this frame (or null). Mutates desired velocities.
export function think(state, dt) {
  const carrier = state.players.find((p) => p.id === state.ball.owner);
  if (carrier) {
    const attackingTeam = carrier.team;
    let intent = null;
    for (const t of Object.keys(state.teams)) {
      if (t === attackingTeam) intent = attackTeam(state, t, dt) ?? intent;
      else defendTeam(state, t, dt);
    }
    return intent;
  }
  // Loose ball — contest it.
  pursueLoose(state, dt);
  return null;
}

export { laneClear, nearest, steer };
