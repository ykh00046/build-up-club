// Match orchestrator. Runs a fixed-timestep simulation that binds together the
// physics (ball + players), the AI brains, and the referee. Each step:
//
//   1. brains set desired velocities and (for the carrier) one kick intent
//   2. players integrate with momentum + soft-body separation
//   3. the ball is either carried (dribble), in flight, or rolling free
//   4. control / tackles / kicks change who has the ball (Laws 12 touches)
//   5. the referee checks for goals & out-of-play → restarts (Laws 9–17)
//
// Time is real seconds. A configurable half length keeps demos short while the
// clock still reads like a real match.

import { integrateBall, integratePlayer, separate, dist, norm, clamp } from './physics.js';
import { FIELD, attackingGoalX, defendingGoalX, inPenaltyArea, penaltySpotFor, clampToField } from './field.js';
import { evaluateDeadBall, offsideSnapshot } from './laws.js';
import { think } from './brain.js';
import { buildRoster } from './roster.js';
import { createRng } from '../engine/rng.js';

const CONTROL_R = 1.25;     // a player traps a loose ball within this radius
const TACKLE_R = 1.0;       // a defender can challenge the carrier within this
const DRIBBLE_AHEAD = 0.7;  // the carrier nudges the ball this far in front
const KICK_COOLDOWN = 0.32; // a kicker can't re-control their own ball this soon
const SETUP_TIME = 0.9;     // pause to take a restart
const GOAL_TIME = 2.2;      // celebration before kickoff

export function createMatch(options = {}) {
  const rng = createRng(options.seed ?? 12345);
  const halfLength = options.halfLengthSec ?? 45 * 60;

  const state = {
    teams: {
      L: { name: options.homeName ?? 'Home', dir: 1, color: '#3da5f5' },
      R: { name: options.awayName ?? 'Away', dir: -1, color: '#f5544b' },
    },
    players: buildRoster(),
    ball: { x: FIELD.W / 2, y: FIELD.cy, z: 0, vx: 0, vy: 0, vz: 0, lastTouch: null, owner: null },
    score: { L: 0, R: 0 },
    clock: 0,
    half: 1,
    halfLength,
    phase: 'KICKOFF',
    restart: { type: 'kickoff', team: 'L', spot: { x: FIELD.W / 2, y: FIELD.cy }, timer: SETUP_TIME },
    possession: null,
    offsideWatch: null,
    events: [],
    counts: {},
    stoppage: 0,
  };

  log(state, 'kickoff', `${state.teams.L.name} 킥오프`);
  placeForRestart(state);

  // ─── touch & possession bookkeeping ─────────────────────────────────────────
  function registerTouch(player) {
    const b = state.ball;
    b.lastTouch = player.id;
    // Offside resolution (Law 11): if a flagged team-mate is first to touch a
    // ball played by their side, it's an offside offence.
    const w = state.offsideWatch;
    if (w) {
      if (player.team === w.team) {
        if (w.ids.has(player.id)) {
          const defending = w.team === 'L' ? 'R' : 'L';
          const spot = clampToField(player.x, player.y);
          state.offsideWatch = null;
          setRestart(state, 'free_kick', defending, spot, { reason: 'offside' });
          log(state, 'offside', `오프사이드 — ${player.label}`);
          return true; // touch consumed by the whistle
        }
        // an onside team-mate touched → the phase is resolved, drop the watch
        state.offsideWatch = null;
      } else {
        // defender intervened → no offside
        state.offsideWatch = null;
      }
    }
    return false;
  }

  function giveBall(player) {
    state.ball.owner = player.id;
    player.holdTime = 0;
    state.possession = player.team;
  }

  function executeKick(intent) {
    const p = state.players.find((q) => q.id === intent.playerId);
    if (!p) return;
    const aim = intent.aim;
    const d = Math.max(0.1, dist(p, aim));
    let ux = (aim.x - p.x) / d, uy = (aim.y - p.y) / d;
    // Accuracy: spread grows with distance and shrinks with passing skill.
    const skill = intent.type === 'shot' ? (p.traits.shot_power ?? 0.6) : (p.traits.pass ?? 0.7);
    const spread = (1 - skill) * (0.05 + d * 0.0016) + (intent.type === 'clear' ? 0.06 : 0);
    const ang = Math.atan2(uy, ux) + (rng.next() - 0.5) * 2 * spread;
    ux = Math.cos(ang); uy = Math.sin(ang);
    const power = intent.power * rng.range(0.95, 1.05);
    state.ball.owner = null;
    state.ball.vx = ux * power;
    state.ball.vy = uy * power;
    state.ball.vz = intent.loft || 0;
    state.ball.z = 0.05;
    p.kickCooldown = KICK_COOLDOWN;
    registerTouch(p);
    // Snapshot offside positions the moment the ball is played (forward intents).
    if (intent.type === 'pass' || intent.type === 'shot' || intent.type === 'clear') {
      state.offsideWatch = offsideSnapshot(state, p);
    }
    log(state, intent.type, `${p.label} ${KICK_KO[intent.type] ?? intent.type}`);
  }

  // Attempt a tackle by the closest defender on the carrier.
  function resolveTackles() {
    const carrier = state.players.find((q) => q.id === state.ball.owner);
    if (!carrier) return;
    const goalX = defendingGoalX(state.teams[carrier.team].dir); // carrier's own goal
    for (const o of state.players) {
      if (o.team === carrier.team || o.role === 'GK') continue;
      const d = dist(o, carrier);
      if (d > TACKLE_R) continue;
      // Closing speed of the challenge (how recklessly the tackler arrives).
      const rel = Math.hypot(o.vx - carrier.vx, o.vy - carrier.vy);
      const skill = clamp(0.45 + (o.traits.pace ?? 0.7) * 0.3 - (carrier.traits.pass ?? 0.7) * 0.2, 0.1, 0.85);
      const r = rng.next();
      if (r < skill) {
        // Clean tackle: ball pops loose — direction off the challenge, with a
        // bit of scatter, so 50/50s spray the way real loose balls do.
        state.ball.owner = null;
        const away = norm({ x: o.x - carrier.x + (rng.next() - 0.5), y: o.y - carrier.y + (rng.next() - 0.5) });
        const pop = 5 + rng.next() * 4;
        state.ball.vx = away.x * pop + o.vx * 0.6; state.ball.vy = away.y * pop + o.vy * 0.6;
        state.ball.z = 0.1; state.ball.vz = 1 + rng.next() * 1.5;
        carrier.holdTime = 0;
        registerTouch(o);
        state.possession = null;
        log(state, 'tackle', `${o.label} 태클 성공`);
        return;
      }
      // Mistimed challenge at speed → foul.
      if (rel > 4.2 && r < skill + 0.18 * (rel / 8)) {
        const attackGoalX = attackingGoalX(state.teams[carrier.team].dir);
        const ownDefGoalX = defendingGoalX(state.teams[o.team].dir); // tackler's goal
        if (inPenaltyArea(carrier.x, carrier.y, ownDefGoalX)) {
          const spot = penaltySpotFor(ownDefGoalX);
          setRestart(state, 'penalty', carrier.team, spot, { reason: 'foul' });
          log(state, 'penalty', `페널티킥 — ${o.label} 반칙`);
        } else {
          setRestart(state, 'free_kick', carrier.team, clampToField(carrier.x, carrier.y), { reason: 'foul' });
          log(state, 'foul', `프리킥 — ${o.label} 반칙`);
        }
        return;
      }
    }
  }

  // ─── per-frame ball logic ───────────────────────────────────────────────────
  function updateBall(dt) {
    const b = state.ball;
    const owner = state.players.find((q) => q.id === b.owner);
    if (owner) {
      // Carried: glue the ball just ahead of the dribbler.
      const hx = Math.cos(owner.heading), hy = Math.sin(owner.heading);
      b.x = owner.x + hx * DRIBBLE_AHEAD;
      b.y = owner.y + hy * DRIBBLE_AHEAD;
      b.z = 0; b.vz = 0;
      b.vx = owner.vx; b.vy = owner.vy;
      owner.holdTime += dt;
      return;
    }
    // Free ball: physics, then see if anyone controls it.
    integrateBall(b, dt);
    if (state.phase !== 'PLAY') return;

    // Goalkeeper shot-stop: a keeper can dive (extended reach) to claim or parry
    // a ball flying toward their goal. This is what keeps scoring realistic.
    for (const gk of state.players) {
      if (gk.role !== 'GK') continue;
      const goalX = defendingGoalX(state.teams[gk.team].dir);
      const towardGoal = (goalX === 0 && b.vx < -2) || (goalX === FIELD.W && b.vx > 2);
      if (!towardGoal) continue;
      // Don't "save" a ball that's already crossed the line, or one flying wide
      // of the posts — those are goals / goal kicks for the referee to call.
      if (b.x < 0 || b.x > FIELD.W) continue;
      const tImpact = Math.abs(b.vx) > 0.5 ? (goalX - b.x) / b.vx : 0;
      if (tImpact > 0) {
        const projY = b.y + b.vy * tImpact;
        if (projY < FIELD.goalYMin - 1.2 || projY > FIELD.goalYMax + 1.2) continue;
      }
      const d = Math.hypot(gk.x - b.x, gk.y - b.y);
      if (d < 2.8 && b.z < 2.5 && gk.kickCooldown <= 0) {
        // Harder to save the further the keeper must reach and the faster the shot.
        const reachPenalty = (d / 2.8) * 0.45;
        const pacePenalty = clamp(Math.hypot(b.vx, b.vy) - 18, 0, 16) * 0.022;
        const save = clamp(0.30 + (gk.traits.keeping ?? 0.7) * 0.40 - reachPenalty - pacePenalty, 0.08, 0.86);
        if (rng.next() < save) {
          giveBall(gk); registerTouch(gk); b.vz = 0; b.z = 0;
          log(state, 'save', `${gk.label} 선방!`);
        } else {
          // Parry: knock it clear, keeper can't instantly re-grab.
          const away = norm({ x: gk.x - goalX, y: (gk.y - FIELD.cy) || 0.3 });
          b.vx = away.x * 9 + (rng.next() - 0.5) * 4;
          b.vy = away.y * 9 + (rng.next() - 0.5) * 6;
          b.vz = 2; b.z = 0.2; gk.kickCooldown = 0.25; registerTouch(gk);
          log(state, 'save', `${gk.label} 펀칭`);
        }
        return;
      }
    }

    let cand = null, cd = CONTROL_R;
    for (const p of state.players) {
      if (p.kickCooldown > 0) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      // GKs can claim higher balls (use hands) inside their own area.
      const reach = (p.role === 'GK' && inPenaltyArea(p.x, p.y, defendingGoalX(state.teams[p.team].dir)))
        ? CONTROL_R + 0.8 : CONTROL_R;
      const heightOk = b.z < (p.role === 'GK' ? 2.4 : 1.7);
      if (heightOk && d < cd && d < reach) { cd = d; cand = p; }
    }
    if (cand) {
      // A fast ball into a player is a first touch that partially kills pace.
      const consumed = registerTouch(cand);
      if (!consumed) giveBall(cand);
      b.vz = 0; b.z = 0;
    }
  }

  // ─── restarts ───────────────────────────────────────────────────────────────
  function setRestart(state2, type, team, spot, meta = {}) {
    state2.ball.owner = null;
    state2.ball.vx = 0; state2.ball.vy = 0; state2.ball.vz = 0; state2.ball.z = 0;
    state2.possession = null;
    state2.offsideWatch = null;
    state2.phase = 'SETUP';
    state2.restart = { type, team, spot: { x: spot.x, y: spot.y }, timer: SETUP_TIME, ...meta };
    state2.ball.x = spot.x; state2.ball.y = spot.y;
    state2.stoppage += SETUP_TIME;
  }

  function placeForRestart(state2) {
    const r = state2.restart;
    state2.ball.x = r.spot.x; state2.ball.y = r.spot.y; state2.ball.z = 0;
    state2.ball.vx = 0; state2.ball.vy = 0; state2.ball.vz = 0; state2.ball.owner = null;
    // The taker is the nearest team-mate to the spot; placed on the ball.
    const taker = state2.players
      .filter((p) => p.team === r.team && p.role !== 'GK')
      .sort((a, b2) => dist(a, r.spot) - dist(b2, r.spot))[0];
    if (taker) { taker.x = r.spot.x - state2.teams[r.team].dir * 0.8; taker.y = r.spot.y; taker.vx = 0; taker.vy = 0; }
    state2.restart.takerId = taker?.id ?? null;
  }

  function resumePlay(state2) {
    state2.phase = 'PLAY';
    const taker = state2.players.find((p) => p.id === state2.restart.takerId);
    if (taker) giveBall(taker);
    state2.restart = null;
  }

  function kickoffFor(team) {
    setRestart(state, 'kickoff', team, { x: FIELD.W / 2, y: FIELD.cy });
    state.restart.timer = GOAL_TIME; // (only used right after a goal; see below)
    placeForRestart(state);
  }

  // Move everyone toward their shape while a restart is being set up.
  function positionForRestart(dt) {
    think(state, dt); // brains still drive off-ball shape
    const taker = state.players.find((p) => p.id === state.restart?.takerId);
    for (const p of state.players) {
      if (p === taker) { p.desiredVx = 0; p.desiredVy = 0; } // hold on the ball
      integratePlayer(p, dt);
    }
    for (let i = 0; i < state.players.length; i++) {
      for (let j = i + 1; j < state.players.length; j++) separate(state.players[i], state.players[j]);
    }
  }

  // ─── the step ───────────────────────────────────────────────────────────────
  function step(dt) {
    // Decrement kick cooldowns.
    for (const p of state.players) if (p.kickCooldown > 0) p.kickCooldown = Math.max(0, p.kickCooldown - dt);

    if (state.phase === 'GOAL') {
      state.restart.timer -= dt;
      positionForRestart(dt);
      if (state.restart.timer <= 0) { placeForRestart(state); state.phase = 'SETUP'; state.restart.timer = SETUP_TIME; }
      return state;
    }
    if (state.phase === 'HALF_TIME') {
      state.restart.timer -= dt;
      if (state.restart.timer <= 0) startSecondHalf();
      return state;
    }
    if (state.phase === 'FULL_TIME') return state;

    if (state.phase === 'SETUP' || state.phase === 'KICKOFF') {
      state.restart.timer -= dt;
      positionForRestart(dt);
      if (state.restart.timer <= 0) resumePlay(state);
      return state;
    }

    // ── live play ──
    const intent = think(state, dt);

    for (const p of state.players) integratePlayer(p, dt);
    for (let i = 0; i < state.players.length; i++) {
      for (let j = i + 1; j < state.players.length; j++) separate(state.players[i], state.players[j]);
    }

    resolveTackles();
    if (intent && state.phase === 'PLAY' && state.ball.owner === intent.playerId) executeKick(intent);
    updateBall(dt);

    // Referee: goals & out of play.
    const decision = evaluateDeadBall(state);
    if (decision) handleDecision(decision);

    // Clock.
    state.clock += dt;
    if (state.half === 1 && state.clock >= state.halfLength) startHalfTime();
    else if (state.half === 2 && state.clock >= state.halfLength * 2 + state.stoppage) endMatch();

    return state;
  }

  function handleDecision(decision) {
    if (decision.kind === 'goal') {
      state.score[decision.scoringTeam]++;
      log(state, 'goal', `골! ${state.teams[decision.scoringTeam].name} (${state.score.L}-${state.score.R})`);
      state.phase = 'GOAL';
      const conceding = decision.scoringTeam === 'L' ? 'R' : 'L';
      state.restart = { type: 'kickoff', team: conceding, spot: { x: FIELD.W / 2, y: FIELD.cy }, timer: GOAL_TIME };
      state.ball.owner = null; state.ball.vx = state.ball.vy = state.ball.vz = 0; state.ball.z = 0;
      state.possession = null; state.offsideWatch = null;
      return;
    }
    setRestart(state, decision.type, decision.team, decision.spot);
    placeForRestart(state);
    log(state, decision.type, `${RESTART_KO[decision.type] ?? decision.type} — ${state.teams[decision.team].name}`);
  }

  function startHalfTime() {
    state.phase = 'HALF_TIME';
    state.restart = { timer: 2.0 };
    log(state, 'half_time', `하프타임 (${state.score.L}-${state.score.R})`);
  }
  function startSecondHalf() {
    state.half = 2;
    state.clock = state.halfLength;
    // Teams change ends.
    state.teams.L.dir = -1; state.teams.R.dir = 1;
    for (const p of state.players) { const b = p; b.baseX = FIELD.W - b.baseX; b.baseY = FIELD.H - b.baseY; }
    kickoffFor('R');
    state.phase = 'SETUP'; state.restart.timer = SETUP_TIME; placeForRestart(state);
    log(state, 'kickoff', '후반 시작');
  }
  function endMatch() {
    state.phase = 'FULL_TIME';
    log(state, 'full_time', `경기 종료 (${state.score.L}-${state.score.R})`);
  }

  return {
    get state() { return state; },
    step,
    reset() { return createMatch(options); },
  };
}

function log(state, type, text) {
  state.events.push({ t: state.clock, type, text });
  if (state.events.length > 60) state.events.shift();
  state.counts[type] = (state.counts[type] || 0) + 1;
}

const KICK_KO = { pass: '패스', shot: '슛', clear: '클리어' };
const RESTART_KO = {
  throw_in: '스로인', goal_kick: '골킥', corner_kick: '코너킥',
  free_kick: '프리킥', penalty: '페널티킥', kickoff: '킥오프',
};
