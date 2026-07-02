// Multi-zone shot model (unified_concept_plan §6.5). The shot is not "reach
// the box, press shoot" — each zone has its own geometry, base xG, and role
// affinity. Resolution: base × shooter affinity × pressure × GK. No minigame.

import { BOX, PITCH_H, clamp, dist } from '../data/pitch.js';
import { receiverPressure } from './space.js';

export const SHOT_ZONES = [
  {
    id: 'sixYard', ko: '6야드 박스', en: 'Six-yard box',
    baseXg: 0.88,
    match: (p) => p.x > BOX.sixX - 2 && p.y > BOX.sixYMin && p.y < BOX.sixYMax,
  },
  {
    id: 'cutback', ko: '컷백 존 (페널티 스폿)', en: 'Cut-back zone (penalty spot)',
    baseXg: 0.65,
    // Penalty-spot band, qualified by arriving onto a pull-back (checked via context).
    match: (p, ctx) => p.x > BOX.x + 2 && p.x < BOX.sixX && Math.abs(p.y - PITCH_H / 2) < 11
      && ctx?.lastPassFromByline === true,
  },
  {
    id: 'header', ko: '크로스 헤더', en: 'Cross header',
    baseXg: 0.18,
    // A header needs a CROSS (wide origin → central box), not any lofted ball
    // — a central chip is a closeRange/centralD chance, not an aerial one.
    match: (p, ctx) => p.x > BOX.x + 4 && Math.abs(p.y - PITCH_H / 2) < 12 && ctx?.lastPassCross === true,
  },
  {
    // Close central: inside the box past the central-D band but short of the
    // six-yard line. Closes the inversion where x 92~97.5 fell through to
    // midRange (0.09) — i.e. a 9m central shot rated worse than a 20m one. (S1)
    id: 'closeRange', ko: '박스 중앙 근거리', en: 'Close central range',
    baseXg: 0.62,
    match: (p) => p.x > 92 && p.x <= BOX.sixX && Math.abs(p.y - PITCH_H / 2) < 11,
  },
  {
    id: 'halfSpace', ko: '하프스페이스 컬', en: 'Half-space curler',
    baseXg: 0.44,
    match: (p) => p.x > 82 && p.x <= BOX.sixX
      && ((p.y > 13.6 && p.y < 27.2) || (p.y > 40.8 && p.y < 54.4)),
  },
  {
    // Central just inside the box (x 88.5~92): fills the seam where a shooter
    // 11-16.5m out centrally rated 0.17 (centralD) while one step past x=92
    // rated 0.62 — a 3.6x cliff over half a metre. Ladder is now
    // 0.17 (D) → 0.38 (box entry) → 0.62 (close) → 0.88 (six-yard). (2026-07 audit H3)
    id: 'boxCentral', ko: '박스 정면 진입', en: 'Central box entry',
    baseXg: 0.38,
    match: (p) => p.x > BOX.x && p.x <= 92 && Math.abs(p.y - PITCH_H / 2) < 11,
  },
  {
    id: 'centralD', ko: '센트럴 D', en: 'Central D',
    baseXg: 0.17,
    match: (p) => p.x > 82 && p.x <= BOX.x && Math.abs(p.y - PITCH_H / 2) < 8,
  },
  {
    id: 'midRange', ko: '중거리', en: 'Long range',
    baseXg: 0.09,
    match: (p) => p.x > 74 && Math.abs(p.y - PITCH_H / 2) < 18,
  },
];

// Which zone (if any) does this shooter currently occupy?
export function detectShotZone(shooter, context) {
  for (const z of SHOT_ZONES) {
    if (z.match(shooter, context)) return z;
  }
  return null;
}

// Shared xG model — the ONE source both resolveShot and the engine's shot
// preview use. They had drifted apart (preview GK weights 0.8/0.45, clamp 0.85
// vs resolution 0.35/0.30/0.92), so the board read understated xG by ~20-25%
// and steered players away from good shots. Single function = honest preview.
export function computeShotXg(shooter, zone, defenders) {
  const gk = defenders.find((d) => d.line === 'gk');
  // Pressure includes the rushing GK (P1a): deep in the box the keeper IS the
  // pressure — excluding him made six-yard walk-ins read as "free" shots.
  const pressureAtShot = Math.max(
    receiverPressure(shooter, defenders),
    gk ? clamp(1 - dist(shooter, gk) / 7, 0, 1) * 0.35 : 0,
  );
  const affinity = shooter.traits?.shot?.[zone.id] ?? 0.7;
  const gkFactor = gk ? clamp(1 - (gk.traits?.keeping ?? 0.75) * clamp(1 - dist(shooter, gk) / 30, 0.2, 1) * 0.30, 0.5, 1) : 1;
  const xg = clamp(zone.baseXg * affinity * (1 - pressureAtShot * 0.35) * gkFactor, 0.01, 0.92);
  return { xg, pressureAtShot };
}

export function resolveShot(shooter, zone, state, rng) {
  const defenders = state.players.filter((p) => p.side === 'opp');
  const { xg, pressureAtShot } = computeShotXg(shooter, zone, defenders);
  const roll = rng.next();

  let result;
  if (roll < xg) result = 'goal';
  else if (roll < xg + (1 - xg) * (pressureAtShot * 0.35 + 0.10)) result = 'blocked';
  else if (roll < xg + (1 - xg) * 0.62) result = 'saved';
  else result = 'off';

  return { result, xg, zone, pressureAtShot };
}
