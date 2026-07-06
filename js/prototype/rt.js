// 실시간 빌드업 프로토타입 v4 — 정식 엔진 통합(Path B).
// (prototype.html이 로드.)
//
// v3까지는 실시간 껍데기가 위험/오프사이드/유인을 crude하게 '재구현'했다.
// v4는 진짜 엔진(js/engine)을 백엔드로 삼는다:
//   · 엔티티 = 엔진 선수(실제 id·traits·markId·scheme). 클럽 업그레이드가 traits로
//     반영되면 여기 위험에도 그대로 반영된다(mods 글루 사고방식).
//   · 위험색 레인·오프사이드 = engine.preview('to_feet',id) — 8라운드로 다진 그
//     evaluateLane(오리엔테이션·trap·전술배율·shadowed) 실제값.
//   · 유인 감지 = engine.previewBait(). 게다가 마커가 커밋(볼로 이동)하면 그 담당의
//     레인 위험이 엔진 모델에서 자동으로 낮아져 — 3자 패스가 '안전한 전진'으로
//     떠오른다(유인 콤비가 위험 모델에서 창발).
// 실시간 껍데기가 담당하는 것: 움직임(캐리·블록·오프볼)·슬로우 타이밍·입력.

import { createEngine } from '../engine/engine.js';
import { getScenario } from '../data/scenarios.js';

const PITCH = { w: 105, h: 68 };
const TACKLE_DIST = 1.3;
const CARRY_SPEED = 3.4;
const SUPPORT_SPEED = 3.2;
const BALL_SPEED = 22;
const SHOOT_X = 88;
const SLOW_BAND = 6.0;

const APPROACH = {
  highpress: { name: '하이프레스(강팀)', lineX: 52, close: 5.2, engage: 17, press: true,  drop: 0.35 },
  mid:       { name: '미드블록',        lineX: 66, close: 4.6, engage: 13, press: true,  drop: 0.25 },
  lowblock:  { name: '로우블록(약팀)',   lineX: 80, close: 4.0, engage: 8,  press: false, drop: 0.15 },
};

// 후방 빌드아웃 위치(엔진 us id → 좌표).
const BUILD = {
  'us-gk': [6, 34], 'us-lcb': [15, 22], 'us-rcb': [15, 46], 'us-lb': [28, 8], 'us-rb': [28, 60],
  'us-6': [22, 34], 'us-l8': [40, 26], 'us-r8': [40, 42], 'us-lw': [56, 12], 'us-rw': [56, 56], 'us-st': [60, 34],
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clampY = (y) => Math.max(5, Math.min(PITCH.h - 5, y));

export function createRT(canvas) {
  const ctx = canvas.getContext('2d');
  const MARGIN = 28;
  const scale = (canvas.width - MARGIN * 2) / PITCH.w;
  const sx = (x) => MARGIN + x * scale, sy = (y) => MARGIN + y * scale;

  let S = null, approachKey = 'highpress', engine = null;
  const A = () => APPROACH[approachKey];

  function unitX(o) {
    const line = A().lineX + Math.max(0, (S.ball.x - 38)) * A().drop;
    return o.unit === 'front' ? line - 22 : o.unit === 'mid' ? line - 11 : line;
  }
  function slotHome(o) { return { x: unitX(o), y: clampY(o.lane + (S.ball.y - 34) * 0.35) }; }

  function reset() {
    engine = createEngine(getScenario('B1'), (Date.now() % 2147483000) + 1, { baitCombo: true, defenseEntry: 'reset' });
    const P = engine.state.players;
    const us = P.filter((p) => p.side === 'us'), opp = P.filter((p) => p.side === 'opp');
    // 우리 — 빌드아웃 위치
    for (const p of us) { const b = BUILD[p.id] || [p.x, p.y]; p.x = b[0]; p.y = b[1]; p.hx = b[0]; p.hy = b[1]; }
    // 상대 — 라인별 블록 슬롯(front/mid/back), y-order로 레인 배정
    for (const grp of ['front', 'mid', 'back']) {
      const line = opp.filter((o) => o.line === grp).sort((a, b) => a.y - b.y);
      const n = line.length;
      line.forEach((o, i) => { o.unit = grp; o.lane = n > 1 ? 9 + i * (50 / (n - 1)) : 34; });
    }
    const gk = opp.find((o) => o.line === 'gk'); if (gk) { gk.unit = 'gk'; gk.lane = 34; gk.x = 99; gk.y = 34; }
    engine.state.holderId = 'us-gk';
    S = {
      us, opp, ball: { x: 6, y: 34, inFlight: null },
      mode: 'flow', timeScale: 1, targetScale: 1, cooldown: 0,
      manualSlow: true, manualActive: 0, presserId: null,
      status: 'live', flash: null, flashT: 0, stats: { passes: 0, fast: 0, slow: 0 }, baitOn: false,
    };
    S.ball.x = holder().x; S.ball.y = holder().y;
    // S.ball 준비된 뒤 상대 블록 배치(slotHome이 S.ball 참조).
    for (const o of opp) { if (o.unit === 'gk') continue; const hm = slotHome(o); o.x = hm.x; o.y = hm.y; o.hx = hm.x; o.hy = hm.y; }
  }

  const holder = () => engine.holder();
  const holderId = () => engine.state.holderId;
  const oppOut = () => S.opp.filter((p) => p.role !== 'GK');
  const teammates = () => S.us.filter((p) => p.id !== holderId() && p.role !== 'GK');
  const byId = (id) => engine.state.players.find((p) => p.id === id);
  const holderIsGK = () => holder()?.role === 'GK';

  function offsideLine() { const xs = S.opp.map((o) => o.x).sort((a, b) => b - a); return xs[1] ?? PITCH.w; }

  // ── 엔진 위험/오프사이드 조회 ─────────────────────────────────────────
  function setHolderOrientation() {
    // 엔진 오리엔테이션 문법 근사 — 골side(높은 x) 압박 근접이면 BACK/HALF(전방 패스 위험↑).
    const h = holder(); if (!h) return;
    let nd = Infinity;
    for (const o of oppOut()) { if (o.x > h.x - 1) nd = Math.min(nd, dist(o, h)); }
    h.orientation = nd < 3.5 ? 'BACK' : nd < 5.5 ? 'HALF' : 'FACING';
  }
  function previewLane(t) {
    // 엔진 preview → 실제 튜닝 위험 + 오프사이드 판정.
    const pv = engine.preview('to_feet', t.id);
    if (!pv || !pv.lane) return { risk: 0.9, offside: false };
    return { risk: pv.lane.risk ?? 0.9, offside: pv.lane.status === 'offside' };
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
    // 압박수 = 라인 불문 볼 최근접 1명(엔게이지 안). 1선을 뚫으면 미드가, 그 다음 백이
    // 스텝업해 항상 누군가 압박한다(전방 한정이면 뚫린 뒤 무저항 통과 버그).
    let presser = null, pd = Infinity;
    for (const o of oppOut()) { const d = dist(o, S.ball); if (d < pd) { pd = d; presser = o; } }
    S.presserId = (presser && pd <= ap.engage && (ap.press || pd < 8)) ? presser.id : null;

    if (!S.ball.inFlight && h && !holderIsGK()) {
      const t = carryTarget(h); moveToward(h, t.x, t.y, CARRY_SPEED, dt);
      S.ball.x = h.x; S.ball.y = h.y;
    }
    setHolderOrientation();

    for (const o of oppOut()) {
      if (o.id === S.presserId) { moveToward(o, S.ball.x, S.ball.y, ap.close, dt); continue; }
      const home = slotHome(o);
      let tx = home.x, ty = home.y, near = null, nd = 4.0;
      for (const u of teammates()) { const d = dist(u, o); if (d < nd) { nd = d; near = u; } }
      if (near) { tx = home.x * 0.55 + (near.x + 1.5) * 0.45; ty = home.y * 0.55 + near.y * 0.45; }
      moveToward(o, tx, clampY(ty), ap.close * 0.8, dt);
    }

    const line = offsideLine();
    for (const p of teammates()) {
      const presserP = S.presserId ? byId(S.presserId) : null;
      const zoneOpen = presserP && dist(presserP, p) > 7 && p.x > S.ball.x - 4 && p.x < line - 2;
      let aimX, aimY;
      if (zoneOpen) { aimX = Math.min(S.ball.x + 12, line - 1.5); aimY = clampY(p.hy + (S.ball.y - p.hy) * 0.2); }
      else { aimX = p.x + 2 + Math.max(0, S.ball.x - p.x) * 0.22; aimY = p.hy; }
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
      engine.state.holderId = f.targetId; b.x = holder().x; b.y = holder().y; S.cooldown = 0.35;
      if (holder().x >= SHOOT_X) flashResult('마무리 기회! ⚽', true);
      return;
    }
    b.x = f.from.x + (f.to.x - f.from.x) * f.t; b.y = f.from.y + (f.to.y - f.from.y) * f.t;
  }

  function pass(targetId, wasSlow) {
    const h = holder(), tgt = byId(targetId);
    if (!h || !tgt || S.ball.inFlight) return;
    const { risk: baseRisk, offside } = previewLane(tgt);
    if (offside) return;                                   // 엔진 오프사이드 — 못 준다
    const risk = baseRisk * (wasSlow ? 0.6 : 1);
    const intercepted = Math.random() < risk;
    let to = { x: tgt.x, y: tgt.y };
    if (intercepted) {
      let best = null, bd = Infinity;
      for (const o of oppOut()) { const d = distToSeg(o, h, tgt); if (d < bd) { bd = d; best = o; } }
      if (best) to = { x: best.x, y: best.y };
    }
    const d = Math.hypot(to.x - h.x, to.y - h.y);
    S.ball.inFlight = { from: { x: h.x, y: h.y }, to, t: 0, dur: Math.max(0.16, d / BALL_SPEED), targetId, intercepted };
    S.stats.passes++; wasSlow ? S.stats.slow++ : S.stats.fast++;
    exitSlow();
  }
  function distToSeg(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy || 1;
    let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
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
    S.baitOn = !!engine.previewBait?.();          // 엔진 유인 감지
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
    if (!S) return;
    drawPitch();
    const h = holder(), line = offsideLine();
    const backs = S.opp.filter((o) => o.unit === 'back').sort((a, b) => a.y - b.y);
    if (backs.length) {
      ctx.strokeStyle = 'rgba(220,60,60,0.25)'; ctx.lineWidth = 1.5; ctx.beginPath();
      backs.forEach((o, i) => (i ? ctx.lineTo(sx(o.x), sy(o.y)) : ctx.moveTo(sx(o.x), sy(o.y)))); ctx.stroke();
    }
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
        const { risk, offside } = previewLane(t);
        if (offside) continue;
        ctx.strokeStyle = riskColor(risk); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(sx(t.x), sy(t.y), 16, 0, 7); ctx.stroke();
        ctx.globalAlpha = 0.22; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx(h.x), sy(h.y)); ctx.lineTo(sx(t.x), sy(t.y)); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    if (S.ball.inFlight) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx(S.ball.inFlight.from.x), sy(S.ball.inFlight.from.y)); ctx.lineTo(sx(S.ball.x), sy(S.ball.y)); ctx.stroke();
    }
    for (const p of engine.state.players) {
      const isH = p.id === holderId(), isPress = p.id === S.presserId;
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 11, 0, 7);
      ctx.fillStyle = p.side === 'us' ? (isH ? '#60a5fa' : '#2563eb') : '#dc2626';
      if (p.role === 'GK') ctx.fillStyle = p.side === 'us' ? '#1e3a5f' : '#5f1e1e';
      ctx.fill();
      if (isH) { ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 3; ctx.stroke(); }
      if (isPress) { ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 2.5; ctx.stroke(); }
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
    const slowMsg = S.baitOn ? '◆ 유인 성립! 커밋한 마커 뒤 3자로 릴리스(초록)' : (S.manualActive ? '◆ 수동 슬로우 — 침착하게' : '◆ 압박! 읽고 패스');
    ctx.fillText(holderIsGK() ? '● GK 후방 방출 — CB에게 연결해 빌드업 시작' : (S.mode === 'slow' ? slowMsg : '▶ 흐름 — 탭하면 즉시 패스(빠른 콤비)'), 30, 18);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fbbf24'; ctx.fillText(`상대: ${A().name} · 위험=엔진 실측`, canvas.width / 2, 18);
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
    for (const t of teammates()) { if (previewLane(t).offside) continue; const d = Math.hypot(t.x - px, t.y - py); if (d < bd) { bd = d; best = t; } }
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
  const api = { reset, state: () => S, engine: () => engine, setApproach: (k) => { if (APPROACH[k]) { approachKey = k; reset(); } }, _tick: (dt) => frame(dt), _draw: () => draw() };
  if (typeof window !== 'undefined') window.__rt = api;
  return api;
}
