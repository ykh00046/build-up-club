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

// 2026-07 가독성 패스: 피치·라인·라벨을 한 단계씩 밝혀 "어두운 점 무더기" 인상 해소.
// (피치 그린 ↑, 라인 대비 ↑, 채널/서드 라벨 알파 ↑, 역할 태그를 반투명→고대비로.)
export const COLORS = Object.freeze({
  bg:           '#0b0f14',
  pitch:        '#16301f',
  pitchLine:    '#4a6b56',
  pitchAccent:  '#5d8168',
  channelGrid:  'rgba(120, 180, 160, 0.14)',
  channelLabel: 'rgba(200, 230, 220, 0.60)',
  thirdLabel:   'rgba(200, 230, 220, 0.55)',
  us:           '#f5f7fa',
  usStroke:     '#1f2a37',
  usText:       '#1f2a37',
  usTag:        'rgba(235, 244, 255, 0.95)',
  opp:          '#d94f4f',
  oppStroke:    '#2a0d0d',
  oppText:      '#fdecec',
  oppTag:       'rgba(255, 158, 158, 0.95)',
  ball:         '#f5a623',
  ballStroke:   '#1a0f00',
  laneSafe:     'rgba(93, 214, 197, 0.9)',
  laneRisky:    'rgba(245, 166, 35, 0.9)',
  laneCut:      'rgba(255, 92, 92, 0.9)',
  window:       'rgba(93, 214, 197, 0.16)',
  windowEdge:   'rgba(93, 214, 197, 0.55)',
});

// 토큰 반경 1.15m→1.5m: 일반 뷰포트에서 지름 ~17px→~22px — 번호·역할이 읽힌다.
export const TOKEN_R_M = 1.5;
export const BALL_R_M = 0.45;

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// 공을 달고 달리면 자유 주행보다 느리다(물리). 페이스·볼 컨트롤로 운반 가능 거리를
// 산출(5~10m) — 오프볼 런(~12-14m)·구조 이동(10m)보다 짧아 볼 보유자가 가장 느린
// 이동을 한다. 엔진 carry와 main.js 운반 프리뷰가 이 단일 규칙을 공유한다.
export function carryRange(traits = {}) {
  const pace = traits.pace ?? 0.6;
  const ctrl = traits.carry ?? traits.pressResistance ?? 0.6;
  return clamp(5 + pace * 4 + ctrl * 1.5, 5, 10);
}

// Distance from point p to segment a-b, plus the projection parameter t.
export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { d: dist(p, a), t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
}
