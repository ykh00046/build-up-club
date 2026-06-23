// Pitch constants. Coordinates are meters; we always attack RIGHT
// (our goal at x=0, opponent goal at x=PITCH_W).

export const PITCH_W = 105;
export const PITCH_H = 68;

// 5-channel × 4-third positional grid (Juego de Posición).
export const CHANNEL_BOUNDS_Y = [0, 13.6, 27.2, 40.8, 54.4, 68];
export const THIRD_BOUNDS_X = [0, 26.25, 52.5, 78.75, 105];
export const CHANNEL_LABELS = ['LW', 'LHS', 'C', 'RHS', 'RW'];
export const THIRD_LABELS = ['own 1/3', 'build', 'progression', 'final 1/3'];

// Phase boundaries (ball x while in control).
export const PHASE_LINES = {
  PROGRESSION: 40,   // past the opp front line = build-up cleared
  FINAL_THIRD: 72,   // entering chance-creation territory
};

// Penalty box geometry at the opponent end.
export const BOX = {
  x: PITCH_W - 16.5, yMin: (PITCH_H - 40.32) / 2, yMax: (PITCH_H + 40.32) / 2,
  sixX: PITCH_W - 5.5, sixYMin: (PITCH_H - 18.32) / 2, sixYMax: (PITCH_H + 18.32) / 2,
  penaltySpotX: PITCH_W - 11,
};

export const COLORS = Object.freeze({
  bg:           '#0b0f14',
  pitch:        '#0f1e16',
  pitchLine:    '#2e4238',
  pitchAccent:  '#426050',
  channelGrid:  'rgba(120, 180, 160, 0.10)',
  channelLabel: 'rgba(200, 230, 220, 0.40)',
  thirdLabel:   'rgba(200, 230, 220, 0.35)',
  us:           '#f5f7fa',
  usStroke:     '#1f2a37',
  usText:       '#1f2a37',
  usTag:        'rgba(245, 247, 250, 0.55)',
  opp:          '#c44b4b',
  oppStroke:    '#2a0d0d',
  oppText:      '#fdecec',
  oppTag:       'rgba(196, 75, 75, 0.75)',
  ball:         '#f5a623',
  ballStroke:   '#1a0f00',
  laneSafe:     'rgba(93, 214, 197, 0.9)',
  laneRisky:    'rgba(245, 166, 35, 0.9)',
  laneCut:      'rgba(255, 92, 92, 0.9)',
  window:       'rgba(93, 214, 197, 0.16)',
  windowEdge:   'rgba(93, 214, 197, 0.55)',
});

export const TOKEN_R_M = 1.15;
export const BALL_R_M = 0.45;

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// Distance from point p to segment a-b, plus the projection parameter t.
export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { d: dist(p, a), t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
}
