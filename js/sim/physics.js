// Physics core for the real-time match: 2.5D model.
//
// The pitch is top-down in meters (x∈[0,105], y∈[0,68]). Players live on the
// ground (z=0). The BALL carries a height component z (and vertical velocity
// vz) so lofted passes, crosses, shots and headers behave like real flight:
// gravity pulls it down, it bounces with restitution, and it only rolls
// (ground friction) once it's back on the turf.
//
// Units: meters, seconds, m/s, m/s². This keeps every constant physically
// legible — a 25 m/s shot, a 7.5 m/s sprint, 9.81 gravity.

export const G = 9.81;                 // gravity (m/s²)
export const BALL_R = 0.11;            // ball radius (m) — FIFA: 0.105–0.11
export const PLAYER_R = 0.45;          // player collision radius (m)

// Ball drag / friction. Tuned so a firm ground pass (~18 m/s) carries ~25–30 m
// before settling, and a driven shot stays fast. Rolling uses a near-constant
// deceleration (rolling resistance); flight uses light quadratic-ish air drag.
export const BALL_ROLL_DECEL = 4.5;    // m/s² while rolling on the ground
export const BALL_AIR_DRAG = 0.06;     // per-second linear drag in flight
export const BALL_RESTITUTION = 0.55;  // vertical bounce energy retained
export const BALL_GROUND_FRICTION = 0.62; // horizontal speed kept per bounce

export function vec(x = 0, y = 0) { return { x, y }; }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale(a, s) { return { x: a.x * s, y: a.y * s }; }
export function len(a) { return Math.hypot(a.x, a.y); }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function norm(a) {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}
export function dot(a, b) { return a.x * b.x + a.y * b.y; }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// Distance from point p to segment a–b (2D), with the clamped projection t.
export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { d: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
}

// ─── Ball integration ────────────────────────────────────────────────────────
// Advance the ball one step of dt seconds. Returns the ball (mutated). The ball
// object is { x, y, z, vx, vy, vz }. Owned balls (carried by a dribbler) are
// integrated elsewhere — this is for free, in-flight or rolling balls only.
export function integrateBall(ball, dt) {
  // A ball resting on the turf (or rolling) is NOT in flight: gravity must not
  // be re-applied to it every frame, or it would "bounce" in place and bleed
  // its roll away. Only an airborne ball (or one launched upward) flies.
  const airborne = ball.z > 1e-4 || ball.vz > 1e-4;

  if (airborne) {
    ball.z += ball.vz * dt;
    ball.vz -= G * dt;
    if (ball.z <= 0) {
      // Struck the ground this step: reflect vertical velocity, bleed horizontal.
      ball.z = 0;
      if (ball.vz < 0) {
        ball.vz = -ball.vz * BALL_RESTITUTION;
        ball.vx *= BALL_GROUND_FRICTION;
        ball.vy *= BALL_GROUND_FRICTION;
        if (ball.vz < 1.2) ball.vz = 0; // kill micro-bounces → it settles
      }
    }
    // Light air drag on the horizontal component while in flight.
    const k = 1 - BALL_AIR_DRAG * dt;
    ball.vx *= k;
    ball.vy *= k;
  } else {
    // Rolling on the ground: constant deceleration opposing motion.
    ball.z = 0; ball.vz = 0;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 1e-4) {
      const f = Math.max(0, sp - BALL_ROLL_DECEL * dt) / sp;
      ball.vx *= f;
      ball.vy *= f;
    }
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  return ball;
}

// ─── Player integration ──────────────────────────────────────────────────────
// Steering: the player accelerates toward a desired velocity (set by the brain)
// capped by a max acceleration, then moves. This yields momentum — sharp
// direction changes cost time, exactly like a real footballer planting and
// turning. `maxSpeed` and `maxAccel` come from the player's pace trait.
export function integratePlayer(p, dt) {
  const dvx = (p.desiredVx ?? 0) - p.vx;
  const dvy = (p.desiredVy ?? 0) - p.vy;
  const dvLen = Math.hypot(dvx, dvy);
  const maxDv = (p.maxAccel ?? 9) * dt;
  if (dvLen > maxDv && dvLen > 1e-6) {
    const f = maxDv / dvLen;
    p.vx += dvx * f;
    p.vy += dvy * f;
  } else {
    p.vx = p.desiredVx ?? 0;
    p.vy = p.desiredVy ?? 0;
  }
  // Hard cap on speed (sprint ceiling).
  const sp = Math.hypot(p.vx, p.vy);
  const ms = p.maxSpeed ?? 7;
  if (sp > ms) { const f = ms / sp; p.vx *= f; p.vy *= f; }

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (sp > 0.05) p.heading = Math.atan2(p.vy, p.vx);
}

// Resolve soft body overlap between two players (no two bodies occupy the same
// spot). Equal push apart — cheap positional correction, not full momentum.
export function separate(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = PLAYER_R * 2;
  if (d > 1e-6 && d < min) {
    const push = (min - d) / 2;
    const ux = dx / d, uy = dy / d;
    a.x -= ux * push; a.y -= uy * push;
    b.x += ux * push; b.y += uy * push;
  }
}
