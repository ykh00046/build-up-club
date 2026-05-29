// ─── Colors (Tactical Dark Board Palette) ────────
const C = {
  fieldGreen:    '#08100d', // Deep Slate Green
  fieldDark:     '#050a08', // Darker striped bands
  fieldLine:     '#14241d', // Muted Technical Teal line
  playerBlue:    '#f8f9fa', // Off-white Attackers
  playerOutline: '#adb5bd', // Slate border
  playerHighlight: '#f5a623', // Amber accent for selected / active
  defenderRed:   '#eb5757', // Clean Crimson defenders
  defenderOutline: '#c23b3b',
  defenderRange: 'rgba(235,87,87,0.06)', // Muted red pressing circle
  defenderRangeStroke: 'rgba(235,87,87,0.18)',
  coverShadow:   'rgba(242,120,25,0.08)', // Muted amber-orange shadow cone
  coverShadowStroke: 'rgba(242,120,25,0.18)',
  patrolRange:   'rgba(242,160,25,0.05)',
  patrolStroke:  'rgba(242,160,25,0.15)',
  chaseRange:    'rgba(180,92,255,0.05)',
  chaseStroke:   'rgba(180,92,255,0.15)',
  ball:          '#f5a623', // Amber high-visibility ball
  ballOutline:   '#ffffff',
  goalPost:      '#495057',
  goalNet:       'rgba(73,80,87,0.1)',
  passSafe:      'rgba(16,185,129,0.7)', // Emerald Mint safe path
  passRisky:     'rgba(245,166,35,0.7)', // Amber risky path
  passBlocked:   'rgba(235,87,87,0.7)', // Crimson blocked path
  passRange:     'rgba(245,166,35,0.04)',
  passRangeStroke: 'rgba(245,166,35,0.15)',
  targetZone:    'rgba(21,100,160,0.08)', // Deep tactical blue target
  targetZoneStroke: 'rgba(21,100,160,0.3)',
  targetZoneText: '#f5a623', // Amber text
  trapZone:      'rgba(245,166,35,0.045)',
  trapZoneStroke:'rgba(245,166,35,0.28)',
  trapZoneText:  '#f2a019',
  uiBg:          'rgba(5,10,8,0.95)',
  uiText:        '#f8f9fa',
  uiAccent:      '#f5a623', // Amber accent
  uiFail:        '#eb5757', // Crimson fail
  starGold:      '#f5a623',
  starEmpty:     '#1a1f1d',
  titleBg:       '#050a08',
  titleGradTop:  '#08100d',
  titleGradBot:  '#050a08',
  levelLocked:   '#131816',
  levelUnlocked: '#10b981',
  levelClear:    '#f5a623',
  btnBg:         '#15241d',
  btnHover:      '#1b3227',
  btnText:       '#f5a623',
  btnActive:     '#ffffff',
  offBallHome:   'rgba(248,249,250,0.20)',
  offBallAway:   'rgba(235,87,87,0.18)',
  offBallLine:   'rgba(255,255,255,0.055)',
};

// ─── Drawing and Helper Functions ────────────────
function fitCanvasText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 3 && ctx.measureText(`${out}...`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function drawPixelCircle(ctx, x, y, r, fill, stroke, strokeW) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeW || 1; ctx.stroke(); }
}

function serializeLevel(lvl) {
  try {
    const compact = {
      n: lvl.name,
      c: lvl.intendedConcept,
      o: lvl.optimalPasses,
      l: lvl.passLimit,
      p: lvl.players.map(p => ({ x: p.x, y: p.y, h: p.hasBall ? 1 : 0, r: p.passRange })),
      d: lvl.defenders.map(d => ({
        x: d.x,
        y: d.y,
        t: d.type,
        b: d.blockRadius,
        sa: d.coverShadowAngle,
        sl: d.coverShadowLength,
        path: d.patrolPath ? d.patrolPath.map(pt => ({ x: pt.x, y: pt.y })) : null
      })),
      tz: lvl.targetZone ? { x: lvl.targetZone.x, y: lvl.targetZone.y, w: lvl.targetZone.w, h: lvl.targetZone.h, l: lvl.targetZone.label } : null,
      trz: lvl.trapZones ? lvl.trapZones.map(z => ({ x: z.x, y: z.y, w: z.w, h: z.h, l: z.label })) : [],
      a: lvl.tacticalActions
    };
    return btoa(encodeURIComponent(JSON.stringify(compact)));
  } catch (e) {
    console.error("Serialization failed", e);
    return "";
  }
}

function deserializeLevel(hash) {
  try {
    const compact = JSON.parse(decodeURIComponent(atob(hash)));
    return {
      id: 99,
      name: compact.n || "Custom Drill",
      intendedConcept: compact.c || "Custom Strategy",
      optimalPasses: compact.o || compact.l || 3,
      passLimit: compact.l || 3,
      players: compact.p.map(p => ({ x: p.x, y: p.y, hasBall: p.h === 1, passRange: p.r || 150 })),
      defenders: compact.d.map(d => ({
        x: d.x,
        y: d.y,
        type: d.t,
        blockRadius: d.b || 10,
        coverShadowAngle: d.sa || 45,
        coverShadowLength: d.sl || 60,
        patrolPath: d.path ? d.path.map(pt => ({ x: pt.x, y: pt.y })) : null
      })),
      targetZone: compact.tz ? { x: compact.tz.x, y: compact.tz.y, w: compact.tz.w, h: compact.tz.h, label: compact.tz.l || 'TARGET' } : null,
      trapZones: compact.trz ? compact.trz.map(z => ({ x: z.x, y: z.y, w: z.w, h: z.h, label: z.l || 'TRAP' })) : [],
      tacticalActions: compact.a || { bounce: 0, thirdMan: 0, switchPlay: 0, dropPivot: 0 }
    };
  } catch (e) {
    console.error("Deserialization failed", e);
    return null;
  }
}

function getPlayerSubRole(labelText) {
  switch (labelText) {
    case 'GK': return 'SWEED GK';
    case 'LCB': return 'B-PLAYING CB';
    case 'RCB': return 'B-PLAYING CB';
    case 'LB': return 'INVERTED FB';
    case 'RB': return 'WINGBACK';
    case 'DM': return 'DEEP PIVOT';
    case '8R': return 'MEZZALA';
    case '8L': return 'BOX-TO-BOX';
    case 'AM': return 'ADVANCED PL';
    case 'CM': return 'CENTRE MID';
    case 'FW': return 'FALSE NINE';
    default: return '';
  }
}

function getClosestPointOnSegment(p, a, b) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const abLenSq = ab.x * ab.x + ab.y * ab.y;
  if (abLenSq === 0) return { x: a.x, y: a.y };
  let t = (ap.x * ab.x + ap.y * ab.y) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * ab.x, y: a.y + t * ab.y };
}

function drawCutBadge(ctx, from, to, defender) {
  let cutX = (from.x + to.x) / 2;
  let cutY = (from.y + to.y) / 2;
  if (defender) {
    const pt = getClosestPointOnSegment(defender, from, to);
    cutX = pt.x;
    cutY = pt.y;
  }
  const bw = 16;
  const bh = 8;
  const bx = cutX - bw / 2;
  const by = cutY - bh / 2;
  const br = 2;

  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = C.uiFail;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, br);
  else ctx.rect(bx, by, bw, bh);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 5px "JetBrains Mono"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CUT', cutX, cutY + 0.5);
  ctx.restore();
}

function drawPlayer(ctx, x, y, hasBall, highlighted, passRange, labelText) {
  if (highlighted && passRange) {
    drawPixelCircle(ctx, x, y, passRange, C.passRange, C.passRangeStroke, 1);
  }

  const bodyColor = highlighted ? C.playerHighlight : C.playerBlue;
  drawPixelCircle(ctx, x, y, PLAYER_RADIUS + 1, bodyColor, C.playerOutline, 1.5);

  ctx.save();
  ctx.fillStyle = highlighted ? '#000000' : '#1e293b';
  ctx.font = 'bold 6.5px "Outfit"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText || '', x, y + 0.5);
  ctx.restore();

  const subRole = getPlayerSubRole(labelText);
  if (subRole) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '500 5px "Outfit"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(subRole, x, y + PLAYER_RADIUS + 3);
    ctx.restore();
  }

  if (hasBall) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(Date.now() / 200);
    drawPixelCircle(ctx, x, y, PLAYER_RADIUS + 5, null, C.uiAccent, 2);
    ctx.restore();
  }
}

function getDefenderSubRole(type) {
  if (type === 'presser') return '1ST PRESSER';
  if (type === 'chase') return 'TRAP WIDE';
  if (type === 'patrol') return 'FAR-SIDE LOCK';
  return 'SCREEN PIVOT';
}

function drawDefender(ctx, d, time, labelText) {
  const px = d.x;
  const py = d.y;

  if (d.type === 'presser' && d.coverShadowAngle && d.coverShadowLength && Game.guides.shadow) {
    const holder = Game.players[Game.currentPlayerIdx];
    if (holder) {
      const dx = d.x - holder.x;
      const dy = d.y - holder.y;
      const baseAngle = Math.atan2(dy, dx);
      const halfAngle = (d.coverShadowAngle * Math.PI / 180) / 2;

      ctx.save();
      ctx.fillStyle = C.coverShadow;
      ctx.strokeStyle = C.coverShadowStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.arc(d.x, d.y, d.coverShadowLength, baseAngle - halfAngle, baseAngle + halfAngle);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  if (Game.guides.radius) {
    let rangeColor, strokeColor;
    if (d.type === 'patrol') {
      rangeColor = C.patrolRange;
      strokeColor = C.patrolStroke;
    } else if (d.type === 'chase') {
      rangeColor = C.chaseRange;
      strokeColor = C.chaseStroke;
    } else {
      rangeColor = C.defenderRange;
      strokeColor = C.defenderRangeStroke;
    }
    drawPixelCircle(ctx, px, py, d.blockRadius, rangeColor, strokeColor, 1);
  }

  if (d.type === 'patrol' && d.patrolPath) {
    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = C.patrolStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(d.patrolPath[0].x, d.patrolPath[0].y);
    for (let i = 1; i < d.patrolPath.length; i++) {
      ctx.lineTo(d.patrolPath[i].x, d.patrolPath[i].y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
  }

  const bodyColor = d.type === 'chase' ? '#8020b0' : (d.type === 'patrol' ? '#c9802a' : C.defenderRed);
  const outColor = d.type === 'chase' ? '#5a1a7a' : (d.type === 'patrol' ? '#8a5a1a' : C.defenderOutline);
  drawPixelCircle(ctx, px, py, PLAYER_RADIUS + 0.5, bodyColor, outColor, 1.5);

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 6.5px "Outfit"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText || '', px, py + 0.5);
  ctx.restore();

  const subRole = getDefenderSubRole(d.type);
  if (subRole && Game.guides.radius) {
    ctx.save();
    ctx.fillStyle = 'rgba(235, 87, 87, 0.45)';
    ctx.font = '500 5px "Outfit"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(subRole, px, py + PLAYER_RADIUS + 3);
    ctx.restore();
  }

  // Defender visual role markers
  ctx.fillStyle = '#fff';
  if (d.type === 'static' || d.type === 'presser') {
    ctx.fillRect(px - 2, py - 2, 4, 4);
  } else if (d.type === 'patrol') {
    ctx.fillRect(px - 3, py - 1, 6, 2);
    ctx.fillRect(px - 3, py - 2, 1, 4);
    ctx.fillRect(px + 2, py - 2, 1, 4);
  } else if (d.type === 'chase') {
    ctx.beginPath();
    ctx.moveTo(px, py - 3);
    ctx.lineTo(px + 3, py + 2);
    ctx.lineTo(px - 3, py + 2);
    ctx.closePath();
    ctx.fill();
  }

  // Draw defender body orientation indicator (Face Direction towards ball)
  const holder = Game.players[Game.currentPlayerIdx];
  if (holder) {
    const angle = Math.atan2(holder.y - py, holder.x - px);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(angle) * (PLAYER_RADIUS + 0.5), py + Math.sin(angle) * (PLAYER_RADIUS + 0.5));
    ctx.lineTo(px + Math.cos(angle) * (PLAYER_RADIUS + 5), py + Math.sin(angle) * (PLAYER_RADIUS + 5));
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(px + Math.cos(angle) * (PLAYER_RADIUS + 5), py + Math.sin(angle) * (PLAYER_RADIUS + 5), 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawBall(ctx, x, y) {
  drawPixelCircle(ctx, x, y, BALL_RADIUS, C.ball, C.ballOutline, 1);
}

function drawTargetZone(ctx, tz) {
  if (!tz) return;
  ctx.save();
  ctx.fillStyle = C.targetZone;
  ctx.strokeStyle = C.targetZoneStroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(tz.x, tz.y, tz.w, tz.h);
  ctx.strokeRect(tz.x, tz.y, tz.w, tz.h);
  ctx.setLineDash([]);

  // Anchor the label to the top edge of the zone so it never collides with a
  // player token sitting at the zone centre.
  const cx = tz.x + tz.w / 2;
  const channelCy = tz.y + tz.h / 2;
  const zoneLabel = tLevel(Game.levelId, 'zone') || tz.label;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.targetZoneText;
  ctx.font = 'bold 7px Outfit';
  ctx.fillText(zoneLabel.toUpperCase(), cx, tz.y + 9);
  ctx.fillStyle = 'rgba(0,180,216,0.7)';
  ctx.font = '600 5px Outfit';
  ctx.fillText(tChannel(CHANNELS[channelOf(channelCy)].short), cx, tz.y + 18);
  ctx.restore();
}

function drawTrapZone(ctx, zone) {
  if (!zone) return;
  ctx.save();
  ctx.fillStyle = C.trapZone;
  ctx.strokeStyle = C.trapZoneStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
  ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
  ctx.setLineDash([]);

  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  ctx.fillStyle = C.trapZoneText;
  ctx.font = 'bold 6px Outfit';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((zone.label || 'TRAP').toUpperCase(), cx, cy);
  ctx.restore();
}

function drawField(ctx, w, h) {
  ctx.fillStyle = C.fieldGreen;
  ctx.fillRect(0, 0, w, h);

  const stripeW = 32;
  ctx.fillStyle = C.fieldDark;
  for (let i = 0; i < w; i += stripeW * 2) {
    ctx.fillRect(i, 0, stripeW, h);
  }

  ctx.strokeStyle = C.fieldLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.beginPath();
  ctx.moveTo(w / 2, 10);
  ctx.lineTo(w / 2, h - 10);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 30, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeRect(10, h/2 - 40, 50, 80);
  ctx.strokeRect(w - 60, h/2 - 40, 50, 80);
}

function drawChannels(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,245,212,0.035)';
  ctx.fillRect(FIELD_X0, CHANNELS[1].y0, FIELD_X1 - FIELD_X0, CHANNELS[1].y1 - CHANNELS[1].y0);
  ctx.fillRect(FIELD_X0, CHANNELS[3].y0, FIELD_X1 - FIELD_X0, CHANNELS[3].y1 - CHANNELS[3].y0);

  ctx.strokeStyle = 'rgba(120,160,140,0.10)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 4]);
  for (let i = 1; i < CHANNELS.length; i++) {
    ctx.beginPath();
    ctx.moveTo(FIELD_X0, CHANNELS[i].y0);
    ctx.lineTo(FIELD_X1, CHANNELS[i].y0);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(150,180,165,0.30)';
  ctx.font = '600 5px "Outfit"';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const ch of CHANNELS) {
    ctx.fillText(ch.short, FIELD_X0 + 2, (ch.y0 + ch.y1) / 2);
  }
  ctx.restore();
}

function drawLinesOfEngagement(ctx, defenders) {
  if (!defenders.length) return;
  const xs = defenders.map(d => d.x).sort((a, b) => a - b);
  const lines = [];
  for (const x of xs) {
    if (lines.length && Math.abs(x - lines[lines.length - 1]) < 22) {
      lines[lines.length - 1] = (lines[lines.length - 1] + x) / 2;
    } else {
      lines.push(x);
    }
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(255,92,92,0.12)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([1, 5]);
  for (const x of lines) {
    ctx.beginPath();
    ctx.moveTo(x, FIELD_Y0);
    ctx.lineTo(x, FIELD_Y1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

const OFF_BALL_ATTACK_CONTEXT = [
  { x: 28,  y: 128, role: 'GK' },
  { x: 72,  y: 42,  role: 'LB' },
  { x: 74,  y: 98,  role: 'CB' },
  { x: 74,  y: 158, role: 'CB' },
  { x: 72,  y: 214, role: 'RB' },
  { x: 136, y: 78,  role: '6' },
  { x: 144, y: 178, role: '8' },
  { x: 210, y: 54,  role: 'LW' },
  { x: 224, y: 128, role: '10' },
  { x: 210, y: 202, role: 'RW' },
  { x: 304, y: 128, role: '9' },
];

const OFF_BALL_DEFENSE_CONTEXT = [
  { x: 344, y: 128, role: 'GK' },
  { x: 292, y: 44,  role: 'RB' },
  { x: 286, y: 96,  role: 'CB' },
  { x: 286, y: 160, role: 'CB' },
  { x: 292, y: 212, role: 'LB' },
  { x: 228, y: 72,  role: '6' },
  { x: 218, y: 180, role: '8' },
  { x: 160, y: 50,  role: 'RW' },
  { x: 146, y: 128, role: '10' },
  { x: 160, y: 206, role: 'LW' },
  { x: 88,  y: 128, role: '9' },
];

const OFF_BALL_LINES = [
  [1, 2, 3, 4],
  [5, 6],
  [7, 8, 9],
  [10],
];

function drawOffBallTeam(ctx, points, color, strokeColor, activePoints, offsetX) {
  ctx.save();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = strokeColor;
  ctx.setLineDash([1, 4]);

  for (const line of OFF_BALL_LINES) {
    ctx.beginPath();
    let started = false;
    for (const idx of line) {
      const p = points[idx];
      if (!p) continue;
      const x = p.x + offsetX;
      if (!started) {
        ctx.moveTo(x, p.y);
        started = true;
      } else {
        ctx.lineTo(x, p.y);
      }
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
  for (const p of points) {
    const x = p.x + offsetX;
    const tooClose = activePoints.some(a => dist(a, { x, y: p.y }) < 19);
    if (tooClose) continue;

    drawPixelCircle(ctx, x, p.y, 3.2, color, strokeColor, 0.7);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = '600 4.5px "JetBrains Mono"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.role, x, p.y + 0.4);
  }

  ctx.restore();
}

function drawOffBallContext(ctx, lvl, activePlayers = [], activeDefenders = [], time = 0) {
  if (!lvl) return;
  const palette = lvl.teamPalette || {};
  const homeColor = palette.home ? `${palette.home}33` : C.offBallHome;
  const awayColor = palette.away ? `${palette.away}2e` : C.offBallAway;
  const activePoints = [...activePlayers, ...activeDefenders];
  const drift = Math.sin(time * 0.001) * 1.2;

  ctx.save();
  ctx.globalAlpha = 0.9;
  drawOffBallTeam(ctx, OFF_BALL_ATTACK_CONTEXT, homeColor, C.offBallLine, activePoints, drift);
  drawOffBallTeam(ctx, OFF_BALL_DEFENSE_CONTEXT, awayColor, C.offBallLine, activePoints, -drift);
  ctx.restore();
}

// Global exports
if (typeof window !== 'undefined') {
  window.C = C;
  window.fitCanvasText = fitCanvasText;
  window.drawPixelCircle = drawPixelCircle;
  window.serializeLevel = serializeLevel;
  window.deserializeLevel = deserializeLevel;
  window.getPlayerSubRole = getPlayerSubRole;
  window.getClosestPointOnSegment = getClosestPointOnSegment;
  window.drawCutBadge = drawCutBadge;
  window.drawPlayer = drawPlayer;
  window.getDefenderSubRole = getDefenderSubRole;
  window.drawDefender = drawDefender;
  window.drawBall = drawBall;
  window.drawTargetZone = drawTargetZone;
  window.drawTrapZone = drawTrapZone;
  window.drawField = drawField;
  window.drawChannels = drawChannels;
  window.drawLinesOfEngagement = drawLinesOfEngagement;
  window.drawOffBallContext = drawOffBallContext;
}
