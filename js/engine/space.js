// Space evaluation: passing lanes, cover shadows, receiver pressure, and
// landing zones. Pure functions — one evaluator feeds preview, resolution,
// and the press AI so what you see is what gets rolled.

import { dist, distToSegment, clamp, PITCH_W, PITCH_H } from '../data/pitch.js';

export const INTERCEPT_RADIUS = 2.6;   // defender reach onto a ground pass lane
export const TACKLE_RADIUS = 2.0;      // defender reach onto the ball holder
export const SHADOW_LEN = 13;          // cover-shadow cone length (m)
export const SHADOW_HALF_ANGLE = 0.24; // ~14°

// A defender's cover shadow points away from the ball: standing between the
// ball and whatever hides behind them.
export function inCoverShadow(target, defender, ball) {
  const bd = { x: defender.x - ball.x, y: defender.y - ball.y };
  const bt = { x: target.x - ball.x, y: target.y - ball.y };
  const dBD = Math.hypot(bd.x, bd.y);
  const dBT = Math.hypot(bt.x, bt.y);
  if (dBD < 0.5 || dBT <= dBD) return false;            // target not behind defender
  if (dBT - dBD > SHADOW_LEN) return false;             // too deep — shadow ends
  const angle = Math.acos(clamp((bd.x * bt.x + bd.y * bt.y) / (dBD * dBT), -1, 1));
  return angle < SHADOW_HALF_ANGLE;
}

// Offside line: the deepest opponent outfielder (the second-last defender,
// since their GK is effectively always the last). Receiving a pass beyond
// this line is offside; carrying the ball past it is not.
export function offsideLine(defenders) {
  let line = 52.5;
  for (const d of defenders) {
    if (d.line === 'gk') continue;
    if (d.x > line) line = d.x;
  }
  return line;
}

export function nearestDefender(point, defenders, { excludeGk = true } = {}) {
  let best = null, bestD = Infinity;
  for (const d of defenders) {
    if (excludeGk && d.line === 'gk') continue;
    const dd = dist(point, d);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return { defender: best, d: bestD };
}

export function receiverPressure(point, defenders) {
  const { d } = nearestDefender(point, defenders);
  if (d > 7) return 0;
  return clamp(1 - d / 7, 0, 1);
}

// Evaluate a ground pass lane. Returns risk 0..1 with the likely interceptor.
// options.lofted = ball flies over the middle of the lane (switch): only
// defenders near the receiving end matter.
// options.rewardWindow = active window ({x,y,r,kind}) — real windows cut risk,
// false windows quietly raise it.
export function evaluateLane(from, to, defenders, options = {}) {
  const passLen = dist(from, to);
  let risk = 0.06 + clamp((passLen - 12) / 60, 0, 0.22); // long balls carry base risk
  if (options.lofted) risk += clamp((passLen - 38) / 70, 0, 0.32); // hopeful punts are not a plan
  else risk += clamp((passLen - 30) / 55, 0, 0.4);       // a 50m+ ground ball through a block is a gift
  let interceptor = null;
  let reason = null;
  let shadowed = false;

  // The longer the ball travels, the more time any defender has to step
  // across — reach grows with pass length.
  const lenReach = options.lofted ? 0 : clamp((passLen - 18) * 0.07, 0, 3.5);

  for (const d of defenders) {
    if (d.line === 'gk') continue;
    const { d: segD, t } = distToSegment(d, from, to);
    if (options.lofted) {
      // A body RIGHT ON the kicker can charge the chip down — "내 바로 앞이
      // 막힌 게 아니면 보낼 수 있다"의 '막힌' 쪽 절반.
      const src = Math.hypot(d.x - from.x, d.y - from.y);
      if (src < 2.4 && t < 0.25 && segD < 2.0) {
        const block = clamp(0.75 * (1 - src / 2.6), 0, 0.7);
        if (block > risk) { interceptor = d; reason = 'chargeDown'; }
        risk = Math.max(risk, block);
      }
      if (t < 0.72) continue;                            // flight clears mid-lane bodies
    }
    // A presser arriving AT the holder pressures the ball, not the lane —
    // the release goes past him before he can turn (that's what a reward
    // window is for). Only downfield bodies block lanes. (ISSUE-007)
    const nearOrigin = Math.hypot(d.x - from.x, d.y - from.y) < 3;
    const reach = INTERCEPT_RADIUS + (d.traits?.pace ?? 0.7) * 1.2 + lenReach;
    if (segD < reach) {
      const closeness = 1 - segD / reach;
      let contribution = closeness * (options.lofted ? 0.5 : 0.85);
      if (nearOrigin) contribution *= 0.25;
      if (contribution > risk) { interceptor = d; reason = 'lane'; }
      risk = Math.max(risk, contribution);
    }
    if (!options.lofted && !nearOrigin && inCoverShadow(to, d, from)) {
      shadowed = true;
      if (risk < 0.7) { risk = Math.max(risk, 0.7); interceptor = d; reason = 'shadow'; }
    }
  }

  // Receiver pressure: arriving into a crowd is its own risk. A dropping
  // ball is harder to kill — lofted reception weighs heavier.
  const rp = receiverPressure(to, defenders);
  const rpW = options.lofted ? 0.74 : 0.62;
  if (rp > 0.55 && risk < 0.5) { risk = Math.max(risk, rp * rpW); reason = reason || 'receiverPressure'; }
  if (options.lofted) risk += 0.04; // first touch off a chip is never free

  // Reward window influence.
  const w = options.rewardWindow;
  if (w && dist(to, w) < w.r) {
    risk = w.kind === 'real' ? risk * 0.45 : Math.min(1, risk * 1.15 + 0.08);
  }

  risk = clamp(risk, 0.02, 0.97);
  const status = risk < 0.28 ? 'safe' : risk < 0.58 ? 'risky' : 'cut';
  return { risk, status, interceptor, reason, shadowed, passLen };
}

// Sweeper-keeper race: the keeper owns the space BEHIND the line — deep
// through balls are his to claim, and he reads them early (sweeper bonus).
// This — not a hard cap — is what prices the in-behind corridor. Shared by
// evaluateLanding AND the engine's pass_space (which previously skipped the
// GK entirely, making deep through balls free — 2026-07 audit C2).
export function sweeperRisk(zone, runner, defenders) {
  const gk = defenders.find((d) => d.line === 'gk');
  if (!gk || zone.x <= 78) return 0;
  const runnerTime = dist(runner, zone) / (8 + (runner.traits?.pace ?? 0.7) * 4);
  const gTime = dist(gk, zone) / 9.5 - 0.25;
  const margin = gTime - runnerTime;
  if (margin >= 0.25) return 0;
  return clamp(0.8 - margin, 0, 0.95);
}

// Landing-zone read for a pass into space / switch: how alive is this patch
// of grass once the runner gets there?
export function evaluateLanding(zone, runner, defenders, options = {}) {
  let risk = 0.08;
  let interceptor = null;
  const runnerTime = dist(runner, zone) / (8 + (runner.traits?.pace ?? 0.7) * 4);
  for (const d of defenders) {
    if (d.line === 'gk') {
      const contribution = sweeperRisk(zone, runner, defenders);
      if (contribution > risk) interceptor = d;
      risk = Math.max(risk, contribution);
      continue;
    }
    let dTime = dist(d, zone) / (8 + (d.traits?.pace ?? 0.7) * 4);
    if (d.x > zone.x) dTime -= 0.3; // goal-side defender reads the drop earlier
    const margin = dTime - runnerTime; // positive = runner arrives first
    if (margin < 0.55) {
      let contribution;
      if (margin >= 0) {
        // Runner wins the race — risk falls quadratically with lead time.
        // At margin=0 (tie): ~0.72. At margin=0.3: ~0.18. At margin=0.55: 0.
        contribution = clamp(0.72 * Math.pow(1 - margin / 0.55, 2), 0, 0.75);
      } else {
        // Defender gets there first — risk rises sharply.
        contribution = clamp(0.72 - margin * 1.2, 0, 0.9);
      }
      if (contribution > risk) interceptor = d;
      risk = Math.max(risk, contribution);
    }
  }
  const w = options.rewardWindow;
  if (w && dist(zone, w) < w.r) {
    risk = w.kind === 'real' ? risk * 0.5 : Math.min(1, risk * 1.15 + 0.08);
  }
  risk = clamp(risk, 0.02, 0.97);
  const status = risk < 0.3 ? 'open' : risk < 0.6 ? 'contested' : 'dead';
  return { risk, status, interceptor };
}

// Default landing zone for an into-space ball: ahead of the runner, toward
// the opponent goal — capped at the offside line. Depth opens up as the
// opponent line retreats, not by outrunning the rules.
export function landingZoneFor(runner, depth = 12) {
  // The landing may be BEHIND the line — offside is judged on the receiver's
  // position at the moment of the pass (the engine enforces that), not on
  // where the ball drops. That is what a through ball IS. Depth is bounded by
  // run physics and the pitch; the space behind the line is priced by the
  // sweeper-keeper race in evaluateLanding, not forbidden by a cap.
  return {
    x: clamp(runner.x + depth, 4, PITCH_W - 5),
    y: clamp(runner.y + (runner.y > PITCH_H / 2 ? 2 : -2), 3, PITCH_H - 3),
    r: 5,
  };
}

// Receiver orientation — the posture grammar (P1). Three states only:
//   FACING: can see the goal, all actions available
//   HALF:   half-turned, forward passes carry a modest risk penalty
//   BACK:   marked goal-side, forward passing nearly impossible
//
// Decision (at reception moment):
//   moving=true (pass_space / bounce run-out) → always FACING
//   nearest outfield defender ≤3.5m AND goal-side → BACK
//   nearest outfield defender ≤5.5m            → HALF
//   otherwise                                   → FACING
//
// "Goal-side" means the defender's x is within 1.5m of or past the receiver's
// x — they are between the receiver and the opponent goal.
export function computeOrientation(player, defenders, { moving = false } = {}) {
  if (moving) return 'FACING';
  const { d: nearD, defender } = nearestDefender(player, defenders);
  if (!defender || nearD > 8) return 'FACING';
  const goalSide = defender.x > player.x - 1.5;
  if (nearD <= 3.5 && goalSide) return 'BACK';
  if (nearD <= 5.5) return 'HALF';
  return 'FACING';
}

// How many opponent press lines does the segment from→to cross?
// Lines are computed from the live average x of each opp line group.
export function linesBroken(from, to, defenders) {
  const groups = { front: [], mid: [], back: [] };
  for (const d of defenders) if (groups[d.line]) groups[d.line].push(d.x);
  let count = 0;
  for (const key of ['front', 'mid', 'back']) {
    const xs = groups[key];
    if (!xs.length) continue;
    const lineX = xs.reduce((s, v) => s + v, 0) / xs.length;
    if (from.x < lineX && to.x > lineX) count++;
  }
  return count;
}
