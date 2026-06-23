// Superiority — the missing first-class concept.
//
// The lane evaluator (space.js) measures the SHADOW of superiority: is this
// pass safe right now. This module measures the THING itself: do we outnumber
// or out-position the opponent at a given patch of grass. Numerical (2v1),
// positional (between the lines / behind a pulled marker). Qualitative (1v1
// dribble) is deliberately out of scope — not modelled yet.
//
// Pure functions over player objects {side:'us'|'opp', role, line, x, y}.
// No DOM, no engine state mutation — node-verifiable.

import { dist } from '../data/pitch.js';

// ── numerical ────────────────────────────────────────────────────────────────
// Count us vs them within `radius` of a point (keepers excluded). net>0 = we
// have the extra body here — the root of salida, overloads, the space a pulled
// marker leaves behind.
export function numericalSuperiority(point, players, radius = 11) {
  let ours = 0, opps = 0;
  for (const p of players) {
    if (dist(point, p) > radius) continue;
    if (p.side === 'us' && p.role !== 'GK') ours++;
    else if (p.side === 'opp' && p.line !== 'gk') opps++;
  }
  return { ours, opps, net: ours - opps };
}

// Average x of each opp line that exists, shallow-to-deep (toward their goal).
function oppLineXs(players) {
  const g = { front: [], mid: [], back: [] };
  for (const p of players) if (p.side === 'opp' && g[p.line]) g[p.line].push(p.x);
  const xs = [];
  for (const k of ['front', 'mid', 'back']) {
    if (g[k].length) xs.push(g[k].reduce((s, v) => s + v, 0) / g[k].length);
  }
  return xs.sort((a, b) => a - b);
}

// ── positional ───────────────────────────────────────────────────────────────
// Is the point in a gap BETWEEN two opp lines with no defender close? That is
// "between the lines" — the receiver can turn and face, the most valuable
// build-up real estate. Behind the LAST line is offside (handled elsewhere),
// so only inter-line gaps count here.
export function betweenLines(point, players, near = 6) {
  const xs = oppLineXs(players);
  let inGap = false;
  for (let i = 0; i < xs.length - 1; i++) {
    if (point.x > xs[i] + 2 && point.x < xs[i + 1] - 2) { inGap = true; break; }
  }
  if (!inGap) return false;
  for (const p of players) {
    if (p.side === 'opp' && p.line !== 'gk' && dist(point, p) <= near) return false;
  }
  return true;
}

// ── combined ─────────────────────────────────────────────────────────────────
// A single 0..N edge score at a point. net numerical advantage, plus a point
// for free between-lines occupation, plus a bonus when both coincide (an
// unmarked extra man between the lines — the best outcome of attract+release).
export function superiorityAt(point, players, opts = {}) {
  const num = numericalSuperiority(point, players, opts.radius ?? 11);
  const pos = betweenLines(point, players, opts.near ?? 6);
  const value = Math.max(num.net, 0) + (pos ? 1 : 0) + (pos && num.net >= 1 ? 1 : 0);
  return {
    value,
    net: num.net,
    betweenLines: pos,
    ours: num.ours,
    opps: num.opps,
    kind: pos && num.net >= 1 ? 'overload_between' : pos ? 'between_lines'
        : num.net >= 1 ? 'numerical' : 'none',
  };
}

// Scan our teammates ahead of (or level with) the ball; return the patches
// where we currently hold a real, progressable edge. This is what a reward
// window SHOULD point at — not "where a presser's anchor was".
export function findSuperiorityZones(state, { minValue = 1 } = {}) {
  const holder = state.players.find((p) => p.id === state.holderId) ?? { x: 20, y: 34 };
  const zones = [];
  for (const m of state.players) {
    if (m.side !== 'us' || m.role === 'GK' || m.id === state.holderId) continue;
    if (m.x < holder.x - 2) continue; // forward or level only
    const s = superiorityAt(m, state.players);
    if (s.value >= minValue) zones.push({ id: m.id, x: m.x, y: m.y, ...s });
  }
  zones.sort((a, b) => b.value - a.value || b.x - a.x);
  return zones;
}
