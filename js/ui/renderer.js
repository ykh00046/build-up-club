// Canvas renderer — 3D 투영 기반(2026-07-08 전환). 브로드캐스트 시점 원근 카메라를
// 모든 세계 좌표가 통과한다(camera.js). 게임 로직·밸런스는 평면 그대로, 표현만 3D:
// 기울어진 피치, 깊이 스케일(가까울수록 큼), 높이 있는 골대, 로빙볼의 실제 z 궤적,
// 깊이 정렬 토큰. 다크 피치·체화된 압박 큐(홀더 링·비네트·GK 샤우트)는 유지.

import {
  PITCH_W, PITCH_H, CHANNEL_BOUNDS_Y, THIRD_BOUNDS_X, CHANNEL_LABELS, THIRD_LABELS,
  COLORS, TOKEN_R_M, PHASE_LINES, clamp,
} from '../data/pitch.js';
import { prefersReducedMotion } from '../util/motion.js';
import { t, getLang } from '../career/i18n.js';
import { setupCamera, proj, unprojGround, groundScale } from './camera.js';

let canvas, ctx, dpr = 1, viewW = 0, viewH = 0, gs = 6;   // gs = 피치 중심 스케일(px/m)
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
  setupCamera(viewW, viewH);
  gs = groundScale();
}

// 세계 → 화면. P(x,y[,z]) = {x, y, s}. 원근이라 mx/my 분리형은 폐기.
const P = (wx, wy, wz = 0) => proj(wx, wy, wz);

// Inverse mapping for input handling — 지면(z=0) 역투영.
export function toPitch(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return unprojGround(clientX - rect.left, clientY - rect.top);
}

// 투영 피치 코너(자주 씀) — [TL, TR, BR, BL] (세계 y=0이 화면 위/멀리).
function pitchCorners() {
  return [P(0, 0), P(PITCH_W, 0), P(PITCH_W, PITCH_H), P(0, PITCH_H)];
}
function quadPath(a, b, c, d) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.closePath();
}
// 세계 지면 원 → 투영 폴리라인 경로(원근에서 원은 타원).
function circlePath(wx, wy, r, segs = 30) {
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const q = P(wx + Math.cos(a) * r, wy + Math.sin(a) * r);
    i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
  }
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
  if (view.defenseRoute) drawDefenseRoute(view.defenseRoute);
  if (view.baitArmed) drawBaitArmed(view.baitArmed);
  if (view.shotZone) drawShotZoneBadge(view.shotZone, view.holder, view.shotXg);
  if (toggles.shadows) drawCoverShadows(view);
  if (view.hover) drawHover(view.hover, view.holder);
  if (view.passOptions?.length) drawPassOptions(view.passOptions, view.players);
  if (view.runDestinations?.length) drawRunDestinations(view.runDestinations, view.players);
  drawPlayers(view.players, view.holderId, view.pressureExpr, view.presserId);
  if (view.keyboardTargetId) drawKbFocus(view);
  drawBall(view.ball);
  drawActionRing(view);
  drawVignette(view.pressureExpr);
  drawFreezeFlash(view.freezeFlash);
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
  const q = P(h.rx ?? h.x, h.ry ?? h.y);
  const cx = q.x, cy = q.y;
  const ringR = q.s * TOKEN_R_M + 44;

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
  const key = `${viewW}x${viewH}`;
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
  // 투영 피치의 화면 bbox — 관중은 그 바깥 여백을 채운다(원근이라 위 여백이 넓다 =
  // 먼 스탠드가 크게 보이는 실제 중계 화면 느낌).
  const cs = pitchCorners();
  const px0 = Math.min(...cs.map((q) => q.x)), px1 = Math.max(...cs.map((q) => q.x));
  const py0 = Math.min(...cs.map((q) => q.y)), py1 = Math.max(...cs.map((q) => q.y));
  const place = (x0, y0, x1, y1) => {
    const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const n = Math.min(1400, Math.floor(area / 22));
    for (let i = 0; i < n; i++) {
      c.fillStyle = cols[(rnd() * cols.length) | 0];
      c.globalAlpha = 0.35 + rnd() * 0.4;
      c.fillRect(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), 1.5, 1.5);
    }
  };
  place(0, 0, viewW, py0 - 7);                 // 상단(먼 스탠드)
  place(0, py1 + 7, viewW, viewH);             // 하단(근접 스탠드)
  place(0, py0 - 7, px0 - 7, py1 + 7);         // 좌
  place(px1 + 7, py0 - 7, viewW, py1 + 7);     // 우
}

function drawStadium() {
  const sg = ctx.createLinearGradient(0, 0, 0, viewH);
  sg.addColorStop(0, '#0c131b'); sg.addColorStop(1, '#070b10');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, viewW, viewH);
  buildCrowd();
  if (crowdCanvas) { ctx.globalAlpha = 1; ctx.drawImage(crowdCanvas, 0, 0, viewW, viewH); }
  // 스탠드 벽 — 투영 피치를 감싸는 트라페조이드 띠(피치는 이후 drawPitch가 덮는다).
  const [tl, tr, br, bl] = pitchCorners();
  const out = 11;
  ctx.fillStyle = '#10171f';
  quadPath(
    { x: tl.x - out, y: tl.y - out }, { x: tr.x + out, y: tr.y - out },
    { x: br.x + out, y: br.y + out }, { x: bl.x - out, y: bl.y + out },
  );
  ctx.fill();
  // 플러드라이트 코너 글로우.
  const glow = (q) => {
    const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, Math.max(viewW, viewH) * 0.32);
    g.addColorStop(0, 'rgba(200, 225, 255, 0.09)'); g.addColorStop(1, 'rgba(200, 225, 255, 0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, viewW, viewH);
  };
  glow(tl); glow(tr); glow(bl); glow(br);
}

// 골대 — 진짜 높이(크로스바 2.44m)를 가진 3D 프레임 + 뒤로 처지는 네트.
function drawGoalsAndFlags() {
  const gy0 = (PITCH_H - 7.32) / 2, gy1 = (PITCH_H + 7.32) / 2;
  const BAR = 2.44, depth = 1.9;
  for (const side of [0, 1]) {
    const gx = side === 0 ? 0 : PITCH_W;
    const dir = side === 0 ? -1 : 1;
    const bx = gx + dir * depth;             // 네트 뒤 지점
    const p0 = P(gx, gy0, 0), p1 = P(gx, gy1, 0);
    const t0 = P(gx, gy0, BAR), t1 = P(gx, gy1, BAR);
    const b0 = P(bx, gy0, 0), b1 = P(bx, gy1, 0);
    const n0 = P(bx, gy0, BAR * 0.45), n1 = P(bx, gy1, BAR * 0.45);   // 네트 상단(처짐)
    // 네트 면(옆+뒤) — 옅은 채움.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    quadPath(t0, t1, n1, n0); ctx.fill();
    quadPath(n0, n1, b1, b0); ctx.fill();
    // 네트 격자.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)'; ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const yy = gy0 + (gy1 - gy0) * (i / 10);
      const a = P(gx, yy, BAR), b = P(bx, yy, BAR * 0.45), c = P(bx, yy, 0);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y);
    }
    for (const zz of [0.6, 1.2, 1.8]) {
      const a = P(bx, gy0, zz * 0.45), b = P(bx, gy1, zz * 0.45);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    // 프레임: 포스트 2 + 크로스바(흰색, 도톰).
    ctx.strokeStyle = '#eef3f5'; ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(t0.x, t0.y);
    ctx.lineTo(t1.x, t1.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  // 코너 깃발(살짝 세운 3D 기둥 + 깃발).
  for (const [cxp, cyp] of [[0, 0], [PITCH_W, 0], [0, PITCH_H], [PITCH_W, PITCH_H]]) {
    const base = P(cxp, cyp, 0), top = P(cxp, cyp, 1.5);
    const dirx = cxp === 0 ? 1 : -1;
    ctx.strokeStyle = 'rgba(230, 235, 238, 0.85)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x + dirx * 5, top.y + 2);
    ctx.lineTo(top.x, top.y + 4);
    ctx.closePath(); ctx.fill();
  }
}

function drawPitch() {
  const [tl, tr, br, bl] = pitchCorners();
  // 잔디 본체(투영 사다리꼴).
  ctx.fillStyle = COLORS.pitch;
  quadPath(tl, tr, br, bl); ctx.fill();
  // 잔디 깎기 스트라이프(세로 밴드) — 각 밴드를 투영 사변형으로.
  const STRIPES = 12;
  const bw = PITCH_W / STRIPES;
  for (let i = 0; i < STRIPES; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.045)' : 'rgba(0, 0, 0, 0.055)';
    quadPath(P(i * bw, 0), P((i + 1) * bw, 0), P((i + 1) * bw, PITCH_H), P(i * bw, PITCH_H));
    ctx.fill();
  }
  // 방향 조명(멀리 밝게 → 가까이 어둡게) — 원근 깊이 강조.
  const topY = Math.min(tl.y, tr.y), botY = Math.max(bl.y, br.y);
  const litG = ctx.createLinearGradient(0, topY, 0, botY);
  litG.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
  litG.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  litG.addColorStop(1, 'rgba(0, 0, 0, 0.11)');
  ctx.fillStyle = litG;
  quadPath(tl, tr, br, bl); ctx.fill();
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
  const pc = P(PITCH_W / 2, PITCH_H / 2);
  const maxR = Math.max(br.x - tl.x, br.y - tl.y) / 1.6;
  const spotG = ctx.createRadialGradient(pc.x, pc.y, maxR * 0.15, pc.x, pc.y, maxR);
  spotG.addColorStop(0, 'rgba(180, 220, 200, 0.04)');
  spotG.addColorStop(1, 'rgba(0, 0, 0, 0.03)');
  ctx.fillStyle = spotG;
  quadPath(tl, tr, br, bl); ctx.fill();
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
  ctx.font = `600 ${Math.max(10, gs * 1.25)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (let i = 0; i < CHANNEL_LABELS.length; i++) {
    const q = P(1.2, (CHANNEL_BOUNDS_Y[i] + CHANNEL_BOUNDS_Y[i + 1]) / 2);
    ctx.fillText(CHANNEL_LABELS[i], q.x, q.y - 7);
  }
  ctx.fillStyle = COLORS.thirdLabel;
  ctx.textAlign = 'center';
  for (let i = 0; i < THIRD_LABELS.length; i++) {
    const q = P((THIRD_BOUNDS_X[i] + THIRD_BOUNDS_X[i + 1]) / 2, PITCH_H);
    ctx.fillText(THIRD_LABELS[i], q.x, q.y + 6);
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
    const q = P(x, 0);
    ctx.fillStyle = 'rgba(245, 166, 35, 0.75)';
    ctx.font = `${Math.max(9, gs * 1.1)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(label, q.x, q.y - 4);
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
    const rW = 5 + z.value;                       // 세계 반경(m)
    const q = P(z.x, z.y);
    ctx.fillStyle = st.fill;
    circlePath(z.x, z.y, rW); ctx.fill();
    ctx.strokeStyle = st.ring;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    circlePath(z.x, z.y, rW); ctx.stroke();
    ctx.setLineDash([]);
    if (toggles.labels) {
      ctx.fillStyle = st.ring;
      ctx.font = `600 ${Math.max(8.5, gs * 0.95)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(getLang() === 'en' ? st.en : st.ko, q.x, q.y - rW * q.s - 2);
    }
  }
}

function drawRewardWindow(w) {
  // Real windows breathe visibly; false windows shimmer slightly weaker —
  // readable to a player who has learned to look closely.
  const strong = w.kind === 'real';
  const breath = 1 + Math.sin(pulse * (strong ? 5 : 9)) * (strong ? 0.10 : 0.04);
  const rW = w.r * breath;                      // 세계 반경
  const q = P(w.x, w.y);
  const rPx = rW * q.s;
  const g = ctx.createRadialGradient(q.x, q.y, rPx * 0.2, q.x, q.y, rPx);
  g.addColorStop(0, strong ? 'rgba(77, 139, 255,0.28)' : 'rgba(77, 139, 255,0.16)');
  g.addColorStop(1, 'rgba(77, 139, 255,0)');
  ctx.fillStyle = g;
  circlePath(w.x, w.y, rW); ctx.fill();
  ctx.strokeStyle = COLORS.windowEdge;
  ctx.lineWidth = strong ? 1.6 : 1;
  ctx.setLineDash([6, 6]);
  circlePath(w.x, w.y, rW); ctx.stroke();
  ctx.setLineDash([]);
  // Only REAL windows get named — a false window shimmers but stays
  // anonymous, so the bluff is learnable instead of feeling like a coin flip.
  if (toggles.labels && strong) {
    ctx.fillStyle = 'rgba(190, 250, 240, 0.9)';
    ctx.font = `${Math.max(9, gs * 1.0)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(t('pitch.openSpace'), q.x, q.y - rPx - 3);
  }
}

// 예상 루트 인텔 — 수비 결정 중 상대 전개 예측을 피치에 그린다. 인텔 텍스트
// ("예상 전개: ST 방향" / "종잡을 수 없는 상대")의 시각 쌍. 상대 위협이므로
// 적색(laneCut) 계열, 행진 점선으로 "곧 갈 길"을 표현.
function drawDefenseRoute(route) {
  const f = P(route.from.x, route.from.y);
  const march = -pulse * 24;   // 점선이 캐리어→타깃으로 흐른다(전개 방향감)
  if (route.confident) {
    const tq = P(route.to.x, route.to.y);
    const ang = Math.atan2(tq.y - f.y, tq.x - f.x);
    const r0 = f.s * TOKEN_R_M + 4;      // 캐리어 토큰 밖에서 시작
    const sx = f.x + Math.cos(ang) * r0, sy = f.y + Math.sin(ang) * r0;
    const ex = tq.x - Math.cos(ang) * (tq.s * TOKEN_R_M + 3), ey = tq.y - Math.sin(ang) * (tq.s * TOKEN_R_M + 3);
    ctx.strokeStyle = 'rgba(255, 92, 92, 0.78)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]); ctx.lineDashOffset = march;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // 화살촉
    const ah = 8;
    ctx.fillStyle = 'rgba(255, 92, 92, 0.9)';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - 0.42) * ah, ey - Math.sin(ang - 0.42) * ah);
    ctx.lineTo(ex - Math.cos(ang + 0.42) * ah, ey - Math.sin(ang + 0.42) * ah);
    ctx.closePath(); ctx.fill();
    // 예상 수신자 타깃 링(맥동)
    const rr = (tq.s * TOKEN_R_M + 6) * (1 + Math.sin(pulse * 5) * 0.12);
    ctx.strokeStyle = 'rgba(255, 92, 92, 0.55)';
    ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]); ctx.lineDashOffset = march;
    ctx.beginPath(); ctx.arc(tq.x, tq.y, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  } else {
    // 종잡을 수 없음 — 전방(상대 공격 방향 -x)으로 부채꼴 확산 점선.
    const fanLen = f.s * 12;
    ctx.strokeStyle = 'rgba(245, 166, 35, 0.45)';   // 앰버(불확실)
    ctx.lineWidth = 1.5; ctx.setLineDash([5, 7]); ctx.lineDashOffset = march;
    for (const spread of [-0.5, -0.17, 0.17, 0.5]) {
      const ang = Math.PI + spread;   // -x 기준 부채꼴
      const r0 = f.s * TOKEN_R_M + 4;
      ctx.beginPath();
      ctx.moveTo(f.x + Math.cos(ang) * r0, f.y + Math.sin(ang) * r0);
      ctx.lineTo(f.x + Math.cos(ang) * fanLen, f.y + Math.sin(ang) * fanLen);
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
}

// 유인 창 시각화(Phase 2) — 유인 성공 시 뒷공간 드롭 지점 + 릴리스 경로를 그려
// "여기로 릴리스(E)"를 읽게 한다. 리시버 드롭(녹색 타깃 링) + 릴리서→드롭 경로.
function drawBaitArmed(b) {
  const d = P(b.drop.x, b.drop.y);
  const march = -pulse * 24;
  // 드롭 타깃 링(맥동, 녹색=열린 뒷공간).
  const rr = (d.s * TOKEN_R_M + 8) * (1 + Math.sin(pulse * 5) * 0.14);
  ctx.strokeStyle = 'rgba(93, 214, 197, 0.85)';
  ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.lineDashOffset = march;
  ctx.beginPath(); ctx.arc(d.x, d.y, rr, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  // 릴리서→드롭 경로(3자 릴레이) — 녹색 점선.
  if (b.releaser) {
    const rq = P(b.releaser.x, b.releaser.y);
    ctx.strokeStyle = 'rgba(93, 214, 197, 0.6)';
    ctx.lineWidth = 1.6; ctx.setLineDash([6, 5]); ctx.lineDashOffset = march;
    ctx.beginPath(); ctx.moveTo(rq.x, rq.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
  // 라벨 "릴리스 E".
  ctx.fillStyle = 'rgba(190, 250, 240, 0.95)';
  ctx.font = `600 ${Math.max(10, gs * 1.1)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('릴리스 ▸ E', d.x, d.y - rr - 4);
}

function drawShotZoneBadge(zone, holder, xg) {
  if (!holder) return;
  // U3: zone QUALITY is part of the read — a low-xG zone shows muted with an
  // honest nudge instead of the hot "shoot now" orange.
  const good = zone.baseXg >= 0.24;
  const q = P(holder.rx ?? holder.x, holder.ry ?? holder.y);
  ctx.fillStyle = good ? 'rgba(245, 166, 35, 0.92)' : 'rgba(168, 178, 190, 0.85)';
  ctx.font = `700 ${Math.max(10, gs * 1.2)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const pct = xg != null ? ` · ${Math.round(xg * 100)}%` : '';
  const zoneWord = getLang() === 'en' ? zone.en : zone.ko;
  const label = good
    ? `${t('pitch.shotZone')}: ${zoneWord}${pct}`
    : `${t('pitch.shotZone')}: ${zoneWord}${pct}${t('pitch.lowProb')}`;
  ctx.fillText(label, q.x, q.y - q.s * TOKEN_R_M - 14);
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
    const q0 = P(px, py);
    const q1 = P(px + Math.cos(a - half) * shadowLen, py + Math.sin(a - half) * shadowLen);
    const q2 = P(px + Math.cos(a + half) * shadowLen, py + Math.sin(a + half) * shadowLen);
    ctx.fillStyle = 'rgba(255, 92, 92, 0.07)';
    ctx.beginPath();
    ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y);
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

// 공간 패스 — 홀더 기준 범위 로브(세계 좌표 샘플 → 투영: 원근에서도 정확한 모양)
// + 조준점(위험도 색) + 가까운 수신자 강조. 패스 능력치는 위험도(risk)로 반영된다.
function drawSpaceAim(hover, h) {
  const c = P(h.x, h.y);
  const a2 = P(hover.aim.x, hover.aim.y);
  // 도달 프로필을 능력치 + 몸 방향으로 — maxR(도달 한계)·safeR(정확 구간)은 포지션,
  // 모양은 향한 방향으로 길쭉한 로브(원이 아님). 향한 쪽 멀리, 등 뒤는 짧다.
  const maxRW = hover.maxR ?? 40;               // 세계 m
  const safeFrac = clamp((hover.safeR ?? 22) / (hover.maxR ?? 40), 0.2, 0.95);
  const facing = hover.facingAngle ?? 0;
  const baseFrac = hover.baseFrac ?? 0.6;
  const lobeRW = (a) => maxRW * (baseFrac + (1 - baseFrac) * (1 + Math.cos(a - facing)) / 2);
  const lobePath = () => {
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2, r = lobeRW(a);
      const q = P(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r);
      i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
  };
  const grad = ctx.createRadialGradient(c.x, c.y, 6 * c.s, c.x, c.y, maxRW * c.s);
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
  ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(a2.x, a2.y); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  ctx.fillStyle = `rgba(${C},0.18)`;
  circlePath(hover.aim.x, hover.aim.y, 5); ctx.fill();
  ctx.strokeStyle = `rgba(${C},0.95)`; ctx.lineWidth = 1.6;
  circlePath(hover.aim.x, hover.aim.y, 5); ctx.stroke();
  if (hover.receiver) {
    ctx.strokeStyle = '#ffc24b'; ctx.lineWidth = 2.4;
    circlePath(hover.receiver.x, hover.receiver.y, 2.4); ctx.stroke();
  }
  ctx.fillStyle = `rgba(${C},1)`;
  ctx.font = `600 ${Math.max(9.5, gs * 1.05)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(!hover.reachable ? t('pitch.unreachable') : REC.t + (hover.lofted ? lobWord() : ''), a2.x, a2.y - 7 * a2.s);
}

function laneTag(text, p, status) {
  const q = P(p.x, p.y);
  ctx.fillStyle = LANE_COLORS[status] ?? COLORS.laneRisky;
  ctx.font = `600 ${Math.max(9.5, gs * 1.05)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(text, q.x, q.y - 6);
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
    const q = P(p.rx ?? p.x, p.ry ?? p.y);
    const r = q.s * TOKEN_R_M + 9;
    let color, alpha;
    if (o.risk < 0.30)      { color = '#5dd6c5'; alpha = 0.88; }
    else if (o.risk < 0.58) { color = '#f5c842'; alpha = 0.68; }
    else                    { color = '#e35d5d'; alpha = 0.38; }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── run destinations (런 무장 시) ──────────────────────────────────────────
// Off-ball run destinations — thick energetic arrows so runs read as
// purposeful MOVEMENT, not pass lanes. Color: orange-amber (#f5a623).
function drawRunDestinations(dests, players) {
  const byId = new Map(players.map(p => [p.id, p]));
  for (const d of dests) {
    const p = byId.get(d.targetId);
    if (!p || !d.zone) continue;
    const f = P(d.from.x, d.from.y);
    const tq = P(d.zone.x, d.zone.y);
    const len = Math.hypot(tq.x - f.x, tq.y - f.y);
    if (len < gs * 3) continue;

    const angle = Math.atan2(tq.y - f.y, tq.x - f.x);
    const headLen = Math.min(14, len * 0.35);
    // Stem ends slightly before tip so arrowhead sits cleanly.
    const sx = tq.x - Math.cos(angle) * headLen * 0.9;
    const sy = tq.y - Math.sin(angle) * headLen * 0.9;

    ctx.save();

    // — Stem: solid thick line —
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(sx, sy);
    ctx.stroke();

    // — Arrowhead: filled triangle —
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.moveTo(tq.x, tq.y);
    ctx.lineTo(
      tq.x - Math.cos(angle - Math.PI / 7) * headLen,
      tq.y - Math.sin(angle - Math.PI / 7) * headLen,
    );
    ctx.lineTo(
      tq.x - Math.cos(angle + Math.PI / 7) * headLen,
      tq.y - Math.sin(angle + Math.PI / 7) * headLen,
    );
    ctx.closePath();
    ctx.fill();

    // — Destination ring: pulsing circle —
    const ringR = tq.s * 3.2 + Math.sin(pulse * 4) * 1.2;
    ctx.globalAlpha = 0.45 + Math.sin(pulse * 4) * 0.15;
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(tq.x, tq.y, ringR, 0, Math.PI * 2);
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
    circlePath(p.zone.x, p.zone.y, p.zone.r); ctx.stroke();
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
    circlePath(p.zone.x, p.zone.y, p.zone.r); ctx.stroke();
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
  const q = P(p.rx ?? p.x, p.ry ?? p.y);
  const r = q.s * TOKEN_R_M + 6 + Math.sin(pulse * 4) * 1.8;
  ctx.save();
  ctx.strokeStyle = '#5dd6c5';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawPlayers(players, holderId, pressureExpr, presserId) {
  // 3D 깊이 정렬: 먼 선수(작은 y)부터 → 가까운 선수가 자연스럽게 앞에 겹친다.
  const sorted = [...players].sort((a, b) => (a.ry ?? a.y) - (b.ry ?? b.y));
  for (const p of sorted) {
    if (p.side === 'opp') drawToken(p, false, pressureExpr, p.id === presserId);
    else drawToken(p, p.id === holderId, pressureExpr);
  }
}

function drawToken(p, isHolder, pressureExpr, isPresser = false) {
  const q = P(p.rx ?? p.x, p.ry ?? p.y);
  const r = q.s * TOKEN_R_M;
  const cx = q.x, cy = q.y;
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
  // 압박수 링(A5 가독성) — 지금 조여오는 그 수비수. 게이지가 높을수록 진해져
  // "왜 시계가 빨리 차는지"가 눈으로 연결된다.
  if (isPresser) {
    const urgency = 0.45 + (pressureExpr?.level ?? 0) * 0.45;
    ctx.save();
    ctx.strokeStyle = `rgba(251, 146, 60, ${urgency})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  // 몸 방향 노치(실시간 v2) — 속도 벡터(_vx/_vy)로 달리는 방향을 보여준다. 선수가
  // 어디로 뛰는지 한눈에 읽혀 '축구를 하는 그림'이 된다(정지 시엔 안 그림).
  {
    const vx = p._vx ?? 0, vy = p._vy ?? 0, spd = Math.hypot(vx, vy);
    if (spd > 0.35) {
      const a = Math.atan2(vy, vx);
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(a);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(r * 1.3, 0); ctx.lineTo(r * 0.7, -r * 0.36); ctx.lineTo(r * 0.7, r * 0.36);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
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
  // 3D: 로빙볼은 실제 z(높이 m)로 떠오른다 — 카메라가 원근으로 그린다.
  let z = 0;
  if (ball.lofted && ball.flying) z = Math.sin((ball.flightT ?? 0) * Math.PI) * 6;
  const g = P(px, py, 0);          // 지면(그림자 위치)
  const q = P(px, py, z);          // 공 본체(높이 반영)
  const r = Math.max(4.5, q.s * 0.62);
  const bx = q.x, by = q.y;
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
  // 지면 그림자: 항상 지면(z=0)에 — 로빙볼이 떠올라도 그림자는 바닥에 남는다.
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  const shR = r * Math.max(0.45, 1 - z * 0.09);   // 높이 오를수록 그림자 작아짐
  ctx.beginPath(); ctx.ellipse(g.x, g.y + r * 0.3, shR * 0.9, shR * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 흰 공 본체 + 접지 그림자.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 5; ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#f5f6f4';
  ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 회전: 논리 위치 이동량에 비례해 패널을 굴림(빠른 패스=빠른 스핀, 정지 시 멈춤).
  const lg = P(ball.x, ball.y, 0);
  if (ballPrevLog) {
    const d = Math.hypot(lg.x - ballPrevLog.x, lg.y - ballPrevLog.y);
    if (d > 0.1 && d < r * 6) ballSpin += (d / r) * 0.9 * (Math.sign(lg.x - ballPrevLog.x) || 1);
    // 긴 세션에서 무한 누적 시 sin/cos 부동소수 정밀도 손실 — 2π로 래핑.
    ballSpin %= (Math.PI * 2);
  }
  ballPrevLog = { x: lg.x, y: lg.y };
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

// A3 프리즈 플래시 — 수비 판독 진입 순간 파란 가장자리가 스치듯 지나간다("세상이
// 멈춘다"). 압박 비네트(붉음)와 색으로 구분되는 420ms 원샷.
function drawFreezeFlash(flash) {
  if (!flash || flash <= 0.01) return;
  const g = ctx.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.38, viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.72);
  g.addColorStop(0, 'rgba(70, 130, 220, 0)');
  g.addColorStop(1, `rgba(70, 130, 220, ${0.32 * flash})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, viewH);
}

function drawShout(pressureExpr, holder) {
  if (!pressureExpr?.shout || !holder) return;
  const jitter = Math.sin(pulse * 30) * 1.5;
  const q = P(holder.rx ?? holder.x, holder.ry ?? holder.y);
  ctx.fillStyle = 'rgba(255, 120, 100, 0.95)';
  ctx.font = `800 ${Math.max(12, gs * 1.6)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(pressureExpr.shout, q.x + jitter, q.y - q.s * TOKEN_R_M - 4);
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

// ─── primitives (세계 좌표 → 투영) ───────────────────────────────────────────
function strokeRect(x, y, w, h) {
  quadPath(P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h));
  ctx.stroke();
}
function line(x1, y1, x2, y2) {
  const a = P(x1, y1), b = P(x2, y2);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}
function circle(x, y, r) { circlePath(x, y, r); ctx.stroke(); }
function arc(x, y, r, a0, a1, segs = 16) {
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * (i / segs);
    const q = P(x + Math.cos(a) * r, y + Math.sin(a) * r);
    i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
}
function dot(x, y) {
  const q = P(x, y);
  ctx.beginPath(); ctx.arc(q.x, q.y, 0.35 * q.s, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.pitchLine; ctx.fill();
}
function arrow(x1, y1, x2, y2) {
  const a = P(x1, y1), b = P(x2, y2);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(6, b.s * 1.2);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
