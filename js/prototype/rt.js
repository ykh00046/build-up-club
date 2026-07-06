// 실시간 빌드업 프로토타입 — 느낌 검증 전용(기존 엔진과 독립).
//
// 검증 질문 2개:
//   ① 자동캐리 → 근접슬로우 → 결정(패스) → 다시 캐리, 이 리듬이 좋은가?
//   ② 슬로우 없이 원터치로 패스했을 때(빠른 콤비) 짜릿한가?
//
// 설계(사용자 결정):
//   - 볼 잡은 선수는 '느리게 전방 캐리'가 기본(자동).
//   - 상대가 도발 밴드로 다가오면 자동으로 슬로우 → 결정.
//   - 패스하면 다시 기본 캐리로. 수신자가 이어받아 캐리.
//   - 슬로우 안 해도(=flow 중에도) 팀원 탭하면 즉시 패스 = 빠른 콤비 템포.
//   - 수동 슬로우 1회(침착하게 읽기). 압박은 슬로우 중에도 계속 좁혀온다(무한정 X).
//   - 슬로우=정확·안전(레인 읽고 고름), 빠름=속도·위험(트래픽으로 쏘면 잘림).

const PITCH = { w: 105, h: 68 };
const SLOW_BAND = 6.0;      // 이 거리 안으로 압박 붙으면 자동 슬로우
const TACKLE_DIST = 1.3;    // 이 거리까지 붙으면 태클(볼 상실)
const INTERCEPT_DIST = 1.9; // 패스 비행 중 수비수가 이 거리면 차단
const CARRY_SPEED = 3.4;    // m/s — 느린 캐리
const PURSUE_SPEED = 4.5;   // m/s — 추격(캐리보다 빨라 서서히 좁혀온다)
const SUPPORT_SPEED = 3.0;
const BALL_SPEED = 22;      // m/s
const SHOOT_X = 88;         // 여기 넘어 캐리/수신하면 마무리 기회

function mk(id, side, role, x, y) { return { id, side, role, x, y, hx: x, hy: y, r: 11 }; }

function freshTeams() {
  const us = [
    mk('gk', 'us', 'GK', 6, 34),
    mk('lcb', 'us', 'CB', 18, 26),
    mk('rcb', 'us', 'CB', 18, 42),
    mk('lb', 'us', 'LB', 26, 10),
    mk('rb', 'us', 'RB', 26, 58),
    mk('dm', 'us', '6', 34, 34),
    mk('l8', 'us', '8', 46, 24),
    mk('r8', 'us', '8', 46, 44),
    mk('lw', 'us', 'LW', 62, 12),
    mk('rw', 'us', 'RW', 62, 56),
    mk('st', 'us', 'ST', 66, 34),
  ];
  const opp = [
    mk('of1', 'opp', 'F', 50, 28),
    mk('of2', 'opp', 'F', 52, 40),
    mk('of3', 'opp', 'F', 56, 34),
    mk('om1', 'opp', 'M', 64, 20),
    mk('om2', 'opp', 'M', 64, 48),
    mk('om3', 'opp', 'M', 68, 34),
    mk('ob1', 'opp', 'B', 78, 26),
    mk('ob2', 'opp', 'B', 78, 42),
    mk('ob3', 'opp', 'B', 84, 34),
    mk('owb', 'opp', 'B', 74, 12),
    mk('ogk', 'opp', 'GK', 99, 34),
  ];
  return { us, opp };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pointToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export function createRT(canvas) {
  const ctx = canvas.getContext('2d');
  const MARGIN = 28;
  const scale = (canvas.width - MARGIN * 2) / PITCH.w;
  const sx = (x) => MARGIN + x * scale;
  const sy = (y) => MARGIN + y * scale;

  let S = null;
  function reset(msg) {
    const { us, opp } = freshTeams();
    S = {
      us, opp, all: [...us, ...opp],
      holderId: 'lcb',
      ball: { x: 18, y: 26, inFlight: null }, // inFlight: {from,to,t,dur,targetId,intercepted}
      mode: 'flow',                 // 'flow' | 'slow'
      timeScale: 1, targetScale: 1,
      cooldown: 0,                  // 패스 직후 재슬로우 방지
      manualSlow: true,             // 수동 슬로우 1회 가용
      manualActive: 0,
      status: 'live',               // 'live' | 'flash'
      flash: msg || null, flashT: 0,
      hover: null,
      stats: { passes: 0, fast: 0, slow: 0 },
    };
    S.ball.x = holder().x; S.ball.y = holder().y;
  }
  const holder = () => S.all.find((p) => p.id === S.holderId);
  const teammates = () => S.us.filter((p) => p.id !== S.holderId && p.role !== 'GK');
  const opps = () => S.opp.filter((p) => p.role !== 'GK');
  const nearestOpp = (p) => opps().reduce((a, o) => (dist(o, p) < dist(a, p) ? o : a), opps()[0]);

  function laneRisk(from, to) {
    let min = Infinity;
    for (const o of opps()) min = Math.min(min, pointToSeg(o, from, to));
    // 3m 이하=위험, 6m 이상=안전
    return Math.max(0, Math.min(1, 1 - (min - 2) / 5));
  }

  // ── 이동 로직 ────────────────────────────────────────────────────────
  function moveToward(p, tx, ty, speed, dt) {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, speed * dt);
    p.x += dx / d * step; p.y += dy / d * step;
  }

  function carryTarget(h) {
    // 전방(+x)으로, 가장 가까운 압박에서 측면으로 살짝 피하며, 열린 플랭크로.
    const no = nearestOpp(h);
    let ty = h.y;
    if (no) {
      const away = h.y - no.y;                       // 압박 반대편으로
      ty += Math.sign(away || 1) * 4;
    }
    ty = Math.max(6, Math.min(PITCH.h - 6, ty));
    return { x: Math.min(h.x + 12, PITCH.w - 4), y: ty };
  }

  function updatePlayers(dt) {
    const h = holder();
    // 홀더 캐리(볼 비행 중이 아닐 때만)
    if (!S.ball.inFlight && h) {
      const t = carryTarget(h);
      moveToward(h, t.x, t.y, CARRY_SPEED, dt);
      S.ball.x = h.x; S.ball.y = h.y;
    }
    // 우리 off-ball: 볼 전진에 맞춰 대형 전진(홈 + 볼 x 기반 오프셋) — 패스 각 제공.
    const ballX = S.ball.x;
    for (const p of S.us) {
      if (p.id === S.holderId || p.role === 'GK') continue;
      const fwd = Math.max(0, ballX - 18) * 0.5;
      moveToward(p, Math.min(p.hx + fwd, PITCH.w - 6), p.hy, SUPPORT_SPEED, dt);
    }
    // 상대: '커밋하는 압박수' 1명이 볼을 향해 나온다(스웜 대신 마커 1명 — 유인 대상).
    // 2번째는 절반 속도로 커버, 나머지는 볼 x에 맞춰 라인만 시프트(대형 유지).
    const sorted = [...opps()].sort((a, b) => dist(a, S.ball) - dist(b, S.ball));
    sorted.forEach((o, i) => {
      if (i === 0) moveToward(o, S.ball.x, S.ball.y, PURSUE_SPEED, dt);
      else if (i === 1) moveToward(o, S.ball.x, S.ball.y, PURSUE_SPEED * 0.55, dt);
      else moveToward(o, o.hx - Math.max(0, 45 - S.ball.x) * 0.25, o.hy, PURSUE_SPEED * 0.5, dt);
    });
  }

  function updateBall(dt) {
    const b = S.ball;
    if (!b.inFlight) return;
    const f = b.inFlight;
    f.t += dt / f.dur;
    if (f.t >= 1) {
      b.inFlight = null;
      if (f.intercepted) { turnover('가로채기 — 볼 상실'); return; }
      // 도착 → 수신자가 홀더
      S.holderId = f.targetId;
      b.x = holder().x; b.y = holder().y;
      S.cooldown = 0.35;                 // 재슬로우 짧게 방지
      if (holder().x >= SHOOT_X) flashResult('마무리 기회! ⚽', true);
      return;
    }
    // 비행 위치 보간
    b.x = f.from.x + (f.to.x - f.from.x) * f.t;
    b.y = f.from.y + (f.to.y - f.from.y) * f.t;
  }

  function pass(targetId, wasSlow) {
    const h = holder(); const tgt = S.us.find((p) => p.id === targetId);
    if (!h || !tgt || S.ball.inFlight) return;
    const risk = laneRisk(h, tgt) * (wasSlow ? 0.55 : 1);   // 슬로우=침착=더 안전
    const intercepted = Math.random() < risk;
    let to = { x: tgt.x, y: tgt.y };
    if (intercepted) {
      // 레인 최근접 수비수로 볼이 튄다(피드백)
      let best = null, bd = Infinity;
      for (const o of opps()) { const d = pointToSeg(o, h, tgt); if (d < bd) { bd = d; best = o; } }
      if (best) to = { x: best.x, y: best.y };
    }
    const d = Math.hypot(to.x - h.x, to.y - h.y);
    S.ball.inFlight = { from: { x: h.x, y: h.y }, to, t: 0, dur: Math.max(0.18, d / BALL_SPEED), targetId, intercepted };
    S.stats.passes++; wasSlow ? S.stats.slow++ : S.stats.fast++;
    exitSlow();
  }

  function enterSlow(manual) {
    if (S.mode === 'slow') return;
    S.mode = 'slow'; S.targetScale = 0.12;
    if (manual) { S.manualSlow = false; S.manualActive = 1; }
  }
  function exitSlow() { S.mode = 'flow'; S.targetScale = 1; S.manualActive = 0; }

  function turnover(msg) { flashResult(msg, false); }
  function flashResult(msg, good) {
    S.status = 'flash'; S.flash = { msg, good }; S.flashT = 0; exitSlow();
  }

  // ── 프레임 ───────────────────────────────────────────────────────────
  function frame(dtReal) {
    if (!S) return;
    // 타임스케일 부드럽게
    S.timeScale += (S.targetScale - S.timeScale) * Math.min(1, dtReal * 9);
    const dt = dtReal * S.timeScale;

    if (S.status === 'flash') {
      S.flashT += dtReal;
      if (S.flashT > 1.1) reset();
      return;
    }
    if (S.cooldown > 0) S.cooldown -= dtReal;

    updatePlayers(dt);
    updateBall(dt);

    const h = holder();
    if (h && !S.ball.inFlight) {
      const no = nearestOpp(h);
      const nd = no ? dist(no, h) : 99;
      // 태클(안 피하고 뭉개면 상실)
      if (nd < TACKLE_DIST) { turnover('태클 당함 — 볼 상실'); return; }
      // 자동 슬로우: 압박이 밴드로 들어오고 flow이며 쿨다운 지났을 때
      if (S.mode === 'flow' && S.cooldown <= 0 && nd < SLOW_BAND) enterSlow(false);
      // 슬로우인데 압박이 멀어지면(내가 캐리로 벗어남) 다시 flow
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
    for (const bx of [0, 105]) {
      const dir = bx === 0 ? 1 : -1;
      ctx.strokeRect(sx(bx === 0 ? 0 : 105 - 16.5), sy(13.8), 16.5 * scale, 40.3 * scale);
    }
    // 마무리 라인 힌트
    ctx.strokeStyle = 'rgba(80,200,140,0.18)';
    ctx.beginPath(); ctx.moveTo(sx(SHOOT_X), sy(2)); ctx.lineTo(sx(SHOOT_X), sy(66)); ctx.stroke();
  }

  function riskColor(r) { return r < 0.33 ? '#22c55e' : r < 0.6 ? '#eab308' : '#ef4444'; }

  function draw() {
    drawPitch();
    const h = holder();
    // 슬로우 중: 압박 밴드 + 패스 옵션(위험색) 표시
    if (S.mode === 'slow' && h) {
      ctx.strokeStyle = 'rgba(96,165,250,0.35)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx(h.x), sy(h.y), SLOW_BAND * scale, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      for (const t of teammates()) {
        if (t.x < h.x - 6) continue;                 // 전방·측면 옵션만
        const r = laneRisk(h, t);
        ctx.strokeStyle = riskColor(r); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(sx(t.x), sy(t.y), 16, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx(h.x), sy(h.y)); ctx.lineTo(sx(t.x), sy(t.y));
        ctx.strokeStyle = riskColor(r); ctx.globalAlpha = 0.25;
        ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    // 볼 비행 레인
    if (S.ball.inFlight) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx(S.ball.inFlight.from.x), sy(S.ball.inFlight.from.y));
      ctx.lineTo(sx(S.ball.x), sy(S.ball.y)); ctx.stroke();
    }
    // 선수
    for (const p of S.all) {
      const isH = p.id === S.holderId;
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r, 0, 7);
      ctx.fillStyle = p.side === 'us' ? (isH ? '#60a5fa' : '#2563eb') : '#dc2626';
      if (p.role === 'GK') ctx.fillStyle = p.side === 'us' ? '#1e3a5f' : '#5f1e1e';
      ctx.fill();
      if (isH) { ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 3; ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(p.role, sx(p.x), sy(p.y) + 3);
    }
    // 볼
    ctx.beginPath(); ctx.arc(sx(S.ball.x), sy(S.ball.y), 5, 0, 7);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
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
    ctx.fillText(S.mode === 'slow' ? (S.manualActive ? '◆ 수동 슬로우 — 침착하게 읽어라' : '◆ 압박! 읽고 패스') : '▶ 흐름 — 탭하면 즉시 패스(빠른 콤비)', 30, 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = S.manualSlow ? '#a7f3d0' : 'rgba(150,150,150,0.5)';
    ctx.fillText(S.manualSlow ? '[Space] 수동 슬로우 ●' : '[Space] 수동 슬로우 (소진)', canvas.width - 30, 18);
    ctx.fillStyle = 'rgba(200,220,210,0.55)'; ctx.textAlign = 'right';
    ctx.fillText(`패스 ${S.stats.passes} · 빠름 ${S.stats.fast} · 슬로우 ${S.stats.slow}`, canvas.width - 30, canvas.height - 12);
    // 플래시
    if (S.status === 'flash' && S.flash) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center'; ctx.font = 'bold 34px system-ui';
      ctx.fillStyle = S.flash.good ? '#4ade80' : '#f87171';
      ctx.fillText(S.flash.msg, canvas.width / 2, canvas.height / 2);
    }
  }

  // ── 입력 ─────────────────────────────────────────────────────────────
  function pickTeammate(mx, my) {
    // 캔버스 좌표 → 피치 좌표
    const px = (mx - MARGIN) / scale, py = (my - MARGIN) / scale;
    let best = null, bd = Infinity;
    for (const t of teammates()) {
      const d = Math.hypot(t.x - px, t.y - py);
      if (d < bd) { bd = d; best = t; }
    }
    return bd < 9 ? best : null;   // 관대한 탭 반경
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

  // ── 구동 ─────────────────────────────────────────────────────────────
  reset();
  let last = performance.now();
  function loop(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    frame(dt); draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  const api = { reset, state: () => S, pass: (id, slow) => pass(id, slow), _tick: (dt) => frame(dt), _draw: () => draw() };
  if (typeof window !== 'undefined') window.__rt = api;   // 튜닝·디버그 훅
  return api;
}
