// Canvas renderer. Broadcast-tactics look: dark pitch, positional grid,
// embodied pressure cues (holder ring, vignette, GK shout) — never a number.

import {
  PITCH_W, PITCH_H, CHANNEL_BOUNDS_Y, THIRD_BOUNDS_X, CHANNEL_LABELS, THIRD_LABELS,
  COLORS, TOKEN_R_M, PHASE_LINES, clamp,
} from '../data/pitch.js';
import { prefersReducedMotion } from '../util/motion.js';
import { t, getLang } from '../career/i18n.js';

let canvas, ctx, dpr = 1, viewW = 0, viewH = 0, scale = 1, offsetX = 0, offsetY = 0;
let pulse = 0;
let usColor = null;   // 우리 팀 킷 색(클럽 컬러) — render()에서 view로 주입

// hex를 어둡게(amt<0)/밝게(amt>0) — 킷 스트로크/스탠드 음영 등에 사용.
function shadeHex(hex, amt) {
  if (typeof hex !== 'string') return '#888';
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  const mix = (c) => amt < 0 ? Math.round(c * (1 + amt)) : Math.round(c + (255 - c) * amt);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

export const toggles = { channels: true, labels: true, shadows: false, superiority: false };

export function initRenderer(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  window.addEventListener('resize', resize);
  resize();
}

export function resize() {
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  viewW = Math.max(320, Math.floor(rect.width));
  viewH = Math.max(220, Math.floor(rect.height));
  canvas.width = Math.floor(viewW * dpr);
  canvas.height = Math.floor(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const m = 26;
  scale = Math.min((viewW - m * 2) / PITCH_W, (viewH - m * 2) / PITCH_H);
  offsetX = (viewW - PITCH_W * scale) / 2;
  offsetY = (viewH - PITCH_H * scale) / 2;
}

function mx(x) { return offsetX + x * scale; }
function my(y) { return offsetY + y * scale; }

// Inverse mapping for input handling.
export function toPitch(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: (clientX - rect.left - offsetX) / scale, y: (clientY - rect.top - offsetY) / scale };
}

export function render(view, dtMs) {
  if (!ctx) return;
  // 접근성: reduced-motion이면 시간 누적자(pulse)를 멈춰 숨쉬는 윈도우·링 펄스·
  // 행진 점선·GK 흔들림 등 idle 캔버스 애니메이션을 정지(static)시킨다.
  if (!prefersReducedMotion()) pulse += dtMs / 1000;
  usColor = view.usColor || null;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, viewW, viewH);
  drawStadium();
  drawPitch();
  drawGoalsAndFlags();
  if (toggles.channels) drawChannelGrid();
  drawPhaseLine(view.phase);
  if (toggles.superiority && view.superiorityZones?.length) drawSuperiorityZones(view.superiorityZones);
  // 열린 공간(리워드 윈도우): main.js가 쉬움(mid)에서만 view.rewardWindow를 채움(난이도 학습 보조).
  if (view.rewardWindow) drawRewardWindow(view.rewardWindow);
  if (view.shotZone) drawShotZoneBadge(view.shotZone, view.holder, view.shotXg);
  if (toggles.shadows) drawCoverShadows(view);
  if (view.hover) drawHover(view.hover, view.holder);
  if (view.passOptions?.length) drawPassOptions(view.passOptions, view.players);
  if (view.runDestinations?.length) drawRunDestinations(view.runDestinations, view.players);
  drawPlayers(view.players, view.holderId, view.pressureExpr);
  if (view.keyboardTargetId) drawKbFocus(view);
  drawBall(view.ball);
  drawActionRing(view);
  drawVignette(view.pressureExpr);
  drawShout(view.pressureExpr, view.holder);
  drawCue(view.cue, view.cueTone);
}

// ─── in-board action ring ────────────────────────────────────────────────────
// The decision lives on the pitch: available actions orbit the ball holder.
// The forward hemisphere stays clear so lane previews remain readable; 슈팅
// (when live) sits at 0° — pointing at the goal it threatens.

let actionRingHits = [];

export function pickActionAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  for (const h of actionRingHits) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.id;
  }
  return null;
}

function drawActionRing(view) {
  actionRingHits = [];
  if (!view.actionRing || !view.holder) return;
  const list = view.actionRing.filter((a) => a.enabled && a.id !== 'to_feet');
  if (!list.length) return;

  const h = view.holder;
  const cx = mx(h.rx ?? h.x), cy = my(h.ry ?? h.y);
  const ringR = scale * TOKEN_R_M + 44;

  // Back-side arc keeps the forward (goal-side) view clear. Near the left
  // edge there is no back side — flip the arc to the right hemisphere.
  const flip = cx < 200;
  const shoot = list.find((a) => a.id === 'shoot');
  const rest = list.filter((a) => a.id !== 'shoot');
  const placed = [];
  const startDeg = flip ? -85 : 95;
  const endDeg = flip ? 85 : 265;
  rest.forEach((a, i) => {
    const t = rest.length === 1 ? 0.5 : i / (rest.length - 1);
    // Alternate radial stagger so near-vertical neighbours don't touch.
    placed.push({ a, deg: startDeg + (endDeg - startDeg) * t, stagger: (i % 2) * 14 });
  });
  if (shoot) placed.push({ a: shoot, deg: flip ? 180 : 0, stagger: 0 });

  // 가독성 패스(2026-07): 링 필 12px/24px + 테두리·텍스트 대비 상향 — 이전 11px
  // 저대비 필은 "정체 모를 작은 칩"으로 읽혔다.
  ctx.font = `700 12px ui-sans-serif, system-ui, sans-serif`;
  for (const { a, deg, stagger } of placed) {
    const rad = (deg * Math.PI) / 180;
    const textW = ctx.measureText(a.label).width;
    const w = textW + 20, hh = 24;
    // Push the pill centre outward so long pills don't kiss the token.
    const r = ringR + stagger + w * 0.5 * Math.abs(Math.cos(rad));
    let px = cx + Math.cos(rad) * r - w / 2;
    let py = cy + Math.sin(rad) * r - hh / 2;
    px = Math.max(2, Math.min(viewW - w - 2, px));
    py = Math.max(2, Math.min(viewH - hh - 2, py));

    const active = a.armed || a.hover;
    // U3: the shoot pill only takes the hot color in a GOOD zone — orange
    // means "finish here", not "a shot is technically legal".
    const isShoot = a.id === 'shoot' && a.good !== false;
    ctx.fillStyle = active ? 'rgba(16, 32, 30, 0.97)' : 'rgba(9, 14, 20, 0.93)';
    roundRect(px, py, w, hh, 12);
    ctx.fill();
    ctx.strokeStyle = isShoot
      ? 'rgba(245, 166, 35, 0.95)'
      : active ? 'rgba(77, 139, 255, 0.95)' : 'rgba(112, 160, 255, 0.6)';
    ctx.lineWidth = active ? 1.8 : 1.2;
    roundRect(px, py, w, hh, 12);
    ctx.stroke();
    ctx.fillStyle = isShoot ? 'rgba(255, 205, 130, 0.98)'
      : active ? 'rgba(160, 245, 232, 1)' : 'rgba(215, 240, 235, 0.98)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.label, px + w / 2, py + hh / 2 + 0.5);

    actionRingHits.push({ id: a.id, x: px, y: py, w, h: hh });
  }
}

// ─── 경기장 분위기: 스탠드·관중·플러드라이트 (피치 바깥 여백) ───────────────────
let crowdCanvas = null, crowdKey = '';
function buildCrowd() {
  const key = `${viewW}x${viewH}x${Math.round(offsetX)}x${Math.round(offsetY)}`;
  if (key === crowdKey && crowdCanvas) return;
  crowdKey = key;
  try { crowdCanvas = document.createElement('canvas'); } catch (e) { crowdCanvas = null; return; }
  crowdCanvas.width = Math.max(1, Math.floor(viewW * dpr));
  crowdCanvas.height = Math.max(1, Math.floor(viewH * dpr));
  const c = crowdCanvas.getContext('2d');
  if (!c) { crowdCanvas = null; return; }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = ['#3a4654', '#46586b', '#2f3a47', '#5a6b7e', '#404d5c', '#6878d0', '#c0556a', '#d8b24a', '#e8edf0'];
  let s = 987654321;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const px0 = mx(0), py0 = my(0), px1 = mx(PITCH_W), py1 = my(PITCH_H);
  const place = (x0, y0, x1, y1) => {
    const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const n = Math.min(1400, Math.floor(area / 22));
    for (let i = 0; i < n; i++) {
      c.fillStyle = cols[(rnd() * cols.length) | 0];
      c.globalAlpha = 0.35 + rnd() * 0.4;
      c.fillRect(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), 1.5, 1.5);
    }
  };
  place(0, 0, viewW, py0 - 7);                 // 상단
  place(0, py1 + 7, viewW, viewH);             // 하단
  place(0, py0 - 7, px0 - 7, py1 + 7);         // 좌
  place(px1 + 7, py0 - 7, viewW, py1 + 7);     // 우
}

function drawStadium() {
  const sg = ctx.createLinearGradient(0, 0, 0, viewH);
  sg.addColorStop(0, '#0c131b'); sg.addColorStop(1, '#070b10');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, viewW, viewH);
  const px0 = mx(0), py0 = my(0), px1 = mx(PITCH_W), py1 = my(PITCH_H);
  buildCrowd();
  if (crowdCanvas) { ctx.globalAlpha = 1; ctx.drawImage(crowdCanvas, 0, 0, viewW, viewH); }
  // 스탠드 벽(피치를 감싸는 어두운 띠) — 피치는 이후 drawPitch가 덮는다.
  ctx.fillStyle = '#10171f';
  ctx.fillRect(px0 - 11, py0 - 11, (px1 - px0) + 22, (py1 - py0) + 22);
  // 플러드라이트 코너 글로우.
  const glow = (gx, gy) => {
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(viewW, viewH) * 0.32);
    g.addColorStop(0, 'rgba(200, 225, 255, 0.09)'); g.addColorStop(1, 'rgba(200, 225, 255, 0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, viewW, viewH);
  };
  glow(px0, py0); glow(px1, py0); glow(px0, py1); glow(px1, py1);
}

// 골네트 + 코너 깃발 (피치 그린 뒤 호출).
function drawGoalsAndFlags() {
  const gy0 = (PITCH_H - 7.32) / 2, gy1 = (PITCH_H + 7.32) / 2;
  const depth = 2.1;
  for (const side of [0, 1]) {
    const gx = side === 0 ? 0 : PITCH_W;
    const dir = side === 0 ? -1 : 1;
    const x0 = mx(gx), x1 = mx(gx + dir * depth);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(Math.min(x0, x1), my(gy0), Math.abs(x1 - x0), my(gy1) - my(gy0));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)'; ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let yy = gy0; yy <= gy1 + 0.01; yy += 0.7) { ctx.moveTo(x0, my(yy)); ctx.lineTo(x1, my(yy)); }
    for (let t = 0; t <= depth + 0.01; t += 0.7) { const xx = mx(gx + dir * t); ctx.moveTo(xx, my(gy0)); ctx.lineTo(xx, my(gy1)); }
    ctx.stroke();
    ctx.strokeStyle = '#eef3f5'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(mx(gx), my(gy0)); ctx.lineTo(mx(gx), my(gy1)); ctx.stroke();
  }
  for (const [cxp, cyp] of [[0, 0], [PITCH_W, 0], [0, PITCH_H], [PITCH_W, PITCH_H]]) {
    const cx = mx(cxp), cy = my(cyp);
    const dirx = cxp === 0 ? 1 : -1, diry = cyp === 0 ? -1 : 1;
    ctx.strokeStyle = 'rgba(230, 235, 238, 0.85)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + diry * 7); ctx.stroke();
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.moveTo(cx, cy + diry * 7);
    ctx.lineTo(cx + dirx * 5, cy + diry * 7 + diry * 2);
    ctx.lineTo(cx, cy + diry * 7 + diry * 4);
    ctx.closePath(); ctx.fill();
  }
}

function drawPitch() {
  ctx.fillStyle = COLORS.pitch;
  ctx.fillRect(mx(0), my(0), PITCH_W * scale, PITCH_H * scale);
  // 유사 3D: 잔디 깎기 스트라이프(세로 밴드) — 잔디 결의 입체감.
  const STRIPES = 12;
  const bw = PITCH_W / STRIPES;
  for (let i = 0; i < STRIPES; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.045)' : 'rgba(0, 0, 0, 0.055)';
    ctx.fillRect(mx(i * bw), my(0), bw * scale + 1, PITCH_H * scale);
  }
  // 방향 조명(위쪽 밝게 → 아래쪽 어둡게) — 조명 받은 경기장 깊이.
  const litG = ctx.createLinearGradient(mx(0), my(0), mx(0), my(PITCH_H));
  litG.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
  litG.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  litG.addColorStop(1, 'rgba(0, 0, 0, 0.11)');
  ctx.fillStyle = litG;
  ctx.fillRect(mx(0), my(0), PITCH_W * scale, PITCH_H * scale);
  ctx.strokeStyle = COLORS.pitchLine;
  ctx.lineWidth = 1.2;
  strokeRect(0, 0, PITCH_W, PITCH_H);
  line(PITCH_W / 2, 0, PITCH_W / 2, PITCH_H);
  circle(PITCH_W / 2, PITCH_H / 2, 9.15);
  const paW = 16.5, paH = 40.32, gaW = 5.5, gaH = 18.32;
  strokeRect(0, (PITCH_H - paH) / 2, paW, paH);
  strokeRect(PITCH_W - paW, (PITCH_H - paH) / 2, paW, paH);
  strokeRect(0, (PITCH_H - gaH) / 2, gaW, gaH);
  strokeRect(PITCH_W - gaW, (PITCH_H - gaH) / 2, gaW, gaH);
  dot(11, PITCH_H / 2); dot(PITCH_W - 11, PITCH_H / 2);
  const dAng = Math.acos(5.5 / 9.15);
  arc(11, PITCH_H / 2, 9.15, -dAng, dAng);
  arc(PITCH_W - 11, PITCH_H / 2, 9.15, Math.PI - dAng, Math.PI + dAng);
  ctx.strokeStyle = COLORS.pitchAccent;
  ctx.lineWidth = 2.2;
  line(0, (PITCH_H - 7.32) / 2, 0, (PITCH_H + 7.32) / 2);
  line(PITCH_W, (PITCH_H - 7.32) / 2, PITCH_W, (PITCH_H + 7.32) / 2);
  // Subtle radial gradient overlay — broadcast-style spotlight depth.
  const pcx = mx(PITCH_W / 2), pcy = my(PITCH_H / 2);
  const maxR = Math.hypot(PITCH_W * scale, PITCH_H * scale) / 2;
  const spotG = ctx.createRadialGradient(pcx, pcy, maxR * 0.15, pcx, pcy, maxR);
  spotG.addColorStop(0, 'rgba(180, 220, 200, 0.04)');
  spotG.addColorStop(1, 'rgba(0, 0, 0, 0.03)');
  ctx.fillStyle = spotG;
  ctx.fillRect(mx(0), my(0), PITCH_W * scale, PITCH_H * scale);
  // 베벨: 상/좌 하이라이트 + 하/우 그림자로 경기장이 살짝 솟아 보이게.
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.beginPath(); ctx.moveTo(mx(0) + 1, my(PITCH_H) - 1); ctx.lineTo(mx(0) + 1, my(0) + 1); ctx.lineTo(mx(PITCH_W) - 1, my(0) + 1); ctx.stroke();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.beginPath(); ctx.moveTo(mx(PITCH_W) - 1, my(0) + 1); ctx.lineTo(mx(PITCH_W) - 1, my(PITCH_H) - 1); ctx.lineTo(mx(0) + 1, my(PITCH_H) - 1); ctx.stroke();
  ctx.restore();
}

function drawChannelGrid() {
  ctx.strokeStyle = COLORS.channelGrid;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  for (let i = 1; i < CHANNEL_BOUNDS_Y.length - 1; i++) line(0, CHANNEL_BOUNDS_Y[i], PITCH_W, CHANNEL_BOUNDS_Y[i]);
  for (let i = 1; i < THIRD_BOUNDS_X.length - 1; i++) line(THIRD_BOUNDS_X[i], 0, THIRD_BOUNDS_X[i], PITCH_H);
  ctx.setLineDash([]);
  if (!toggles.labels) return;
  ctx.fillStyle = COLORS.channelLabel;
  ctx.font = `600 ${Math.max(10, scale * 1.25)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (let i = 0; i < CHANNEL_LABELS.length; i++) {
    ctx.fillText(CHANNEL_LABELS[i], mx(1.2), my((CHANNEL_BOUNDS_Y[i] + CHANNEL_BOUNDS_Y[i + 1]) / 2) - 7);
  }
  ctx.fillStyle = COLORS.thirdLabel;
  ctx.textAlign = 'center';
  for (let i = 0; i < THIRD_LABELS.length; i++) {
    ctx.fillText(THIRD_LABELS[i], mx((THIRD_BOUNDS_X[i] + THIRD_BOUNDS_X[i + 1]) / 2), my(PITCH_H) + 6);
  }
}

// The next phase objective line, so progress is legible at a glance.
function drawPhaseLine(phase) {
  let x = null, label = null;
  if (phase === 'BUILDUP') { x = PHASE_LINES.PROGRESSION; label = t('pitch.breakLine'); }
  else if (phase === 'PROGRESSION') { x = PHASE_LINES.FINAL_THIRD; label = t('pitch.finalThird'); }
  if (x === null) return;
  ctx.strokeStyle = 'rgba(245, 166, 35, 0.4)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([10, 7]);
  line(x, 0, x, PITCH_H);
  ctx.setLineDash([]);
  if (toggles.labels) {
    ctx.fillStyle = 'rgba(245, 166, 35, 0.75)';
    ctx.font = `${Math.max(9, scale * 1.1)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(label, mx(x), my(0) - 4);
  }
}

// Superiority overlay (toggle): show WHERE we currently out-number / out-
// position them, colour-coded by edge kind. This is the thing the reward
// window points at — made visible so the player reads the edge, not luck.
const EDGE_STYLE = {
  numerical:        { fill: 'rgba(245, 200, 66, 0.13)', ring: 'rgba(245, 200, 66, 0.6)',  ko: '+1', en: '+1' },
  between_lines:    { fill: 'rgba(77, 139, 255, 0.13)', ring: 'rgba(77, 139, 255, 0.6)',  ko: '라인 사이', en: 'Between lines' },
  overload_between: { fill: 'rgba(140, 230, 140, 0.16)', ring: 'rgba(140, 230, 140, 0.7)', ko: '+1 사이', en: '+1 between' },
};
function drawSuperiorityZones(zones) {
  for (const z of zones) {
    const st = EDGE_STYLE[z.kind] ?? EDGE_STYLE.numerical;
    const r = (5 + z.value) * scale;
    const cx = mx(z.x), cy = my(z.y);
    ctx.fillStyle = st.fill;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = st.ring;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (toggles.labels) {
      ctx.fillStyle = st.ring;
      ctx.font = `600 ${Math.max(8.5, scale * 0.95)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(getLang() === 'en' ? st.en : st.ko, cx, cy - r - 2);
    }
  }
}

function drawRewardWindow(w) {
  // Real windows breathe visibly; false windows shimmer slightly weaker —
  // readable to a player who has learned to look closely.
  const strong = w.kind === 'real';
  const breath = 1 + Math.sin(pulse * (strong ? 5 : 9)) * (strong ? 0.10 : 0.04);
  const r = w.r * breath * scale;
  const g = ctx.createRadialGradient(mx(w.x), my(w.y), r * 0.2, mx(w.x), my(w.y), r);
  g.addColorStop(0, strong ? 'rgba(77, 139, 255,0.28)' : 'rgba(77, 139, 255,0.16)');
  g.addColorStop(1, 'rgba(77, 139, 255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(mx(w.x), my(w.y), r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = COLORS.windowEdge;
  ctx.lineWidth = strong ? 1.6 : 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.arc(mx(w.x), my(w.y), r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // Only REAL windows get named — a false window shimmers but stays
  // anonymous, so the bluff is learnable instead of feeling like a coin flip.
  if (toggles.labels && strong) {
    ctx.fillStyle = 'rgba(190, 250, 240, 0.9)';
    ctx.font = `${Math.max(9, scale * 1.0)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(t('pitch.openSpace'), mx(w.x), my(w.y) - r - 3);
  }
}

function drawShotZoneBadge(zone, holder, xg) {
  if (!holder) return;
  // U3: zone QUALITY is part of the read — a low-xG zone shows muted with an
  // honest nudge instead of the hot "shoot now" orange.
  const good = zone.baseXg >= 0.24;
  ctx.fillStyle = good ? 'rgba(245, 166, 35, 0.92)' : 'rgba(168, 178, 190, 0.85)';
  ctx.font = `700 ${Math.max(10, scale * 1.2)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const pct = xg != null ? ` · ${Math.round(xg * 100)}%` : '';
  const zoneWord = getLang() === 'en' ? zone.en : zone.ko;
  const label = good
    ? `${t('pitch.shotZone')}: ${zoneWord}${pct}`
    : `${t('pitch.shotZone')}: ${zoneWord}${pct}${t('pitch.lowProb')}`;
  ctx.fillText(label, mx(holder.rx ?? holder.x), my(holder.ry ?? holder.y) - scale * TOKEN_R_M - 14);
}

function drawCoverShadows(view) {
  const ball = view.ball;
  if (!ball) return;
  for (const d of view.players) {
    if (d.side !== 'opp' || d.line === 'gk') continue;
    const px = d.rx ?? d.x, py = d.ry ?? d.y;
    const dx = px - ball.x, dy = py - ball.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5 || len > 40) continue;
    const ux = dx / len, uy = dy / len;
    const shadowLen = 13;
    const half = 0.24;
    const a = Math.atan2(uy, ux);
    ctx.fillStyle = 'rgba(255, 92, 92, 0.07)';
    ctx.beginPath();
    ctx.moveTo(mx(px), my(py));
    ctx.lineTo(mx(px + Math.cos(a - half) * shadowLen), my(py + Math.sin(a - half) * shadowLen));
    ctx.lineTo(mx(px + Math.cos(a + half) * shadowLen), my(py + Math.sin(a + half) * shadowLen));
    ctx.closePath();
    ctx.fill();
  }
}

const LANE_COLORS = { safe: COLORS.laneSafe, risky: COLORS.laneRisky, cut: COLORS.laneCut, open: COLORS.laneSafe, contested: COLORS.laneRisky, dead: COLORS.laneCut, offside: 'rgba(168, 178, 190, 0.85)' };
// 레인 상태 단어 — 언어 반응형(그리기 시점에 t() 해석). 기존 LANE_KO 맵을 대체.
// 모듈 스코프 헬퍼라 drawHover 내부의 지역 `const t`(좌표 객체) 섀도잉에 영향받지 않는다.
function laneWord(status) { return t('lane.' + status); }
function lobWord() { return t('pitch.lob'); }
function landingWord() { return t('pitch.landing'); }
function pierceWord() { return t('pitch.pierce'); }

// U4: status is double-coded (color + dash pattern) for color-blind players:
// safe = solid, risky = long dash, cut/dead = short dash, offside = dots.
const LANE_DASH = {
  safe: [], open: [],
  risky: [10, 5], contested: [10, 5],
  cut: [3, 4], dead: [3, 4],
  offside: [1.5, 5],
};
function laneLine(from, to, status, dashOffset = 0) {
  ctx.strokeStyle = LANE_COLORS[status] ?? COLORS.laneRisky;
  ctx.lineWidth = 2.2;
  ctx.setLineDash(LANE_DASH[status] ?? [7, 6]);
  ctx.lineDashOffset = -dashOffset;
  arrow(from.x, from.y, to.x, to.y);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

// 공간 패스 — 홀더 기준 범위 그라데이션(멀수록 진한 붉은빛=실패 강조) + 조준점
// (위험도 색) + 가까운 수신자 강조. 패스 능력치는 위험도(risk)로 반영된다.
function drawSpaceAim(hover, h) {
  const cx = mx(h.x), cy = my(h.y);
  const ax = mx(hover.aim.x), ay = my(hover.aim.y);
  // 도달 프로필을 능력치 + 몸 방향으로 — maxR(도달 한계)·safeR(정확 구간)은 포지션,
  // 모양은 향한 방향으로 길쭉한 로브(원이 아님). 향한 쪽 멀리, 등 뒤는 짧다.
  const maxR = (hover.maxR ?? 40) * scale;
  const safeFrac = clamp((hover.safeR ?? 22) / (hover.maxR ?? 40), 0.2, 0.95);
  const facing = hover.facingAngle ?? 0;
  const baseFrac = hover.baseFrac ?? 0.6;
  const lobeR = (a) => maxR * (baseFrac + (1 - baseFrac) * (1 + Math.cos(a - facing)) / 2);
  const lobePath = () => {
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2, r = lobeR(a);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  const grad = ctx.createRadialGradient(cx, cy, 6 * scale, cx, cy, maxR);
  grad.addColorStop(0, 'rgba(77,139,255,0.06)');
  grad.addColorStop(safeFrac * 0.85, 'rgba(77,139,255,0.05)');
  grad.addColorStop(safeFrac, 'rgba(255,194,75,0.10)');
  grad.addColorStop(1, 'rgba(255,90,110,0.22)');
  lobePath(); ctx.fillStyle = grad; ctx.fill();
  // 도달 한계 윤곽(약한 점선) — 향한 방향으로 길쭉한 모양이 보인다.
  ctx.strokeStyle = 'rgba(255,90,110,0.28)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
  lobePath(); ctx.stroke(); ctx.setLineDash([]);
  // 색·라벨은 수신 자세 예측으로 — "이 패스를 주면 어떤 몸으로 받나".
  const REC = {
    free:      { c: '52,214,194', t: t('pitch.rec.free') },
    pressured: { c: '255,194,75', t: t('pitch.rec.pressured') },
    trapped:   { c: '255,90,110', t: t('pitch.rec.trapped') },
  }[hover.reception || 'free'];
  const C = !hover.reachable ? '150,160,170' : REC.c;
  ctx.strokeStyle = `rgba(${C},0.95)`; ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]); ctx.lineDashOffset = -pulse * 22;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  ctx.fillStyle = `rgba(${C},0.18)`;
  ctx.beginPath(); ctx.arc(ax, ay, 5 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(${C},0.95)`; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(ax, ay, 5 * scale, 0, Math.PI * 2); ctx.stroke();
  if (hover.receiver) {
    ctx.strokeStyle = '#ffc24b'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(mx(hover.receiver.x), my(hover.receiver.y), 2.4 * scale, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = `rgba(${C},1)`;
  ctx.font = `600 ${Math.max(9.5, scale * 1.05)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(!hover.reachable ? t('pitch.unreachable') : REC.t + (hover.lofted ? lobWord() : ''), ax, ay - 7 * scale);
}

function laneTag(text, p, status) {
  ctx.fillStyle = LANE_COLORS[status] ?? COLORS.laneRisky;
  ctx.font = `600 ${Math.max(9.5, scale * 1.05)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(text, mx(p.x), my(p.y) - 6);
}

// ─── pass-option rings (발밑 패스 무장 시) ──────────────────────────────────
// Draws a colored halo around each valid pass target before the player clicks.
// Green = safe (<0.30), yellow = caution (0.30-0.58), red = risky (>0.58).
function drawPassOptions(opts, players) {
  const byId = new Map(players.map(p => [p.id, p]));
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 2.4;
  for (const o of opts) {
    const p = byId.get(o.targetId);
    if (!p) continue;
    const cx = mx(p.rx ?? p.x), cy = my(p.ry ?? p.y);
    const r = scale * TOKEN_R_M + 9;
    let color, alpha;
    if (o.risk < 0.30)      { color = '#5dd6c5'; alpha = 0.88; }
    else if (o.risk < 0.58) { color = '#f5c842'; alpha = 0.68; }
    else                    { color = '#e35d5d'; alpha = 0.38; }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── run destinations (런 무장 시) ──────────────────────────────────────────
// Off-ball run destinations — thick energetic arrows so runs read as
// purposeful MOVEMENT, not pass lanes. Each arrow: solid stem → filled
// arrowhead → pulsing destination ring. Color: orange-amber (#f5a623)
// so runs are visually distinct from teal pass/space overlays.
function drawRunDestinations(dests, players) {
  const byId = new Map(players.map(p => [p.id, p]));
  // Reuse arrow marker defined once per frame.
  for (const d of dests) {
    const p = byId.get(d.targetId);
    if (!p || !d.zone) continue;
    const fx = mx(d.from.x), fy = my(d.from.y);
    const tx = mx(d.zone.x), ty = my(d.zone.y);
    const len = Math.hypot(tx - fx, ty - fy);
    if (len < scale * 3) continue;

    const angle = Math.atan2(ty - fy, tx - fx);
    const headLen = Math.min(14, len * 0.35);
    // Stem ends slightly before tip so arrowhead sits cleanly.
    const sx = tx - Math.cos(angle) * headLen * 0.9;
    const sy = ty - Math.sin(angle) * headLen * 0.9;

    ctx.save();

    // — Stem: solid thick line —
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(sx, sy);
    ctx.stroke();

    // — Arrowhead: filled triangle —
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(
      tx - Math.cos(angle - Math.PI / 7) * headLen,
      ty - Math.sin(angle - Math.PI / 7) * headLen,
    );
    ctx.lineTo(
      tx - Math.cos(angle + Math.PI / 7) * headLen,
      ty - Math.sin(angle + Math.PI / 7) * headLen,
    );
    ctx.closePath();
    ctx.fill();

    // — Destination ring: pulsing circle —
    const ringR = scale * 3.2 + Math.sin(pulse * 4) * 1.2;
    ctx.globalAlpha = 0.45 + Math.sin(pulse * 4) * 0.15;
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(tx, ty, ringR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}

function drawHover(hover, holder) {
  if (!holder) return;
  const h = { x: holder.rx ?? holder.x, y: holder.ry ?? holder.y };
  const off = pulse * 22;
  if (hover.kind === 'carryPath') {
    laneLine(h, hover.to, hover.status, off);
    laneTag(`${t('pitch.carry')} (${laneWord(hover.status)})`, hover.to, hover.status);
    return;
  }
  if (hover.kind === 'spaceAim') {
    drawSpaceAim(hover, h);
    return;
  }
  const p = hover.preview;
  if (!p) return;
  // QA Major 1: trapped-on-arrival risk is part of the read — tag it.
  // 이 화살표들은 drawHover 본문 스코프에서 정의되므로 t는 모듈 import를 가리킨다
  // (아래 블록의 지역 `const t` 좌표 섀도잉은 정의 시점 스코프 체인에 없음).
  const trapKo = (ev) => (ev?.trap > 0.2 ? t('pitch.trapWarn') : '');
  // 수신 자세 — 공간 패스와 같은 어휘. 자유는 표기 생략(클러터 방지).
  const recKo = (r) => (r === 'trapped' ? t('pitch.recTrappedShort') : r === 'pressured' ? t('pitch.recPressuredShort') : '');
  if (p.kind === 'lane') {
    const t = { x: p.target.rx ?? p.target.x, y: p.target.ry ?? p.target.y };
    laneLine(h, t, p.lane.status, off);
    laneTag(laneWord(p.lane.status) + (p.lane.lofted ? lobWord() : '') + recKo(p.reception), { x: (h.x + t.x) / 2, y: (h.y + t.y) / 2 }, p.lane.status);
  } else if (p.kind === 'space') {
    laneLine(h, p.zone, p.lane.status, off);
    ctx.strokeStyle = LANE_COLORS[p.landing.status];
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(mx(p.zone.x), my(p.zone.y), p.zone.r * scale, 0, Math.PI * 2); ctx.stroke();
    // Runner path.
    const t = { x: p.target.rx ?? p.target.x, y: p.target.ry ?? p.target.y };
    line(t.x, t.y, p.zone.x, p.zone.y);
    ctx.setLineDash([]);
    laneTag(`${landingWord()} ${laneWord(p.landing.status)}${trapKo(p.landing)}`, p.zone, p.landing.status);
  } else if (p.kind === 'run') {
    // Off-ball run: runner path + landing read, no ball lane.
    const t = { x: p.target.rx ?? p.target.x, y: p.target.ry ?? p.target.y };
    ctx.strokeStyle = LANE_COLORS[p.landing.status];
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 5]);
    arrow(t.x, t.y, p.zone.x, p.zone.y);
    ctx.beginPath(); ctx.arc(mx(p.zone.x), my(p.zone.y), p.zone.r * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    laneTag(`${pierceWord()} ${laneWord(p.landing.status)}`, p.zone, p.landing.status);
  } else if (p.kind === 'chain') {
    const t = { x: p.target.rx ?? p.target.x, y: p.target.ry ?? p.target.y };
    laneLine(h, t, p.leg1.status, off);
    laneTag(`1 ${laneWord(p.leg1.status)}`, { x: (h.x + t.x) / 2, y: (h.y + t.y) / 2 }, p.leg1.status);
    if (p.third && p.leg2) {
      const th = { x: p.third.rx ?? p.third.x, y: p.third.ry ?? p.third.y };
      laneLine(t, th, p.leg2.status, off);
      laneTag(`2 ${laneWord(p.leg2.status)}${trapKo(p.leg2)} → ${p.third.label}`, { x: (t.x + th.x) / 2, y: (t.y + th.y) / 2 }, p.leg2.status);
    }
  }
}

// 키보드로 선택된 동료에 포커스 링 — 마우스 hover와 동등한 시각 표시.
function drawKbFocus(view) {
  const p = view.players.find((q) => q.id === view.keyboardTargetId);
  if (!p) return;
  const cx = mx(p.rx ?? p.x), cy = my(p.ry ?? p.y);
  const r = scale * TOKEN_R_M + 6 + Math.sin(pulse * 4) * 1.8;
  ctx.save();
  ctx.strokeStyle = '#5dd6c5';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawPlayers(players, holderId, pressureExpr) {
  // Opponents under our tokens.
  for (const p of players) if (p.side === 'opp') drawToken(p, false, pressureExpr);
  for (const p of players) if (p.side === 'us') drawToken(p, p.id === holderId, pressureExpr);
}

function drawToken(p, isHolder, pressureExpr) {
  const r = scale * TOKEN_R_M;
  const cx = mx(p.rx ?? p.x), cy = my(p.ry ?? p.y);
  const us = p.side === 'us';
  // 유사 3D: 지면 캐스트 그림자(아래로 오프셋된 부드러운 타원) → 토큰이 떠 보이게.
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.32)';
  ctx.shadowBlur = 3;
  ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.62, r * 0.92, r * 0.40, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 베이스 디스크(평면 색) + 소유자 글로우.
  ctx.save();
  if (isHolder) { ctx.shadowColor = us ? 'rgba(77, 139, 255, 0.6)' : 'rgba(255, 92, 92, 0.55)'; ctx.shadowBlur = 11; }
  ctx.fillStyle = us ? (usColor || COLORS.us) : COLORS.opp;
  ctx.strokeStyle = us ? (usColor ? shadeHex(usColor, -0.45) : COLORS.usStroke) : COLORS.oppStroke;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
  // 구체 음영: 좌상 하이라이트 → 우하 그림자(디스크에 클립).
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  const sphereG = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.1, cx, cy, r * 1.2);
  sphereG.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  sphereG.addColorStop(0.45, 'rgba(255, 255, 255, 0.06)');
  sphereG.addColorStop(1, 'rgba(0, 0, 0, 0.34)');
  ctx.fillStyle = sphereG;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  if (p.committedTurns > 0) {
    ctx.strokeStyle = 'rgba(255, 92, 92, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.stroke();
  }

  if (isHolder) {
    // Pressure embodied: the ring around the holder tightens and quickens.
    const ringLevel = pressureExpr?.ring ?? 0;
    const speed = 2 + ringLevel * 6;
    const breath = Math.sin(pulse * speed) * (1.5 + ringLevel * 2);
    const rr = r + 5 + (1 - ringLevel) * 4 + breath;
    ctx.strokeStyle = ringLevel > 0.65 ? 'rgba(255, 92, 92, 0.9)' : ringLevel > 0.3 ? 'rgba(245, 166, 35, 0.85)' : 'rgba(77, 139, 255, 0.8)';
    ctx.lineWidth = 1.6 + ringLevel;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
  }

  if (!toggles.labels) return;
  // 가독성 패스(2026-07): 번호는 굵게, 역할 태그는 고대비+어두운 그림자 — 이전엔
  // 7.5px 반투명 텍스트가 잔디에 묻혀 판독 불가였다.
  ctx.fillStyle = us ? COLORS.usText : COLORS.oppText;
  ctx.font = `700 ${Math.max(10, r * 0.95).toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(p.num), cx, cy + 0.5);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 3;
  ctx.fillStyle = us ? COLORS.usTag : COLORS.oppTag;
  const tagPx = Math.max(9, r * 0.6);
  ctx.font = `700 ${tagPx.toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(p.label, cx, cy + r + tagPx + 1);
  ctx.restore();
}

// 클래식 축구공 패널(검정 오각형) — 가운데 + 림 힌트. 공 원에 클립된 채 호출.
// spin: 누적 회전(라디안) — 패스/운반 이동량에 비례해 굴러가게 한다.
let ballSpin = 0;        // 누적 공 회전
let ballPrevLog = null;  // 직전 프레임의 논리 공 위치(px)
let ballTrail = [];      // 패스 궤적 잔상(최근 위치들)
function drawFootballPanels(bx, by, r, spin = 0) {
  ctx.save();
  ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.clip();
  const ink = 'rgba(24, 26, 30, 0.92)';
  const pent = (cx2, cy2, rad, rot) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + i * 2 * Math.PI / 5 - Math.PI / 2;
      const px = cx2 + Math.cos(a) * rad, py = cy2 + Math.sin(a) * rad;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  };
  const rot = -0.32 + spin;
  ctx.fillStyle = ink;
  ctx.strokeStyle = 'rgba(24, 26, 30, 0.5)';
  ctx.lineWidth = Math.max(0.6, r * 0.085);
  pent(bx, by, r * 0.40, rot); ctx.fill();           // 중앙 오각형
  for (let i = 0; i < 5; i++) {                        // 림으로 향하는 솔기 + 외곽 패널 힌트
    const a = rot + i * 2 * Math.PI / 5 - Math.PI / 2;
    const v1x = bx + Math.cos(a) * r * 0.40, v1y = by + Math.sin(a) * r * 0.40;
    const v2x = bx + Math.cos(a) * r * 1.02, v2y = by + Math.sin(a) * r * 1.02;
    ctx.beginPath(); ctx.moveTo(v1x, v1y); ctx.lineTo(v2x, v2y); ctx.stroke();
    pent(v2x, v2y, r * 0.30, a + Math.PI); ctx.fill();
  }
  ctx.restore();
}

function drawBall(ball) {
  if (!ball) return;
  // 위치: 소유 중(비행 아님)이면 토큰 밑에 깔리지 않게 발 앞(공격 방향 +x)으로 오프셋 →
  // 공이 늘 보이고, 받는 자리/패스 각도가 선명해진다.
  let px = ball.x, py = ball.y;
  if (!ball.flying) px = clamp(ball.x + TOKEN_R_M * 1.25, 0.6, PITCH_W - 0.6);
  let r = Math.max(4.5, scale * 0.62);   // 키움 (0.45 → 0.62)
  let yPitch = py;
  if (ball.lofted && ball.flying) {
    const arcT = Math.sin((ball.flightT ?? 0) * Math.PI);
    yPitch = py - arcT * 6;
    r *= 1 + arcT * 0.7;
  }
  const bx = mx(px), by = my(yPitch);
  // 패스 궤적 잔상: 비행 중 최근 위치를 페이드로. 정지하면 비운다.
  if (ball.flying) {
    ballTrail.push({ x: bx, y: by });
    if (ballTrail.length > 9) ballTrail.shift();
  } else if (ballTrail.length) {
    ballTrail.length = 0;
  }
  for (let i = 0; i < ballTrail.length - 1; i++) {
    const tp = ballTrail[i], f = (i + 1) / ballTrail.length;
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.32 * f).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(tp.x, tp.y, r * (0.35 + 0.5 * f), 0, Math.PI * 2); ctx.fill();
  }
  // 지면 그림자: 항상 지면(py)에 — 로빙볼이 떠올라도 그림자는 바닥에 남는다.
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath(); ctx.ellipse(mx(px), my(py) + r * 0.5, r * 0.9, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 흰 공 본체 + 접지 그림자.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 5; ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#f5f6f4';
  ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 회전: 논리 위치 이동량에 비례해 패널을 굴림(빠른 패스=빠른 스핀, 정지 시 멈춤).
  const logX = mx(ball.x), logY = my(ball.y);
  if (ballPrevLog) {
    const d = Math.hypot(logX - ballPrevLog.x, logY - ballPrevLog.y);
    if (d > 0.1 && d < r * 6) ballSpin += (d / r) * 0.9 * (Math.sign(logX - ballPrevLog.x) || 1);
    // 긴 세션에서 무한 누적 시 sin/cos 부동소수 정밀도 손실 — 2π로 래핑.
    ballSpin %= (Math.PI * 2);
  }
  ballPrevLog = { x: logX, y: logY };
  // 축구공 패널.
  drawFootballPanels(bx, by, r, ballSpin);
  // 구체 음영(클립): 좌상 하이라이트 → 우하 그림자.
  ctx.save();
  ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.clip();
  const ballG = ctx.createRadialGradient(bx - r * 0.34, by - r * 0.40, r * 0.05, bx, by, r * 1.25);
  ballG.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  ballG.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  ballG.addColorStop(1, 'rgba(0, 0, 0, 0.34)');
  ctx.fillStyle = ballG;
  ctx.fillRect(bx - r, by - r, r * 2, r * 2);
  ctx.restore();
  ctx.strokeStyle = 'rgba(40, 44, 40, 0.5)'; ctx.lineWidth = Math.max(0.8, r * 0.08);
  ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
}

function drawVignette(pressureExpr) {
  const v = pressureExpr?.vignette ?? 0;
  if (v <= 0.01) return;
  const g = ctx.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.35, viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.7);
  g.addColorStop(0, 'rgba(120, 20, 20, 0)');
  g.addColorStop(1, `rgba(120, 20, 20, ${v})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, viewH);
}

function drawShout(pressureExpr, holder) {
  if (!pressureExpr?.shout || !holder) return;
  const jitter = Math.sin(pulse * 30) * 1.5;
  ctx.fillStyle = 'rgba(255, 120, 100, 0.95)';
  ctx.font = `800 ${Math.max(12, scale * 1.6)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(pressureExpr.shout, mx(holder.rx ?? holder.x) + jitter, my(holder.ry ?? holder.y) - scale * TOKEN_R_M - 4);
}

function drawCue(cue, tone) {
  if (!cue) return;
  ctx.font = '12.5px ui-sans-serif, system-ui, sans-serif';
  const pad = 12;
  const width = Math.min(viewW - 40, ctx.measureText(cue).width + pad * 2);
  const x = (viewW - width) / 2, y = 10;
  // Slight backdrop gradient for depth.
  const cueGrad = ctx.createLinearGradient(x, y, x, y + 28);
  cueGrad.addColorStop(0, 'rgba(12, 18, 28, 0.90)');
  cueGrad.addColorStop(1, 'rgba(6, 10, 16, 0.82)');
  ctx.fillStyle = cueGrad;
  roundRect(x, y, width, 28, 6); ctx.fill();
  // Subtle border for better definition.
  const borderColor = tone === 'error' ? 'rgba(255, 157, 157, 0.35)' : tone === 'success' ? 'rgba(141, 240, 226, 0.35)' : tone === 'warn' ? 'rgba(255, 210, 138, 0.35)' : 'rgba(200, 210, 220, 0.18)';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  roundRect(x, y, width, 28, 6); ctx.stroke();
  ctx.fillStyle = tone === 'error' ? '#ff9d9d' : tone === 'success' ? '#8df0e2' : tone === 'warn' ? '#ffd28a' : 'rgba(230, 237, 243, 0.92)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(cue, viewW / 2, y + 14);
}

// ─── primitives ──────────────────────────────────────────────────────────────
function strokeRect(x, y, w, h) { ctx.strokeRect(mx(x), my(y), w * scale, h * scale); }
function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(mx(x1), my(y1)); ctx.lineTo(mx(x2), my(y2)); ctx.stroke(); }
function circle(x, y, r) { ctx.beginPath(); ctx.arc(mx(x), my(y), r * scale, 0, Math.PI * 2); ctx.stroke(); }
function arc(x, y, r, a0, a1) { ctx.beginPath(); ctx.arc(mx(x), my(y), r * scale, a0, a1); ctx.stroke(); }
function dot(x, y) {
  ctx.beginPath(); ctx.arc(mx(x), my(y), 0.35 * scale, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.pitchLine; ctx.fill();
}
function arrow(x1, y1, x2, y2) {
  line(x1, y1, x2, y2);
  const angle = Math.atan2(my(y2) - my(y1), mx(x2) - mx(x1));
  const head = Math.max(6, scale * 1.2);
  ctx.beginPath();
  ctx.moveTo(mx(x2), my(y2));
  ctx.lineTo(mx(x2) - head * Math.cos(angle - Math.PI / 6), my(y2) - head * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(mx(x2), my(y2));
  ctx.lineTo(mx(x2) - head * Math.cos(angle + Math.PI / 6), my(y2) - head * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
}
