// 실시간 빌드업 프로토타입 v2 — 손맛 검증 + 프로젝트에서 다진 전술 개념 이식.
// (정식 엔진과 독립. prototype.html이 로드.)
//
// v2에서 이식한 것(사용자 요청):
//   · 압박의 형태 — 대인 마킹 배정(형/미드/백이 우리 빌드코어/미드/전방을 담당).
//     유인이 성립하는 구조: 마커가 볼로 커밋하면 그 담당이 비어 3자가 열린다.
//   · 압박 강도 — mid/high/vhigh: 클로징 속도·마크 밀착·슬로우 밴드·라인 높이.
//   · 오프사이드 — 2nd-최심 상대 x = 라인. 라인 너머(+볼 앞) 팀원엔 패스 불가.
//     (유인–3자 콤비 작업의 온사이드 정직성 그대로.)
//   · 우리 선수 움직임 — 각 제공/온사이드 유지, 마커가 커밋하면 뒷공간 드롭(3자).

const PITCH = { w: 105, h: 68 };
const TACKLE_DIST = 1.3;
const INTERCEPT_LANE = 2.2;   // 패스 레인에 수비수 이 거리 안이면 위험
const CARRY_SPEED = 3.4;
const SUPPORT_SPEED = 3.2;
const BALL_SPEED = 22;
const SHOOT_X = 88;

const INTENSITY = {
  mid:   { name: '중간(mid)',   close: 4.2, tight: 3.4, band: 5.2, engage: 12, lineUp: 0 },
  high:  { name: '높음(high)',  close: 4.9, tight: 2.7, band: 6.2, engage: 14, lineUp: 3 },
  vhigh: { name: '최고(vhigh)', close: 5.6, tight: 2.1, band: 7.2, engage: 16, lineUp: 6 },
};

// 대인 배정(압박 형태) — 상대 형/미드/백이 우리 빌드코어/미드/전방을 담당.
const MARK_MAP = {
  of1: 'lcb', of2: 'rcb', of3: 'dm',        // 형: 빌드 코어 압박
  om1: 'l8', om2: 'r8', om3: 'lb',          // 미드: 미드 담당
  ob1: 'lw', ob2: 'rw', ob3: 'st', owb: 'rb', // 백: 전방 담당
};

function mk(id, side, role, x, y) { return { id, side, role, x, y, hx: x, hy: y, r: 11, markId: null }; }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clampY = (y) => Math.max(5, Math.min(PITCH.h - 5, y));

function pointToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy || 1;
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function freshTeams() {
  const us = [
    mk('gk', 'us', 'GK', 6, 34), mk('lcb', 'us', 'CB', 18, 26), mk('rcb', 'us', 'CB', 18, 42),
    mk('lb', 'us', 'LB', 26, 10), mk('rb', 'us', 'RB', 26, 58), mk('dm', 'us', '6', 34, 34),
    mk('l8', 'us', '8', 46, 24), mk('r8', 'us', '8', 46, 44),
    mk('lw', 'us', 'LW', 62, 12), mk('rw', 'us', 'RW', 62, 56), mk('st', 'us', 'ST', 66, 34),
  ];
  const opp = [
    mk('of1', 'opp', 'F', 50, 28), mk('of2', 'opp', 'F', 52, 40), mk('of3', 'opp', 'F', 56, 34),
    mk('om1', 'opp', 'M', 64, 20), mk('om2', 'opp', 'M', 64, 48), mk('om3', 'opp', 'M', 68, 34),
    mk('ob1', 'opp', 'B', 78, 26), mk('ob2', 'opp', 'B', 78, 42), mk('ob3', 'opp', 'B', 84, 34),
    mk('owb', 'opp', 'B', 74, 12), mk('ogk', 'opp', 'GK', 99, 34),
  ];
  // 상호 대인 배정
  for (const [oid, uid] of Object.entries(MARK_MAP)) {
    const o = opp.find((p) => p.id === oid), u = us.find((p) => p.id === uid);
    if (o && u) { o.markId = uid; u.markId = oid; }
  }
  return { us, opp };
}

export function createRT(canvas) {
  const ctx = canvas.getContext('2d');
  const MARGIN = 28;
  const scale = (canvas.width - MARGIN * 2) / PITCH.w;
  const sx = (x) => MARGIN + x * scale, sy = (y) => MARGIN + y * scale;

  let S = null, intensityKey = 'high';
  function reset() {
    const { us, opp } = freshTeams();
    S = {
      us, opp, all: [...us, ...opp], holderId: 'lcb',
      ball: { x: 18, y: 26, inFlight: null },
      mode: 'flow', timeScale: 1, targetScale: 1, cooldown: 0,
      manualSlow: true, manualActive: 0, presserId: null,
      status: 'live', flash: null, flashT: 0,
      stats: { passes: 0, fast: 0, slow: 0 },
    };
    S.ball.x = holder().x; S.ball.y = holder().y;
  }
  const I = () => INTENSITY[intensityKey];
  const holder = () => S.all.find((p) => p.id === S.holderId);
  const oppOut = () => S.opp.filter((p) => p.role !== 'GK');
  const teammates = () => S.us.filter((p) => p.id !== S.holderId && p.role !== 'GK');
  const byId = (id) => S.all.find((p) => p.id === id);

  // 오프사이드 라인 = 2nd-최심 상대 x(최심=GK). 라인 너머+볼 앞이면 오프사이드.
  function offsideLine() {
    const xs = S.opp.map((o) => o.x).sort((a, b) => b - a);
    return xs[1] ?? PITCH.w;
  }
  function isOffside(p) {
    const line = offsideLine();
    return p.x > line && p.x > S.ball.x + 0.3;
  }

  function laneRisk(from, to) {
    let min = Infinity;
    for (const o of oppOut()) min = Math.min(min, pointToSeg(o, from, to));
    return Math.max(0, Math.min(1, 1 - (min - 2) / 5));
  }
  function moveToward(p, tx, ty, speed, dt) {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, speed * dt);
    p.x += dx / d * step; p.y += dy / d * step;
  }

  function carryTarget(h) {
    const no = oppOut().reduce((a, o) => (dist(o, h) < dist(a, h) ? o : a), oppOut()[0]);
    let ty = h.y + (no ? Math.sign(h.y - no.y || 1) * 4 : 0);
    return { x: Math.min(h.x + 12, PITCH.w - 4), y: clampY(ty) };
  }

  function updatePlayers(dt) {
    const h = holder();
    const inten = I();
    // 압박수 = 볼 최근접 상대(엔게이지 범위 안) 1명 — 커밋(유인 성립).
    let presser = null, pd = Infinity;
    for (const o of oppOut()) { const d = dist(o, S.ball); if (d < pd) { pd = d; presser = o; } }
    S.presserId = (presser && pd <= inten.engage) ? presser.id : null;

    // 홀더 캐리
    if (!S.ball.inFlight && h) {
      const t = carryTarget(h);
      moveToward(h, t.x, t.y, CARRY_SPEED, dt);
      S.ball.x = h.x; S.ball.y = h.y;
    }

    // 상대: 압박수는 볼로 커밋, 나머지는 담당 대인(골side·밀착 by 강도), 백은 라인 유지.
    for (const o of oppOut()) {
      if (o.id === S.presserId) { moveToward(o, S.ball.x, S.ball.y, inten.close, dt); continue; }
      const mark = o.markId ? byId(o.markId) : null;
      if (mark) {
        // 골side(상대골 x=105 쪽 = 담당보다 살짝 높은 x) + 볼side y 편향 - 강도만큼 밀착.
        const tx = mark.x + inten.tight * 0.6 - inten.lineUp * 0.15;
        const ty = mark.y + (S.ball.y - mark.y) * 0.15;
        moveToward(o, tx, clampY(ty), inten.close * 0.85, dt);
      } else {
        moveToward(o, o.hx, o.hy, inten.close * 0.5, dt);
      }
    }

    // 우리 오프볼 — 각 제공/온사이드 유지, 마커가 커밋하면 뒷공간 드롭(3자).
    const line = offsideLine();
    for (const p of teammates()) {
      const m = p.markId ? byId(p.markId) : null;
      const committed = m && (m.id === S.presserId || dist(m, p) > inten.tight + 4.5);
      let aimX, aimY;
      if (committed) {
        // 자유 — 볼 앞 열린 온사이드 공간으로 내려와(또는 벌려) 받는다.
        aimX = Math.min(S.ball.x + 11, line - 1);
        aimY = clampY(p.hy + (S.ball.y - p.hy) * 0.15);
      } else {
        // 마킹됨 — 마커 반대편으로 각을 벌리며 볼 전진에 맞춰 온사이드 전진.
        const awayY = m ? p.y + Math.sign(p.y - m.y || 1) * 3 : p.y;
        aimX = p.x + 3 + Math.max(0, S.ball.x - p.x) * 0.25;
        aimY = awayY;
      }
      // 온사이드 클램프 — 볼 앞이면 라인 너머로 못 간다(선수는 라인 지킴).
      if (aimX > S.ball.x) aimX = Math.min(aimX, line - 0.5);
      moveToward(p, aimX, clampY(aimY), SUPPORT_SPEED, dt);
    }
  }

  function updateBall(dt) {
    const b = S.ball; if (!b.inFlight) return;
    const f = b.inFlight; f.t += dt / f.dur;
    if (f.t >= 1) {
      b.inFlight = null;
      if (f.intercepted) return flashResult('가로채기 — 볼 상실', false);
      S.holderId = f.targetId; b.x = holder().x; b.y = holder().y; S.cooldown = 0.35;
      if (holder().x >= SHOOT_X) flashResult('마무리 기회! ⚽', true);
      return;
    }
    b.x = f.from.x + (f.to.x - f.from.x) * f.t;
    b.y = f.from.y + (f.to.y - f.from.y) * f.t;
  }

  function pass(targetId, wasSlow) {
    const h = holder(), tgt = byId(targetId);
    if (!h || !tgt || S.ball.inFlight || isOffside(tgt)) return;   // 오프사이드로는 못 준다
    const risk = laneRisk(h, tgt) * (wasSlow ? 0.55 : 1);
    const intercepted = Math.random() < risk;
    let to = { x: tgt.x, y: tgt.y };
    if (intercepted) {
      let best = null, bd = Infinity;
      for (const o of oppOut()) { const d = pointToSeg(o, h, tgt); if (d < bd) { bd = d; best = o; } }
      if (best) to = { x: best.x, y: best.y };
    }
    const d = Math.hypot(to.x - h.x, to.y - h.y);
    S.ball.inFlight = { from: { x: h.x, y: h.y }, to, t: 0, dur: Math.max(0.16, d / BALL_SPEED), targetId, intercepted };
    S.stats.passes++; wasSlow ? S.stats.slow++ : S.stats.fast++;
    exitSlow();
  }

  function enterSlow(manual) {
    if (S.mode === 'slow') return;
    S.mode = 'slow'; S.targetScale = 0.12;
    if (manual) { S.manualSlow = false; S.manualActive = 1; }
  }
  function exitSlow() { S.mode = 'flow'; S.targetScale = 1; S.manualActive = 0; }
  function flashResult(msg, good) { S.status = 'flash'; S.flash = { msg, good }; S.flashT = 0; exitSlow(); }

  function frame(dtReal) {
    if (!S) return;
    S.timeScale += (S.targetScale - S.timeScale) * Math.min(1, dtReal * 9);
    const dt = dtReal * S.timeScale;
    if (S.status === 'flash') { S.flashT += dtReal; if (S.flashT > 1.1) reset(); return; }
    if (S.cooldown > 0) S.cooldown -= dtReal;
    updatePlayers(dt); updateBall(dt);
    const h = holder();
    if (h && !S.ball.inFlight) {
      let nd = Infinity; for (const o of oppOut()) nd = Math.min(nd, dist(o, h));
      if (nd < TACKLE_DIST) return flashResult('태클 당함 — 볼 상실', false);
      if (S.mode === 'flow' && S.cooldown <= 0 && nd < I().band) enterSlow(false);
      if (S.mode === 'slow' && !S.manualActive && nd > I().band + 1.5) exitSlow();
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────
  function drawPitch() {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#0e1f16'); g.addColorStop(1, '#0a1711');
    ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(120,170,140,0.22)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(sx(0), sy(0), PITCH.w * scale, PITCH.h * scale);
    ctx.beginPath(); ctx.moveTo(sx(52.5), sy(0)); ctx.lineTo(sx(52.5), sy(68)); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx(52.5), sy(34), 9.15 * scale, 0, 7); ctx.stroke();
    ctx.strokeRect(sx(0), sy(13.8), 16.5 * scale, 40.3 * scale);
    ctx.strokeRect(sx(105 - 16.5), sy(13.8), 16.5 * scale, 40.3 * scale);
    ctx.strokeStyle = 'rgba(80,200,140,0.16)';
    ctx.beginPath(); ctx.moveTo(sx(SHOOT_X), sy(2)); ctx.lineTo(sx(SHOOT_X), sy(66)); ctx.stroke();
  }
  const riskColor = (r) => (r < 0.33 ? '#22c55e' : r < 0.6 ? '#eab308' : '#ef4444');

  function draw() {
    drawPitch();
    const h = holder(), line = offsideLine();
    // 오프사이드 라인
    ctx.strokeStyle = 'rgba(248,113,113,0.35)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx(line), sy(2)); ctx.lineTo(sx(line), sy(66)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(248,113,113,0.5)'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('오프사이드', sx(line), sy(66) + 12);

    // 슬로우: 압박 밴드 + 패스 옵션(위험색, 오프사이드 제외)
    if (S.mode === 'slow' && h) {
      ctx.strokeStyle = 'rgba(96,165,250,0.35)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx(h.x), sy(h.y), I().band * scale, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      for (const t of teammates()) {
        if (t.x < h.x - 8) continue;
        if (isOffside(t)) continue;
        const r = laneRisk(h, t);
        ctx.strokeStyle = riskColor(r); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(sx(t.x), sy(t.y), 16, 0, 7); ctx.stroke();
        ctx.globalAlpha = 0.22; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx(h.x), sy(h.y)); ctx.lineTo(sx(t.x), sy(t.y)); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (S.ball.inFlight) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx(S.ball.inFlight.from.x), sy(S.ball.inFlight.from.y)); ctx.lineTo(sx(S.ball.x), sy(S.ball.y)); ctx.stroke();
    }
    // 선수
    for (const p of S.all) {
      const isH = p.id === S.holderId, isPress = p.id === S.presserId, off = p.side === 'us' && isOffside(p);
      ctx.globalAlpha = off ? 0.45 : 1;
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r, 0, 7);
      ctx.fillStyle = p.side === 'us' ? (isH ? '#60a5fa' : '#2563eb') : '#dc2626';
      if (p.role === 'GK') ctx.fillStyle = p.side === 'us' ? '#1e3a5f' : '#5f1e1e';
      ctx.fill();
      if (isH) { ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 3; ctx.stroke(); }
      if (isPress) { ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 2.5; ctx.stroke(); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(p.role, sx(p.x), sy(p.y) + 3);
    }
    ctx.beginPath(); ctx.arc(sx(S.ball.x), sy(S.ball.y), 5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
    // 슬로우 비네트
    if (S.timeScale < 0.7) {
      const a = (0.7 - S.timeScale) * 0.5;
      const rg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.3, canvas.width / 2, canvas.height / 2, canvas.height * 0.75);
      rg.addColorStop(0, 'rgba(10,20,40,0)'); rg.addColorStop(1, `rgba(10,20,40,${a})`);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // HUD
    ctx.textAlign = 'left'; ctx.font = '13px system-ui';
    ctx.fillStyle = S.mode === 'slow' ? '#93c5fd' : 'rgba(200,220,210,0.7)';
    ctx.fillText(S.mode === 'slow' ? (S.manualActive ? '◆ 수동 슬로우 — 침착하게 읽어라' : '◆ 압박! 읽고 패스 · 커밋한 마커(주황)의 담당이 열린다') : '▶ 흐름 — 탭하면 즉시 패스(빠른 콤비)', 30, 18);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fbbf24';
    ctx.fillText(`압박 강도: ${I().name}`, canvas.width / 2, 18);
    ctx.textAlign = 'right'; ctx.fillStyle = S.manualSlow ? '#a7f3d0' : 'rgba(150,150,150,0.5)';
    ctx.fillText(S.manualSlow ? '[Space] 수동 슬로우 ●' : '[Space] 소진', canvas.width - 30, 18);
    ctx.fillStyle = 'rgba(200,220,210,0.55)';
    ctx.fillText(`패스 ${S.stats.passes} · 빠름 ${S.stats.fast} · 슬로우 ${S.stats.slow}`, canvas.width - 30, canvas.height - 12);
    if (S.status === 'flash' && S.flash) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center'; ctx.font = 'bold 34px system-ui';
      ctx.fillStyle = S.flash.good ? '#4ade80' : '#f87171';
      ctx.fillText(S.flash.msg, canvas.width / 2, canvas.height / 2);
    }
  }

  // ── 입력 ─────────────────────────────────────────────────────────────
  function pickTeammate(mx, my) {
    const px = (mx - MARGIN) / scale, py = (my - MARGIN) / scale;
    let best = null, bd = Infinity;
    for (const t of teammates()) {
      if (isOffside(t)) continue;                 // 오프사이드는 못 고름
      const d = Math.hypot(t.x - px, t.y - py);
      if (d < bd) { bd = d; best = t; }
    }
    return bd < 9 ? best : null;
  }
  canvas.addEventListener('click', (e) => {
    if (!S || S.status !== 'live' || S.ball.inFlight) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const t = pickTeammate(mx, my);
    if (t) pass(t.id, S.mode === 'slow');
  });
  window.addEventListener('keydown', (e) => {
    if (!S) return;
    if (e.code === 'Space') { e.preventDefault(); if (S.status === 'live' && S.manualSlow && !S.ball.inFlight) enterSlow(true); }
    if (e.key === 'r' || e.key === 'R') reset();
  });

  reset();
  let last = performance.now();
  function loop(ts) { const dt = Math.min(0.05, (ts - last) / 1000); last = ts; frame(dt); draw(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  const api = { reset, state: () => S, pass: (id, s) => pass(id, s), setIntensity: (k) => { if (INTENSITY[k]) intensityKey = k; }, _tick: (dt) => frame(dt), _draw: () => draw() };
  if (typeof window !== 'undefined') window.__rt = api;
  return api;
}
