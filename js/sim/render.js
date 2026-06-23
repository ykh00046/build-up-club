// Canvas renderer for the live match. Draws a true-to-scale pitch (all Law 1
// markings), the 22 players (team colour, number, facing), and the ball with a
// height-aware shadow so lofted balls visibly leave the ground. Pure drawing —
// it reads match state and never mutates it.

import { FIELD } from './field.js';
import { BALL_R } from './physics.js';

const GRASS_DARK = '#16361f';
const GRASS_LIGHT = '#1b3f25';
const LINE = 'rgba(235,245,238,0.78)';

let pad = 26; // px margin around the pitch
let scale = 1;

// Fit the pitch into the canvas with a margin; returns the px-per-meter scale.
export function layout(canvas) {
  const availW = canvas.width - pad * 2;
  const availH = canvas.height - pad * 2;
  scale = Math.min(availW / FIELD.W, availH / FIELD.H);
  return scale;
}

function sx(x) { return pad + x * scale; }
function sy(y) { return pad + (FIELD.H - y) * scale; } // flip: y up = screen up

export function draw(ctx, state) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b1410';
  ctx.fillRect(0, 0, W, H);
  drawPitch(ctx);
  drawPlayers(ctx, state);
  drawBall(ctx, state.ball);
  drawPhaseBadge(ctx, state);
}

function drawPitch(ctx) {
  // Mowing stripes.
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? GRASS_LIGHT : GRASS_DARK;
    const x0 = sx((i / stripes) * FIELD.W);
    const x1 = sx(((i + 1) / stripes) * FIELD.W);
    ctx.fillRect(x0, sy(FIELD.H), x1 - x0, sy(0) - sy(FIELD.H));
  }
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.4, scale * 0.12);
  ctx.lineJoin = 'round';

  const box = (gx) => {
    const dir = gx === 0 ? 1 : -1;
    // Penalty area
    rect(ctx, gx, FIELD.cy - FIELD.penaltyHalfW, dir * FIELD.penaltyDepth, FIELD.penaltyHalfW * 2);
    // Goal area
    rect(ctx, gx, FIELD.cy - FIELD.goalAreaHalfW, dir * FIELD.goalAreaDepth, FIELD.goalAreaHalfW * 2);
    // Penalty spot
    dot(ctx, gx + dir * FIELD.penaltySpot, FIELD.cy, scale * 0.18);
    // Goal frame (drawn slightly outside the line)
    ctx.save();
    ctx.strokeStyle = '#f4f7f5';
    ctx.lineWidth = Math.max(2, scale * 0.18);
    rect(ctx, gx, FIELD.goalYMin, -dir * 1.6, FIELD.goalWidth);
    ctx.restore();
    // Penalty arc (D)
    ctx.beginPath();
    const spotX = gx + dir * FIELD.penaltySpot;
    const a0 = dir === 1 ? -0.93 : Math.PI - 0.93;
    const a1 = dir === 1 ? 0.93 : Math.PI + 0.93;
    ctx.arc(sx(spotX), sy(FIELD.cy), FIELD.centreRadius * scale, a0, a1, dir !== 1);
    ctx.stroke();
  };

  // Outer boundary
  rect(ctx, 0, 0, FIELD.W, FIELD.H);
  // Halfway line + centre circle + spot
  line(ctx, FIELD.W / 2, 0, FIELD.W / 2, FIELD.H);
  ctx.beginPath();
  ctx.arc(sx(FIELD.W / 2), sy(FIELD.cy), FIELD.centreRadius * scale, 0, Math.PI * 2);
  ctx.stroke();
  dot(ctx, FIELD.W / 2, FIELD.cy, scale * 0.18);
  box(0); box(FIELD.W);
}

function drawPlayers(ctx, state) {
  for (const p of state.players) {
    const cx = sx(p.x), cy = sy(p.y);
    const r = 1.05 * scale;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.5, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    // Body
    const col = state.teams[p.team].color;
    ctx.fillStyle = p.role === 'GK' ? '#2cd17a' : col;
    ctx.strokeStyle = 'rgba(8,16,12,0.85)';
    ctx.lineWidth = Math.max(1, scale * 0.08);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Facing tick
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, scale * 0.1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(-p.heading) * 0 + Math.cos(p.heading) * r * 1.4,
      cy - Math.sin(p.heading) * r * 1.4);
    ctx.stroke();
    // Number
    ctx.fillStyle = (p.role === 'GK') ? '#04130b' : pickText(col);
    ctx.font = `${Math.round(r * 1.1)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(p.num), cx, cy + 0.5);
    // Ball-owner ring
    if (state.ball.owner === p.id) {
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = Math.max(1.5, scale * 0.12);
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

function drawBall(ctx, ball) {
  const cx = sx(ball.x), cy = sy(ball.y);
  // Shadow on the ground (position unaffected by height), grows with height.
  const lift = ball.z * scale * 0.9;
  const sr = (BALL_R * scale * 2.2) * (1 + ball.z * 0.06);
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.32 - ball.z * 0.02)})`;
  ctx.beginPath(); ctx.ellipse(cx, cy, sr, sr * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  // Ball lifted up the screen by its height.
  const bx = cx, by = cy - lift;
  const br = Math.max(3, BALL_R * scale * 2.4);
  ctx.fillStyle = '#fdfdfd';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = Math.max(1, scale * 0.06);
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

function drawPhaseBadge(ctx, state) {
  if (state.phase === 'PLAY') return;
  const label = {
    KICKOFF: '킥오프', SETUP: restartLabel(state), GOAL: '골!',
    HALF_TIME: '하프타임', FULL_TIME: '경기 종료',
  }[state.phase] ?? state.phase;
  ctx.save();
  ctx.font = `${Math.round(scale * 2.4)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(label).width + scale * 2;
  const x = ctx.canvas.width / 2, y = pad + scale * 3;
  ctx.fillStyle = 'rgba(8,14,11,0.74)';
  roundRect(ctx, x - tw / 2, y - scale * 1.6, tw, scale * 3.2, scale * 0.6);
  ctx.fill();
  ctx.fillStyle = state.phase === 'GOAL' ? '#ffd24a' : '#eafff2';
  ctx.fillText(label, x, y);
  ctx.restore();
}

function restartLabel(state) {
  const ko = { throw_in: '스로인', goal_kick: '골킥', corner_kick: '코너킥', free_kick: '프리킥', penalty: '페널티킥', kickoff: '킥오프' };
  const r = state.restart;
  return r ? `${ko[r.type] ?? r.type} · ${state.teams[r.team]?.name ?? ''}` : '';
}

// ─── primitives ────────────────────────────────────────────────────────────
function rect(ctx, x, y, w, h) {
  ctx.strokeRect(sx(Math.min(x, x + w)), sy(Math.max(y, y + h)), Math.abs(w) * scale, Math.abs(h) * scale);
}
function line(ctx, x0, y0, x1, y1) {
  ctx.beginPath(); ctx.moveTo(sx(x0), sy(y0)); ctx.lineTo(sx(x1), sy(y1)); ctx.stroke();
}
function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(sx(x), sy(y), r, 0, Math.PI * 2); ctx.fillStyle = LINE; ctx.fill(); }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function pickText(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#0b1410' : '#ffffff';
}

export { sx, sy };
