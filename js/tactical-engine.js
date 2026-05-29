// ─── Build-Up Lab Tactical & Physics Engine ───────────────────
// 전술 기하, 물리 판정 및 BFS AI 솔버 로직

// ─── Shared Constants ───────────────────────────────────
const FIELD_X0 = 10, FIELD_X1 = 374, FIELD_Y0 = 10, FIELD_Y1 = 246;
const PLAYER_RADIUS = 8;
const BALL_RADIUS = 3;
const HIT_RADIUS = 14;
const PASS_SPEED = 120;

// 5 channels by y: wing / half-space / centre / half-space / wing
const CHANNELS = [
  { y0: 10,  y1: 57,  short: 'LW',  label: 'LEFT WING' },
  { y0: 57,  y1: 104, short: 'LHS', label: 'LEFT HALF-SPACE' },
  { y0: 104, y1: 152, short: 'C',   label: 'CENTRE' },
  { y0: 152, y1: 199, short: 'RHS', label: 'RIGHT HALF-SPACE' },
  { y0: 199, y1: 246, short: 'RW',  label: 'RIGHT WING' },
];

const TACTICAL_ACTION_ORDER = ['pass', 'bounce', 'thirdMan', 'switchPlay', 'dropPivot'];
const TACTICAL_ACTIONS = {
  pass: { id: 'pass', key: '1', label: 'PASS', sub: 'direct lane', desc: 'Play the clearest available lane.', concept: 'freeMan' },
  bounce: { id: 'bounce', key: '2', label: 'BOUNCE', sub: 'one-two connector', desc: 'Use a connector to bounce around the first presser.', concept: 'thirdPlayerSupport' },
  thirdMan: { id: 'thirdMan', key: '3', label: '3RD MAN', sub: 'blind-side run', desc: 'Find a runner arriving beyond the pressure line.', concept: 'thirdManRun' },
  switchPlay: { id: 'switchPlay', key: '4', label: 'SWITCH', sub: 'far-side release', desc: 'Go over the ball-side squeeze into weak-side space.', concept: 'switchPlay' },
  dropPivot: { id: 'dropPivot', key: '5', label: 'DROP DM', sub: 'deeper support', desc: 'Drop the pivot to create a safer first angle.', concept: 'dropPivot' }
};

const COHESION_Y = 4;
const PRESS_BACKPASS_BONUS = 4;
const PRESS_TRAP_BONUS = 4;
// A switch (lofted ball) only reaches a teammate in space — if any defender is
// within this radius of the receiver, the weak side isn't isolated and the
// switch is not on. Keeps the long ball from being a free escape to any far man.
const SWITCH_ISOLATION_RADIUS = 46;

const LANE_STATUS_RANK = {
  safe: 0,
  lineBreaking: 1,
  risky: 2,
  baited: 3,
  blocked: 4,
};

// ─── Utility Math & Geometry Functions ───────────────────
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function channelOf(y) {
  for (let i = 0; i < CHANNELS.length; i++) {
    if (y < CHANNELS[i].y1) return i;
  }
  return CHANNELS.length - 1;
}

function lineCircleIntersect(p1, p2, c, r) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - c.x;
  const fy = p1.y - c.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * cc;
  if (disc < 0) return false;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return true;
  if (t2 >= 0 && t2 <= 1) return true;
  if (t1 < 0 && t2 > 1) return true;
  return false;
}

function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

function pointInTrapZone(p, trapZones = []) {
  for (const z of trapZones) {
    if (pointInRect(p.x, p.y, z.x, z.y, z.w, z.h)) return z;
  }
  return null;
}

function pointInCoverShadow(p, d, h) {
  const vHD = { x: d.x - h.x, y: d.y - h.y };
  const distHD = Math.sqrt(vHD.x * vHD.x + vHD.y * vHD.y);
  if (distHD === 0) return false;
  const dirHD = { x: vHD.x / distHD, y: vHD.y / distHD };

  const vDP = { x: p.x - d.x, y: p.y - d.y };
  const distDP = Math.sqrt(vDP.x * vDP.x + vDP.y * vDP.y);
  if (distDP === 0) return false;
  if (distDP > d.coverShadowLength) return false;
  const dirDP = { x: vDP.x / distDP, y: vDP.y / distDP };

  const dot = dirHD.x * dirDP.x + dirHD.y * dirDP.y;
  if (dot <= 0) return false;

  const angle = Math.acos(dot) * 180 / Math.PI;
  return angle <= (d.coverShadowAngle / 2);
}

function lineIntersectsCoverShadow(p1, p2, d, h) {
  const samples = 16;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const p = {
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t
    };
    if (pointInCoverShadow(p, d, h)) {
      return true;
    }
  }
  return false;
}

// ─── Collective Pressing Block Movement ───────────────────
function stepDefender(d, holder, prevHolderX) {
  const nd = { ...d, patrolPath: d.patrolPath ? d.patrolPath.map(p => ({ ...p })) : null };
  if (!holder) return nd;
  const backPass = (prevHolderX != null) && (holder.x < prevHolderX - 2);
  const ch = channelOf(holder.y);
  const onWing = (ch === 0 || ch === 4);

  if (d.type === 'patrol' && d.patrolPath) {
    nd.patrolIdx = d.patrolIdx || 0;
    nd.patrolDir = d.patrolDir || 1;
    const target = d.patrolPath[nd.patrolIdx];
    const dx = target.x - d.x, dy = target.y - d.y;
    const dd = Math.sqrt(dx * dx + dy * dy);
    const moveAmt = 15;
    if (dd <= moveAmt) {
      nd.x = target.x; nd.y = target.y;
      nd.patrolIdx += nd.patrolDir;
      if (nd.patrolIdx >= d.patrolPath.length || nd.patrolIdx < 0) {
        nd.patrolDir *= -1;
        nd.patrolIdx += nd.patrolDir * 2;
        nd.patrolIdx = Math.max(0, Math.min(nd.patrolIdx, d.patrolPath.length - 1));
      }
    } else {
      nd.x += (dx / dd) * moveAmt;
      nd.y += (dy / dd) * moveAmt;
    }
  } else if (d.type === 'chase') {
    if (dist(d, holder) < (d.alertRange || 80)) {
      const dx = holder.x - d.x, dy = holder.y - d.y;
      const dd = Math.sqrt(dx * dx + dy * dy);
      const moveAmt = 12 + (backPass ? PRESS_BACKPASS_BONUS : 0);
      if (dd > 0) {
        nd.x += (dx / dd) * Math.min(moveAmt, dd);
        nd.y += (dy / dd) * Math.min(moveAmt, dd);
      }
    }
  } else if (d.type === 'presser') {
    if (dist(d, holder) < 100) {
      const dx = holder.x - d.x, dy = holder.y - d.y;
      const dd = Math.sqrt(dx * dx + dy * dy);
      const moveAmt = 8 + (backPass ? PRESS_BACKPASS_BONUS : 0) + (onWing ? PRESS_TRAP_BONUS : 0);
      if (dd > 20) {
        nd.x += (dx / dd) * moveAmt;
        nd.y += (dy / dd) * moveAmt;
      }
    }
  } else {
    // static: block cohesion — slide ball-side in y only
    const dy = holder.y - d.y;
    if (Math.abs(dy) > COHESION_Y) nd.y += Math.sign(dy) * COHESION_Y;
    else nd.y = holder.y;
  }
  return nd;
}

// ─── Pure Tactical Metadata Helpers ─────────────────────
function getLevelTacticalMetadata(id) {
  const lvl = LEVELS.find(level => level.id === id);
  if (!lvl) {
    return { our: 'build-up unit', opponent: 'pressing block', concept: 'Build-Up Drill' };
  }
  return {
    our: lvl.ourShape || 'build-up unit',
    opponent: lvl.opponentShape || 'pressing block',
    concept: lvl.intendedConcept || 'Build-Up Drill'
  };
}

function getPlayerLabel(p, i) {
  if (p.x === undefined) return '';
  if (p.x < 65) return 'GK';
  if (p.x >= 65 && p.x < 110) {
    return p.y < 128 ? 'RCB' : 'LCB';
  }
  if (p.x >= 110 && p.x < 155) {
    if (p.y < 60) return 'RB';
    if (p.y > 196) return 'LB';
    return 'DM';
  }
  if (p.x >= 155 && p.x < 220) {
    return p.y < 128 ? '8R' : '8L';
  }
  if (p.x >= 220 && p.x < 300) {
    return p.y < 128 ? 'AM' : 'CM';
  }
  return 'FW';
}

function getActionLogLabel(actionId) {
  const action = TACTICAL_ACTIONS[actionId] || TACTICAL_ACTIONS.pass;
  return action.label;
}

function formatLaneForLog(lane) {
  if (!lane) return 'lane read';
  if (lane.status === 'lineBreaking') return `broke ${lane.breaksLines || 1} line`;
  if (lane.status === 'risky') return `risky: ${lane.reason || 'pressure'}`;
  if (lane.status === 'baited') return 'baited trap';
  if (lane.status === 'blocked') return `blocked: ${lane.reason || 'lane'}`;
  return 'safe lane';
}

function getDefenderLabel(d, i) {
  if (d.type === 'presser') return 'ST';
  if (d.type === 'chase') return 'CM';
  if (d.type === 'patrol') return 'WM';
  return 'DF';
}

function getLevelTacticalLabel(id) {
  if (id <= 5) return `DRILL 0${id}`;
  if (id <= 10) return `PATTERN 0${id - 5}`;
  if (id <= 15) return `SCENARIO 0${id - 10}`;
  if (id <= 20) return `CHALLENGE 0${id - 15}`;
  return `GEGENPRESS 0${id - 20}`;
}

// ─── Pure Tactical Lane & Receiver Evaluation ────────────
function makeLaneResult(status = 'safe', reason = '', extra = {}) {
  return {
    status,
    reason,
    breaksLines: 0,
    trapRisk: 0,
    byDefender: null,
    ...extra
  };
}

function evaluateLane(from, to, defenders, opts = {}) {
  const ignoreShadow = !!opts.ignoreShadow;
  const isSwitch = !!opts.switchPlay;
  const ignoreRange = !!opts.ignoreRange;
  const trapZones = opts.trapZones || [];
  const pRange = from.passRange || 150;

  if (isSwitch) {
    if (dist(from, to) < 140) {
      return makeLaneResult('blocked', 'switchRange');
    }
    // Weak-side isolation: a lofted switch only reaches a teammate in space.
    // If a defender is hugging the receiver, the far man isn't isolated.
    for (const d of defenders) {
      if (dist(d, to) < SWITCH_ISOLATION_RADIUS) {
        return makeLaneResult('blocked', 'notIsolated', { byDefender: d });
      }
    }
    return makeLaneResult();
  } else if (!ignoreRange) {
    if (dist(from, to) > pRange) {
      return makeLaneResult('blocked', 'outOfRange');
    }
  }

  let worst = 'safe';
  let reason = '';
  let byDefender = null;
  let trapRisk = 0;

  for (const z of trapZones) {
    if (pointInRect(to.x, to.y, z.x, z.y, z.w, z.h)) {
      worst = 'baited';
      reason = 'trapZone';
      trapRisk = z.penalty || 20;
      break;
    }
  }

  for (const d of defenders) {
    if (lineCircleIntersect(from, to, d, d.blockRadius)) {
      return makeLaneResult('blocked', 'pressureRadius', { byDefender: d });
    }

    if (!ignoreShadow && lineIntersectsCoverShadow(from, to, d, from)) {
      return makeLaneResult('blocked', 'coverShadow', { byDefender: d });
    }

    if (lineCircleIntersect(from, to, d, d.blockRadius * 1.35)) {
      if (LANE_STATUS_RANK.risky > LANE_STATUS_RANK[worst]) {
        worst = 'risky';
        reason = 'pressureRadius';
        byDefender = d;
      }
    }

    if (dist(d, to) < d.blockRadius * 1.35) {
      if (LANE_STATUS_RANK.risky > LANE_STATUS_RANK[worst]) {
        worst = 'risky';
        reason = 'receiverPressure';
        byDefender = d;
      }
    }
  }

  let breaksLines = 0;
  if (LANE_STATUS_RANK[worst] <= LANE_STATUS_RANK.lineBreaking && to.x > from.x) {
    const xs = defenders.map(d => d.x).sort((a, b) => a - b);
    const lines = [];
    for (const x of xs) {
      if (lines.length && Math.abs(x - lines[lines.length - 1]) < 22) {
        lines[lines.length - 1] = (lines[lines.length - 1] + x) / 2;
      } else {
        lines.push(x);
      }
    }
    for (const lx of lines) {
      if (from.x < lx && lx < to.x) {
        breaksLines++;
      }
    }
    if (breaksLines > 0 && LANE_STATUS_RANK.lineBreaking > LANE_STATUS_RANK[worst]) {
      worst = 'lineBreaking';
      reason = 'lineBreak';
    }
  }

  return makeLaneResult(worst, reason, { breaksLines, trapRisk, byDefender });
}

function combineLaneResults(lanes) {
  return lanes.reduce((worst, lane) => {
    return LANE_STATUS_RANK[lane.status] > LANE_STATUS_RANK[worst.status] ? lane : worst;
  }, makeLaneResult());
}

function receiverState(receiver, defenders, context = {}) {
  const ctx = context && (context.prevHolder || context.teammates || context.receiverIdx != null)
    ? context
    : { prevHolder: context };
  const prevHolder = ctx.prevHolder || null;
  const teammates = ctx.teammates || [];
  const receiverIdx = ctx.receiverIdx;
  let nearest = null;
  let nearestDist = Infinity;

  for (const d of defenders) {
    const dToReceiver = dist(receiver, d);
    if (dToReceiver < nearestDist) {
      nearest = d;
      nearestDist = dToReceiver;
    }
    if (dToReceiver < d.blockRadius) {
      return { status: 'trapped', byDefender: d, reason: 'marked' };
    }
    if (prevHolder && d.type === 'presser' && pointInCoverShadow(receiver, d, prevHolder)) {
      return { status: 'trapped', byDefender: d, reason: 'coverShadow' };
    }
  }

  let status = 'free';
  let reason = '';
  let byDefender = nearest;

  if (nearest && nearestDist < nearest.blockRadius * 1.45) {
    status = 'underPressure';
    reason = 'near';
  }

  const goalsideDefender = nearest && nearest.x > receiver.x - 2 && nearestDist < nearest.blockRadius * 1.9;
  const backwardReceive = prevHolder && receiver.x < prevHolder.x - 12;
  if (goalsideDefender || backwardReceive) {
    status = 'backToGoal';
    reason = backwardReceive ? 'backPass' : 'goalsidePressure';
  }

  if (status !== 'free' && teammates.length) {
    let hasOutlet = false;
    for (let i = 0; i < teammates.length; i++) {
      if (i === receiverIdx) continue;
      const lane = evaluateLane(receiver, teammates[i], defenders);
      if (lane.status !== 'blocked') {
        hasOutlet = true;
        break;
      }
    }
    if (!hasOutlet) {
      return { status: 'trapped', byDefender, reason: 'noOutlet' };
    }
  }

  return { status, byDefender: status === 'free' ? null : byDefender, reason };
}

// ─── AI BFS Solver ──────────────────────────────────────────
function solveLevel(id) {
  const lvl = LEVELS.find(l => l.id === id);
  if (!lvl) return 'Level not found';

  const initialPlayers = lvl.players.map(p => ({
    x: p.x, y: p.y,
    hasBall: !!p.hasBall,
    passRange: p.passRange || 150
  }));
  const initialDefenders = lvl.defenders.map(d => ({
    x: d.x, y: d.y,
    type: d.type,
    blockRadius: d.blockRadius,
    coverShadowAngle: d.coverShadowAngle || 0,
    coverShadowLength: d.coverShadowLength || 0,
    patrolPath: d.patrolPath ? d.patrolPath.map(p => ({...p})) : null,
    patrolIdx: 0,
    patrolDir: 1,
    speed: d.speed || 1,
    alertRange: d.alertRange || 80
  }));
  const tz = lvl.targetZone;
  const trapZones = lvl.trapZones || [];
  if (!tz) return 'No target zone';
  const tzCenter = { x: tz.x + tz.w / 2, y: tz.y + tz.h / 2 };
  const startIdx = initialPlayers.findIndex(p => p.hasBall);

  function advanceDefs(defs, players, holderIdx, prevHolderX) {
    const holder = players[holderIdx];
    const trapZone = pointInTrapZone(holder, trapZones);
    return defs.map(d => {
      let nd = stepDefender(d, holder, prevHolderX);
      if (trapZone && dist(d, { x: trapZone.x + trapZone.w / 2, y: trapZone.y + trapZone.h / 2 }) < 150) {
        nd = stepDefender(nd, holder, prevHolderX);
      }
      return nd;
    });
  }

  const queue = [{
    idx: startIdx,
    passes: 0,
    path: ['START'],
    players: initialPlayers,
    defenders: initialDefenders,
    actions: { ...lvl.tacticalActions }
  }];

  const visited = new Set();
  const stateKey = (s) => {
    const playerPos = s.players.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join('|');
    const defPos = s.defenders.map(d => `${Math.round(d.x)},${Math.round(d.y)}`).join('|');
    return `${s.idx}_${s.passes}_${playerPos}_${defPos}_b${s.actions.bounce}_t${s.actions.thirdMan}_s${s.actions.switchPlay}_d${s.actions.dropPivot}`;
  };

  visited.add(stateKey(queue[0]));

  let iterations = 0;
  while (queue.length > 0) {
    iterations++;
    if (iterations > 12000) break;
    const cur = queue.shift();
    const from = cur.players[cur.idx];

    const zoneLane = evaluateLane(from, tzCenter, cur.defenders, { trapZones });
    if (zoneLane.status !== 'blocked' && cur.passes + 1 <= lvl.passLimit) {
      return { path: [...cur.path, 'ESCAPE_ZONE'], passes: cur.passes + 1, success: true };
    }

    for (let i = 0; i < cur.players.length; i++) {
      if (i === cur.idx) continue;
      const target = cur.players[i];

      const lane = evaluateLane(from, target, cur.defenders, { trapZones });
      if (lane.status !== 'blocked' && cur.passes + 1 <= lvl.passLimit) {
        const nextDefenders = advanceDefs(cur.defenders, cur.players, i, from.x);
        const rState = receiverState(target, nextDefenders, {
          prevHolder: from,
          teammates: cur.players,
          receiverIdx: i
        });
        if (rState.status !== 'trapped') {
          const inZone = pointInRect(target.x, target.y, tz.x, tz.y, tz.w, tz.h);
          if (inZone) {
            return { path: [...cur.path, `PASS(${i})`], passes: cur.passes + 1, success: true };
          }
          const nextState = {
            idx: i,
            passes: cur.passes + 1,
            path: [...cur.path, `PASS(${i})`],
            players: cur.players.map(p => ({...p})),
            defenders: nextDefenders,
            actions: { ...cur.actions }
          };
          const key = stateKey(nextState);
          if (!visited.has(key)) {
            visited.add(key);
            queue.push(nextState);
          }
        }
      }

      if (cur.actions.bounce > 0) {
        let connIdx = -1;
        let minDist = 9999;
        for (let j = 0; j < cur.players.length; j++) {
          if (j !== cur.idx && j !== i) {
            const d = dist(from, cur.players[j]) + dist(cur.players[j], target);
            if (d < minDist) {
              minDist = d;
              connIdx = j;
            }
          }
        }
        if (connIdx >= 0) {
          const conn = cur.players[connIdx];
          const lane1 = evaluateLane(from, conn, cur.defenders, { ignoreRange: true, trapZones });
          const lane2 = evaluateLane(conn, target, cur.defenders, { ignoreRange: true, trapZones });

          if (lane1.status !== 'blocked' && lane2.status !== 'blocked' && cur.passes + 1 <= lvl.passLimit) {
            const nextDefenders = advanceDefs(cur.defenders, cur.players, i, from.x);
            const rState = receiverState(target, nextDefenders, {
              prevHolder: conn,
              teammates: cur.players,
              receiverIdx: i
            });
            if (rState.status !== 'trapped') {
              const inZone = pointInRect(target.x, target.y, tz.x, tz.y, tz.w, tz.h);
              if (inZone) {
                return { path: [...cur.path, `BOUNCE(${connIdx}->${i})`], passes: cur.passes + 1, success: true };
              }
              const nextState = {
                idx: i,
                passes: cur.passes + 1,
                path: [...cur.path, `BOUNCE(${connIdx}->${i})`],
                players: cur.players.map(p => ({...p})),
                defenders: nextDefenders,
                actions: { ...cur.actions, bounce: cur.actions.bounce - 1 }
              };
              const key = stateKey(nextState);
              if (!visited.has(key)) {
                visited.add(key);
                queue.push(nextState);
              }
            }
          }
        }
      }

      if (cur.actions.switchPlay > 0) {
        const lane = evaluateLane(from, target, cur.defenders, { switchPlay: true, trapZones });
        if (lane.status !== 'blocked' && cur.passes + 1 <= lvl.passLimit) {
          const nextDefenders = advanceDefs(cur.defenders, cur.players, i, from.x);
          const rState = receiverState(target, nextDefenders, {
            prevHolder: null,
            teammates: cur.players,
            receiverIdx: i
          });
          if (rState.status !== 'trapped') {
            const inZone = pointInRect(target.x, target.y, tz.x, tz.y, tz.w, tz.h);
            if (inZone) {
              return { path: [...cur.path, `SWITCH(${i})`], passes: cur.passes + 1, success: true };
            }
            const nextState = {
              idx: i,
              passes: cur.passes + 1,
              path: [...cur.path, `SWITCH(${i})`],
              players: cur.players.map(p => ({...p})),
              defenders: nextDefenders,
              actions: { ...cur.actions, switchPlay: cur.actions.switchPlay - 1 }
            };
            const key = stateKey(nextState);
            if (!visited.has(key)) {
              visited.add(key);
              queue.push(nextState);
            }
          }
        }
      }

      if (cur.actions.thirdMan > 0) {
        let runnerIdx = -1;
        let maxX = -999;
        for (let j = 0; j < cur.players.length; j++) {
          if (j !== cur.idx && cur.players[j].x > maxX) {
            maxX = cur.players[j].x;
            runnerIdx = j;
          }
        }
        if (runnerIdx === i) {
          const tempPlayers = cur.players.map(p => ({...p}));
          const runner = tempPlayers[runnerIdx];
          runner.x += 40;
          runner.y = runner.y < 128 ? runner.y + 15 : runner.y - 15;

          let connIdx = -1;
          let minDist = 9999;
          for (let j = 0; j < tempPlayers.length; j++) {
            if (j !== cur.idx && j !== runnerIdx) {
              const d = dist(from, tempPlayers[j]);
              if (d < minDist) {
                minDist = d;
                connIdx = j;
              }
            }
          }
          if (connIdx >= 0) {
            const conn = tempPlayers[connIdx];
            const lane1 = evaluateLane(from, conn, cur.defenders, { ignoreRange: true, trapZones });
            const lane2 = evaluateLane(conn, runner, cur.defenders, { ignoreRange: true, trapZones });

            if (lane1.status !== 'blocked' && lane2.status !== 'blocked' && cur.passes + 1 <= lvl.passLimit) {
              const nextDefenders = advanceDefs(cur.defenders, tempPlayers, runnerIdx, from.x);
              const rState = receiverState(runner, nextDefenders, {
                prevHolder: conn,
                teammates: tempPlayers,
                receiverIdx: runnerIdx
              });
              if (rState.status !== 'trapped') {
                const inZone = pointInRect(runner.x, runner.y, tz.x, tz.y, tz.w, tz.h);
                if (inZone) {
                  return { path: [...cur.path, `3RD_MAN(${connIdx}->${runnerIdx})`], passes: cur.passes + 1, success: true };
                }
                const nextState = {
                  idx: runnerIdx,
                  passes: cur.passes + 1,
                  path: [...cur.path, `3RD_MAN(${connIdx}->${runnerIdx})`],
                  players: tempPlayers,
                  defenders: nextDefenders,
                  actions: { ...cur.actions, thirdMan: cur.actions.thirdMan - 1 }
                };
                const key = stateKey(nextState);
                if (!visited.has(key)) {
                  visited.add(key);
                  queue.push(nextState);
                }
              }
            }
          }
        }
      }

      if (cur.actions.dropPivot > 0) {
        let pivotIdx = -1;
        for (let j = 0; j < cur.players.length; j++) {
          if (j !== cur.idx && cur.players[j].x >= 120 && cur.players[j].x <= 190) {
            pivotIdx = j;
            break;
          }
        }
        if (pivotIdx === i) {
          const tempPlayers = cur.players.map(p => ({...p}));
          const pivot = tempPlayers[pivotIdx];
          pivot.x = 95;
          pivot.y = 128;

          const lane = evaluateLane(from, pivot, cur.defenders, { trapZones });
          if (lane.status !== 'blocked' && cur.passes + 1 <= lvl.passLimit) {
            const nextDefenders = advanceDefs(cur.defenders, tempPlayers, pivotIdx, from.x);
            const rState = receiverState(pivot, nextDefenders, {
              prevHolder: from,
              teammates: tempPlayers,
              receiverIdx: pivotIdx
            });
            if (rState.status !== 'trapped') {
              const inZone = pointInRect(pivot.x, pivot.y, tz.x, tz.y, tz.w, tz.h);
              if (inZone) {
                return { path: [...cur.path, `DROP_PIVOT(${pivotIdx})`], passes: cur.passes + 1, success: true };
              }
              const nextState = {
                idx: pivotIdx,
                passes: cur.passes + 1,
                path: [...cur.path, `DROP_PIVOT(${pivotIdx})`],
                players: tempPlayers,
                defenders: nextDefenders,
                actions: { ...cur.actions, dropPivot: cur.actions.dropPivot - 1 }
              };
              const key = stateKey(nextState);
              if (!visited.has(key)) {
                visited.add(key);
                queue.push(nextState);
              }
            }
          }
        }
      }

    }
  }

  return { success: false, path: null, passes: 0 };
}

function solveAllLevels() {
  console.log('%c--- BUILD-UP LAB BFS SOLVER REPORT ---', 'color:#00f5d4; font-weight:bold;');
  console.log('%cValidating all 20 tactical scenarios...', 'color:#aaa;');
  let passCount = 0;
  const results = [];
  
  LEVELS.forEach(lvl => {
    const res = solveLevel(lvl.id);
    if (res && res.success) {
      const rating = getGrade(res.passes, lvl.optimalPasses);
      const logColor = rating === 'S' ? 'color:#00f5d4;' : (rating === 'A' ? 'color:#f2a019;' : 'color:#3a86ff;');
      console.log(`%c[Scenario ${lvl.id}] ${lvl.name} -> Solved in ${res.passes} passes (Opt: ${lvl.optimalPasses}, Limit: ${lvl.passLimit}) | Rating: ${rating} | Path: ${res.path.join(' -> ')}`, logColor);
      results.push({ id: lvl.id, name: lvl.name, solved: true, passes: res.passes, optimal: lvl.optimalPasses, limit: lvl.passLimit, rating, path: res.path });
      passCount++;
    } else {
      console.error(`[Scenario ${lvl.id}] ${lvl.name} -> %cNO SOLUTION FOUND within limit!`, 'font-weight:bold;');
      results.push({ id: lvl.id, name: lvl.name, solved: false });
    }
  });

  console.log('%c---------------------------------------', 'color:#aaa;');
  console.log(`Result: ${passCount} / ${LEVELS.length} levels solved successfully.`);
  return results;
}

function getGrade(passes, optimal) {
  if (passes <= optimal) return 'S';
  if (passes <= optimal + 1) return 'A';
  return 'B';
}

// ─── Attach to window for global access ───────────────────
if (typeof window !== 'undefined') {
  window.FIELD_X0 = FIELD_X0;
  window.FIELD_X1 = FIELD_X1;
  window.FIELD_Y0 = FIELD_Y0;
  window.FIELD_Y1 = FIELD_Y1;
  window.PLAYER_RADIUS = PLAYER_RADIUS;
  window.BALL_RADIUS = BALL_RADIUS;
  window.HIT_RADIUS = HIT_RADIUS;
  window.PASS_SPEED = PASS_SPEED;
  window.CHANNELS = CHANNELS;
  window.TACTICAL_ACTION_ORDER = TACTICAL_ACTION_ORDER;
  window.TACTICAL_ACTIONS = TACTICAL_ACTIONS;
  window.COHESION_Y = COHESION_Y;
  window.PRESS_BACKPASS_BONUS = PRESS_BACKPASS_BONUS;
  window.PRESS_TRAP_BONUS = PRESS_TRAP_BONUS;
  window.LANE_STATUS_RANK = LANE_STATUS_RANK;

  window.dist = dist;
  window.lerp = lerp;
  window.channelOf = channelOf;
  window.lineCircleIntersect = lineCircleIntersect;
  window.pointInRect = pointInRect;
  window.pointInTrapZone = pointInTrapZone;
  window.pointInCoverShadow = pointInCoverShadow;
  window.lineIntersectsCoverShadow = lineIntersectsCoverShadow;
  window.stepDefender = stepDefender;
  window.getLevelTacticalMetadata = getLevelTacticalMetadata;
  window.getPlayerLabel = getPlayerLabel;
  window.getActionLogLabel = getActionLogLabel;
  window.formatLaneForLog = formatLaneForLog;
  window.getDefenderLabel = getDefenderLabel;
  window.getLevelTacticalLabel = getLevelTacticalLabel;
  window.evaluateLane = evaluateLane;
  window.combineLaneResults = combineLaneResults;
  window.receiverState = receiverState;

  window._test = {
    dist: dist,
    lineCircleIntersect: lineCircleIntersect,
    pointInCoverShadow: pointInCoverShadow,
    lineIntersectsCoverShadow: lineIntersectsCoverShadow,
    evaluateLane: evaluateLane,
    combineLaneResults: combineLaneResults,
    receiverState: receiverState,
    tacticalActions: () => TACTICAL_ACTIONS,
    getGrade: getGrade,
    storage: () => window.StorageMgr ? window.StorageMgr.data : {},
    solveLevel: solveLevel,
    solveAllLevels: solveAllLevels
  };
}
