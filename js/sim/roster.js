// Roster builder. A 4-3-3 per side, instantiated from one base layout defined
// in "attack-right" coordinates and point-mirrored for the team attacking left.
// Traits drive the physics: pace → sprint speed & acceleration, pass/shot_power
// → kick weight & accuracy, keeping → goalkeeper reach.

import { FIELD } from './field.js';

// Base 4-3-3 home spots (team attacking +x). Lower y = one flank.
const LAYOUT = [
  { role: 'GK', num: 1,  x: 8,  y: 34, pace: 0.45, pass: 0.75, shot: 0.5, keeping: 0.8 },
  { role: 'FB', num: 2,  x: 26, y: 12, pace: 0.86, pass: 0.72, shot: 0.55 },
  { role: 'CB', num: 5,  x: 19, y: 27, pace: 0.7,  pass: 0.78, shot: 0.5 },
  { role: 'CB', num: 4,  x: 19, y: 41, pace: 0.7,  pass: 0.76, shot: 0.5 },
  { role: 'FB', num: 3,  x: 26, y: 56, pace: 0.86, pass: 0.72, shot: 0.55 },
  { role: 'DM', num: 6,  x: 39, y: 34, pace: 0.74, pass: 0.85, shot: 0.7 },
  { role: 'CM', num: 8,  x: 50, y: 23, pace: 0.8,  pass: 0.85, shot: 0.75 },
  { role: 'CM', num: 10, x: 52, y: 45, pace: 0.82, pass: 0.86, shot: 0.78 },
  { role: 'W',  num: 7,  x: 72, y: 12, pace: 0.95, pass: 0.74, shot: 0.78 },
  { role: 'W',  num: 11, x: 72, y: 56, pace: 0.95, pass: 0.74, shot: 0.78 },
  { role: 'ST', num: 9,  x: 82, y: 34, pace: 0.88, pass: 0.72, shot: 0.85 },
];

function makePlayer(team, dir, base) {
  // Team attacking left is the 180° rotation of the base layout.
  const bx = dir > 0 ? base.x : FIELD.W - base.x;
  const by = dir > 0 ? base.y : FIELD.H - base.y;
  const maxSpeed = 5.2 + base.pace * 3.6;      // ~6.8 (GK low) .. ~8.6 (winger)
  const maxAccel = 7 + base.pace * 6;          // sharper accel for quicker players
  return {
    id: `${team}-${base.role}${base.num}`,
    team, role: base.role, num: base.num,
    label: `${team}${base.num}`,
    baseX: bx, baseY: by,
    x: bx, y: by, vx: 0, vy: 0,
    desiredVx: 0, desiredVy: 0,
    heading: dir > 0 ? 0 : Math.PI,
    maxSpeed, maxAccel,
    traits: { pace: base.pace, pass: base.pass, shot_power: base.shot, keeping: base.keeping ?? 0 },
    holdTime: 0,
    kickCooldown: 0,
  };
}

export function buildRoster() {
  const players = [];
  for (const base of LAYOUT) players.push(makePlayer('L', 1, base));
  for (const base of LAYOUT) players.push(makePlayer('R', -1, base));
  return players;
}
