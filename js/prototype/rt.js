// 실시간 빌드업 프로토타입 v3 — 시작 상황에서 파생된 '뿌리내린' 대형.
// (정식 엔진과 독립. prototype.html이 로드.)
//
// v3 핵심(사용자 지적: "근본 없는 대형"):
//   대형은 시작 상황에서 파생돼야 한다 — 여기선 'GK 후방 방출'을 모델링.
//   · 우리: 후방에서 낮게 벌린 빌드아웃 셰이프. GK가 볼을 잡고 방출 시작.
//   · 상대: '각자 드리프트'가 아니라 라인·컴팩트니스를 가진 구조적 블록.
//     접근법(강팀/약팀)에 따라 블록 높이가 다르다:
//       하이프레스(강팀) — 우리 진영으로 올라와 압박. 백라인 높음 → 뒷공간 큼.
//       미드블록        — 하프라인 근처 컴팩트.
//       로우블록(약팀)   — 자기 진영에 내려앉음. 우리는 자유 빌드, 대신 벽을 마주.
//   · 블록은 볼 y로 시프트(컴팩트·볼side), 우리가 뚫고 전진하면 뒤로 스텝다운.
//   · 전방 라인의 볼 최근접 1명이 압박수로 '커밋'(유인 성립) — 나머지는 블록 유지.
//   · 오프사이드 라인 = 블록 백라인. 우리 선수 온사이드 유지.

const PITCH = { w: 105, h: 68 };
const TACKLE_DIST = 1.3;
const CARRY_SPEED = 3.4;
const SUPPORT_SPEED = 3.2;
const BALL_SPEED = 22;
const SHOOT_X = 88;
const SLOW_BAND = 6.0;

// 상대 접근법 = 블록 높이 + 공격성. lineX = 백라인 기준 x(낮을수록 올라온 압박).
const APPROACH = {
  highpress: { name: '하이프레스(강팀)', lineX: 52, close: 5.2, engage: 17, press: true,  drop: 0.35 },
  mid:       { name: '미드블록',        lineX: 66, close: 4.6, engage: 13, press: true,  drop: 0.25 },
  lowblock:  { name: '로우블록(약팀)',   lineX: 80, close: 4.0, engage: 8,  press: false, drop: 0.15 },
};

function mk(id, side, role, x, y, unit, lane) {
  return { id, side, role, x, y, hx: x, hy: y, r: 11, unit, lane };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clampY = (y) => Math.max(5, Math.min(PITCH.h - 5, y));
function pointToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy || 1;
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function freshTeams() {
  // 우리 — 후방 빌드아웃 셰이프(GK가 볼 잡고 방출).
  const us = [
    mk('gk', 'us', 'GK', 6, 34), mk('lcb', 'us', 'CB', 15, 22), mk('rcb', 'us', 'CB', 15, 46),
    mk('lb', 'us', 'LB', 28, 8), mk('rb', 'us', 'RB', 28, 60), mk('dm', 'us', '6', 22, 34),
    mk('l8', 'us', '8', 40, 26), mk('r8', 'us', '8', 40, 42),
    mk('lw', 'us', 'LW', 56, 12), mk('rw', 'us', 'RW', 56, 56), mk('st', 'us', 'ST', 60, 34),
  ];
  // 상대 — 구조적 블록(front/mid/back 라인 + y레인). x는 접근법에 따라 배치(reset에서).
  const opp = [
    mk('of1', 'opp', 'F', 0, 20, 'front', 20), mk('of2', 'opp', 'F', 0, 48, 'front', 48), mk('of3', 'opp', 'F', 0, 34, 'front', 34),
    mk('om1', 'opp', 'M', 0, 15, 'mid', 15), mk('om2', 'opp', 'M', 0, 53, 'mid', 53), mk('om3', 'opp', 'M', 0, 34, 'mid', 34),
    mk('ob1', 'opp', 'B', 0, 13, 'back', 13), mk('ob2', 'opp', 'B', 0, 28, 'back', 28),
    mk('ob3', 'opp', 'B', 0, 42, 'back', 42), mk('owb', 'opp', 'B', 0, 57, 'back', 57),
    mk('ogk', 'opp', 'GK', 99, 34, 'gk', 34),
  ];
  return { us, opp };
}

export function createRT(canvas) {
  const ctx = canvas.getContext('2d');
  const MARGIN = 28;
  const scale = (canvas.width - MARGIN * 2) / PITCH.w;
  const sx = (x) => MARGIN + x * scale, sy = (y) => MARGIN + y * scale;

  let S = null, approachKey = 'highpress';
  const A = () => APPROACH[approachKey];

  // 블록 슬롯 홈 = 접근법 라인 + 유닛 오프셋, 볼 y로 시프트, 볼 전진 시 스텝다운.
  function unitX(o) {
    const line = A().lineX + Math.max(0, (S.ball.x - 38)) * A().drop;   // 뚫리면 물러섬
    return o.unit === 'front' ? line - 22 : o.unit === 'mid' ? line - 11 : line;
  }
  function slotHome(o) {
    const ballShift = (S.ball.y - 34) * 0.35;                          // 컴팩트·볼side
    return { x: unitX(o), y: clampY(o.lane + ballShift) };
  }

  function reset() {
    const { us, opp } = freshTeams();
    S = {
      us, opp, all: [...us, ...opp], holderId: 'gk',
      ball: { x: 6, y: 34, inFlight: null },
      mode: 'flow', timeScale: 1, targetScale: 1, cooldown: 0,
      manualSlow: true, manualActive: 0, presserId: null,
      status: 'live', flash: null, flashT: 0, started: false,
      stats: { passes: 0, fast: 0, slow: 0 },
    };
    // 상대를 슬롯 홈으로 스냅
    for (const o of opp) { if (o.role === 'GK') continue; const h = slotHome(o); o.x = h.x; o.y = h.y; o.hx = h.x; o.hy = h.y; }
    S.ball.x = holder().x; S.ball.y = holder().y;
  }
  const holder = () => S.all.find((p) => p.id === S.holderId);
  const oppOut = () => S.opp.filter((p) => p.role !== 'GK');
  const teammates = () => S.us.filter((p) => p.id !== S.holderId && p.role !== 'GK');
  const byId = (id) => S.all.find((p) => p.id === id);
  const holderIsGK = () => holder()?.role === 'GK';

  function offsideLine() { const xs = S.opp.map((o) => o.x).sort((a, b) => b - a); return xs[1] ?? PITCH.w; }
  function isOffside(p) { const line = offsideLine(); return p.x > line && p.x > S.ball.x + 0.3; }

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
    const h = holder(), ap = A();
    // 압박수 = 전방 라인 중 볼 최근접, engage 안(로우블록은 아주 가까울 때만). 커밋=유인.
    let presser = null, pd = Infinity;
    for (const o of oppOut()) { if (o.unit !== 'front') continue; const d = dist(o, S.ball); if (d < pd) { pd = d; presser = o; } }
    const engaged = presser && pd <= ap.engage && (ap.press || pd < 7);
    S.presserId = engaged ? presser.id : null;

    // 홀더 캐리 — 단, GK는 방출 대기(캐리 안 함).
    if (!S.ball.inFlight && h && !holderIsGK()) {
      const t = carryTarget(h);
      moveToward(h, t.x, t.y, CARRY_SPEED, dt);
      S.ball.x = h.x; S.ball.y = h.y;
      S.started = true;
    }

    // 상대 — 블록 유지(슬롯 홈으로), 압박수만 볼로 커밋. 근처 러너 가벼운 픽업.
    for (const o of oppOut()) {
      if (o.id === S.presserId) { moveToward(o, S.ball.x, S.ball.y, ap.close, dt); continue; }
      const home = slotHome(o);
      // 근처(4m내) 우리 선수 있으면 살짝 붙어 픽업(블록 안에서), 아니면 슬롯 유지.
      let tx = home.x, ty = home.y;
      let near = null, nd = 4.0;
      for (const u of teammates()) { const d = dist(u, o); if (d < nd) { nd = d; near = u; } }
      if (near) { tx = (home.x * 0.55 + (near.x + 1.5) * 0.45); ty = (home.y * 0.55 + near.y * 0.45); }
      moveToward(o, tx, clampY(ty), ap.close * 0.8, dt);
    }

    // 우리 오프볼 — 각 제공/온사이드, 압박수가 커밋해 생긴 존을 3자로 파고든다.
    const line = offsideLine();
    for (const p of teammates()) {
      // 내 근처 존을 압박수가 비웠나(압박수가 볼로 나가며 내 지역이 열림)
      const presserP = S.presserId ? byId(S.presserId) : null;
      const zoneOpen = presserP && dist(presserP, p) > 7 && p.x > S.ball.x - 4 && p.x < line - 2;
      let aimX, aimY;
      if (zoneOpen) {
        aimX = Math.min(S.ball.x + 12, line - 1.5);          // 뒷공간 온사이드로 파고듦
        aimY = clampY(p.hy + (S.ball.y - p.hy) * 0.2);
      } else {
        aimX = p.x + 2 + Math.max(0, S.ball.x - p.x) * 0.22;  // 볼 전진에 맞춰 각 유지
        aimY = p.hy;
      }
      if (aimX > S.ball.x) aimX = Math.min(aimX, line - 0.5); // 온사이드
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
    b.x = f.from.x + (f.to.x - f.from.x) * f.t; b.y = f.from.y + (f.to.y - f.from.y) * f.t;
  }

  function pass(targetId, wasSlow) {
    const h = holder(), tgt = byId(targetId);
    if (!h || !tgt || S.ball.inFlight || isOffside(tgt)) return;
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

  function enterSlow(manual) { if (S.mode === 'slow') return; S.mode = 'slow'; S.targetScale = 0.12; if (manual) { S.manualSlow = false; S.manualActive = 1; } }
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
    if (h && !S.ball.inFlight && !holderIsGK()) {
      let nd = Infinity; for (const o of oppOut()) nd = Math.min(nd, dist(o, h));
      if (nd < TACKLE_DIST) return flashResult('태클 당함 — 볼 상실', false);
      if (S.mode === 'flow' && S.cooldown <= 0 && nd < SLOW_BAND) enterSlow(false);
      if (S.mode === 'slow' && !S.manualActive && nd > SLOW_BAND + 1.5) exitSlow();
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
    ctx.strokeStyle = 'rgba(80,200,140,0.16)'; ctx.beginPath(); ctx.moveTo(sx(SHOOT_X), sy(2)); ctx.lineTo(sx(SHOOT_X), sy(66)); ctx.stroke();
  }
  const riskColor = (r) => (r < 0.33 ? '#22c55e' : r < 0.6 ? '#eab308' : '#ef4444');

  function draw() {
    drawPitch();
    const h = holder(), line = offsideLine();
    // 블록 라인 연결(back 4) — 형태 가시화
    const backs = S.opp.filter((o) => o.unit === 'back').sort((a, b) => a.y - b.y);
    if (backs.length) {
      ctx.strokeStyle = 'rgba(220,60,60,0.25)'; ctx.lineWidth = 1.5; ctx.beginPath();
      backs.forEach((o, i) => (i ? ctx.lineTo(sx(o.x), sy(o.y)) : ctx.moveTo(sx(o.x), sy(o.y))));
      ctx.stroke();
    }
    // 오프사이드 라인
    ctx.strokeStyle = 'rgba(248,113,113,0.35)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx(line), sy(2)); ctx.lineTo(sx(line), sy(66)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(248,113,113,0.5)'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('오프사이드', sx(line), sy(66) + 12);

    const showOpts = (S.mode === 'slow' || holderIsGK()) && h;
    if (showOpts) {
      if (S.mode === 'slow') {
        ctx.strokeStyle = 'rgba(96,165,250,0.35)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx(h.x), sy(h.y), SLOW_BAND * scale, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      }
      for (const t of teammates()) {
        if (t.x < h.x - 8 && !holderIsGK()) continue;
        if (isOffside(t)) continue;
        const r = laneRisk(h, t);
        ctx.strokeStyle = riskColor(r); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(sx(t.x), sy(t.y), 16, 0, 7); ctx.stroke();
        ctx.globalAlpha = 0.22; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx(h.x), sy(h.y)); ctx.lineTo(sx(t.x), sy(t.y)); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    if (S.ball.inFlight) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx(S.ball.inFlight.from.x), sy(S.ball.inFlight.from.y)); ctx.lineTo(sx(S.ball.x), sy(S.ball.y)); ctx.stroke();
    }
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
    ctx.beginPath(); ctx.arc(sx(S.ball.x), sy(S.ball.y), 5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
    if (S.timeScale < 0.7) {
      const a = (0.7 - S.timeScale) * 0.5;
      const rg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.3, canvas.width / 2, canvas.height / 2, canvas.height * 0.75);
      rg.addColorStop(0, 'rgba(10,20,40,0)'); rg.addColorStop(1, `rgba(10,20,40,${a})`);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.textAlign = 'left'; ctx.font = '13px system-ui';
    ctx.fillStyle = holderIsGK() ? '#a7f3d0' : (S.mode === 'slow' ? '#93c5fd' : 'rgba(200,220,210,0.7)');
    ctx.fillText(holderIsGK() ? '● GK 후방 방출 — CB에게 연결해 빌드업 시작' : (S.mode === 'slow' ? (S.manualActive ? '◆ 수동 슬로우 — 침착하게' : '◆ 압박! 읽고 패스 · 커밋한 압박수(주황) 뒤 존이 열린다') : '▶ 흐름 — 탭하면 즉시 패스(빠른 콤비)'), 30, 18);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fbbf24'; ctx.fillText(`상대: ${A().name}`, canvas.width / 2, 18);
    ctx.textAlign = 'right'; ctx.fillStyle = S.manualSlow ? '#a7f3d0' : 'rgba(150,150,150,0.5)';
    ctx.fillText(S.manualSlow ? '[Space] 수동 슬로우 ●' : '[Space] 소진', canvas.width - 30, 18);
    ctx.fillStyle = 'rgba(200,220,210,0.55)'; ctx.fillText(`패스 ${S.stats.passes} · 빠름 ${S.stats.fast} · 슬로우 ${S.stats.slow}`, canvas.width - 30, canvas.height - 12);
    if (S.status === 'flash' && S.flash) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center'; ctx.font = 'bold 34px system-ui'; ctx.fillStyle = S.flash.good ? '#4ade80' : '#f87171';
      ctx.fillText(S.flash.msg, canvas.width / 2, canvas.height / 2);
    }
  }

  function pickTeammate(mx, my) {
    const px = (mx - MARGIN) / scale, py = (my - MARGIN) / scale;
    let best = null, bd = Infinity;
    for (const t of teammates()) { if (isOffside(t)) continue; const d = Math.hypot(t.x - px, t.y - py); if (d < bd) { bd = d; best = t; } }
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
    if (e.code === 'Space') { e.preventDefault(); if (S.status === 'live' && S.manualSlow && !S.ball.inFlight && !holderIsGK()) enterSlow(true); }
    if (e.key === 'r' || e.key === 'R') reset();
  });

  reset();
  let last = performance.now();
  function loop(ts) { const dt = Math.min(0.05, (ts - last) / 1000); last = ts; frame(dt); draw(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  const api = { reset, state: () => S, pass: (id, s) => pass(id, s), setApproach: (k) => { if (APPROACH[k]) { approachKey = k; reset(); } }, _tick: (dt) => frame(dt), _draw: () => draw() };
  if (typeof window !== 'undefined') window.__rt = api;
  return api;
}
