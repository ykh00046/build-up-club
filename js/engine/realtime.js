// 실시간 압박 레이어 v2(2026-07) — "축구를 하는 느낌": 관성 움직임 + 역할 런.
//
// 계약: 엔진 '기존 파일'은 불변(이 모듈은 신규). DOM 무지 — engine만 받아 헤드리스
// 테스트 가능(scripts/realtime-press-test.mjs가 게이트). main.js가 매 프레임 호출.
//
// v2에서 현실감을 만드는 네 가지(전부 결정 대기 중에만):
//  · 관성 — 모든 실시간 이동이 가감속·도착 감속을 거친다(등속 슬라이드 제거).
//    속도 벡터(_vx/_vy)가 남아 방향 전환이 곡선이 되고, 렌더러가 이걸로 몸 방향
//    노치를 그린다.
//  · 역할 런 — 오프볼이 '오퍼'가 아니라 축구의 런을 뛴다: 풀백 오버랩(측면 질주),
//    윙어 폭 유지+라인 어깨, ST 체크런↔어깨런 교대, 8/6 라인 사이 포켓. 전부
//    턴 시작 위치(base) 앵커·역할별 상한·온사이드·동료 간격 유지.
//  · 수비 블록 호흡 — 압박수 아닌 상대는 base+볼사이드 셰이드로 유닛처럼 미끄러진다
//    (뭉침 드리프트 방지 겸).
//  · 기존 계약 유지 — 압박수 1명 조여옴(스탠드오프 3.8m=BACK 문턱 밖), GK 방출 여유,
//    홀더 드리프트(압박 5m 밖에서만), 결정 시계(게이지 경제 보조 세율, 100→auto-hold).

const STANDOFF = 3.8;
const paceMax = (p, base) => base * (0.6 + (p.traits?.pace ?? 0.6) * 0.6);
function sync(p) { p.rx = p.tx = p.fx = p.x; p.ry = p.ty = p.fy = p.y; }

// 시계 속도(/ms) — 3초 체류 기준: GK +3.6 · 먼 압박 +7.5 · 중간 +12 · 코앞 +18.
export const CLOCK_RATES = { gk: 0.0012, pressed: 0.006, near: 0.004, far: 0.0025 };

// 관성 이동 — 목표로 조향 가속(시정수 ~0.3s), 도착 2.2m 안에서 감속. 방향 전환이
// 자연스러운 곡선이 되고 _vx/_vy가 렌더 노치의 몸 방향이 된다.
function mover(p, tx, ty, maxSpd, dts) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  const arrive = Math.min(1, d / 2.2);
  const wx = d > 0.04 ? dx / d * maxSpd * arrive : 0;
  const wy = d > 0.04 ? dy / d * maxSpd * arrive : 0;
  const k = Math.min(1, dts * 3.2);
  p._vx = (p._vx ?? 0) + (wx - (p._vx ?? 0)) * k;
  p._vy = (p._vy ?? 0) + (wy - (p._vy ?? 0)) * k;
  p.x += p._vx * dts; p.y += p._vy * dts;
  sync(p);
}

const clampY = (y) => Math.max(4, Math.min(64, y));
const WIDE_L = 7, WIDE_R = 61;

// 역할 런 목표 — base 앵커에서 상황(볼·라인·마킹)+**전술 지침(lineIntents)**에 맞는 런.
// B1(런 프로파일): 허브/브리핑의 지침 선택이 실제 런 모양을 바꾼다 — 메타→체감의 새 축.
//   back  'overlap' 풀백 터치라인 질주  / 'hold' 후방 잔류(리셋 출구 보장)
//   front 'pin'  ST·W가 라인 위에서 밀어냄 / 'drop' ST가 내려와 연결(체크런 위주)
//   mid   'between' 8/6 라인 사이 전진   / 'support' 내려와 볼 곁 수적 우위
function runTarget(p, s, h, offLine, runClock) {
  const bx = p._bx, by = p._by;
  const ballX = h.x, ballY = h.y;
  const role = p.role;
  const it = s.lineIntents ?? {};
  let tx = bx + 2.5, ty = by, cap = 4;
  if (role === 'FB' || role === 'IFB' || role === 'LB' || role === 'RB') {
    const myWideY = by < 34 ? WIDE_L : WIDE_R;
    if (it.back === 'hold') { tx = bx + 1; ty = by + (myWideY - by) * 0.15; cap = 2.5; }   // 후방 안정 — 남는다
    else if (ballX > 30 && Math.abs(ballY - by) < 22) { tx = bx + 11; ty = myWideY; cap = 11; }  // 오버랩 질주
    else { tx = bx + 3; ty = by + (myWideY - by) * 0.3; cap = 5; }
  } else if (role === 'W') {
    // 폭 유지 + 라인 어깨. front 'drop'이면 반 발 내려 연결 각 제공.
    const push = it.front === 'drop' ? 5 : 9;
    tx = Math.min(offLine - 1.2, bx + push); cap = push;
    ty = by < 34 ? Math.min(by, WIDE_L + 1) : Math.max(by, WIDE_R - 1);
  } else if (role === 'ST') {
    // pin=라인 위 어깨런 위주 / drop=내려와 연결(체크런 위주) / 기본=2.4s 교대.
    const phase = Math.floor(runClock / 2.4) % 2;
    const check = it.front === 'drop' ? true : it.front === 'pin' ? false : phase === 0;
    if (check) { tx = Math.max(bx - (it.front === 'drop' ? 9 : 5), ballX + 8); ty = by + (ballY - by) * 0.25; cap = it.front === 'drop' ? 9 : 6; }
    else { tx = Math.min(offLine - 1.0, bx + 7); ty = by + (by >= ballY ? 3.5 : -3.5); cap = 8; }
  } else if (role === '8' || role === '6' || role === 'DM') {
    if (it.mid === 'support') { tx = bx - 2; ty = by + (ballY - by) * 0.35; cap = 5; }   // 내려와 수적 우위
    else { tx = bx + 4; ty = by + (ballY - by) * 0.18; cap = 5; }                        // 라인 사이 전진
  }
  return { tx, ty: clampY(ty), cap };
}

export function applyRealtimePress(engine, dt, active) {
  const s = engine.state;
  if (!active) {
    for (const p of s.players) { p._bx = undefined; p._by = undefined; }
    s._runClock = 0;
    s._presserId = null;
    return;
  }
  const h = engine.holder(); if (!h) return;
  const dts = dt / 1000;
  s._runClock = (s._runClock ?? 0) + dts;
  const holderGK = h.role === 'GK';

  for (const p of s.players) { if (p._bx === undefined) { p._bx = p.x; p._by = p.y; } }

  const oxs = s.players.filter((p) => p.side === 'opp').map((p) => p.x).sort((a, b) => b - a);
  const offLine = oxs[1] ?? 105;

  // 압박수(볼 최근접 상대) + 블록 호흡.
  let near = null, nd = Infinity;
  for (const p of s.players) {
    if (p.side !== 'opp' || p.role === 'GK') continue;
    const d = Math.hypot(p.x - h.x, p.y - h.y);
    if (d < nd) { nd = d; near = p; }
  }
  // 압박수 노출(A5 가독성) — 렌더러가 주황 링으로 "누가 조여오는지"를 보여준다.
  s._presserId = (!holderGK && near) ? near.id : null;
  for (const o of s.players) {
    if (o.side !== 'opp' || o.role === 'GK') continue;
    if (o === near && !holderGK) {
      // 스탠드오프 지점까지 조여옴(관성 — 마지막에 자연 감속). B2: 클로징 공격성은
      // jumpiness — 튀어나가는 전방(0.85)은 빠르게, 신중한 CB(0.35)는 천천히 조인다.
      const dx = h.x - o.x, dy = h.y - o.y, d = Math.hypot(dx, dy) || 1;
      const gx = h.x - dx / d * STANDOFF, gy = h.y - dy / d * STANDOFF;
      mover(o, gx, gy, paceMax(o, 1.4 + (o.jumpiness ?? 0.5) * 0.6), dts);
      // 관성 오버슛 방지 — BACK 문턱(3.5m) 밖 계약을 하드 클램프로 보증.
      const d2 = Math.hypot(h.x - o.x, h.y - o.y);
      if (d2 < STANDOFF && d2 > 0.01) {
        const ux = (o.x - h.x) / d2, uy = (o.y - h.y) / d2;
        o.x = h.x + ux * STANDOFF; o.y = h.y + uy * STANDOFF; sync(o);
      }
    } else {
      // 블록 호흡 — base + 볼사이드 셰이드(유닛 슬라이드, 뭉침 방지).
      const bx = o._bx ?? o.x, by = o._by ?? o.y;
      const shX = Math.max(-1.5, Math.min(1.5, (h.x - bx) * 0.05));
      const shY = Math.max(-2.5, Math.min(2.5, (h.y - by) * 0.16));
      mover(o, bx + shX, clampY(by + shY), paceMax(o, 1.2), dts);
    }
  }

  // 우리 오프볼 — 역할 런(관성·base 상한·온사이드·간격 유지).
  for (const p of s.players) {
    if (p.side !== 'us' || p.role === 'GK' || p.id === s.holderId) continue;
    let { tx, ty, cap } = runTarget(p, s, h, offLine, s._runClock);
    // base 상한 — 런은 결정 창 안에서 유계(창마다 리셋).
    const rdx = tx - p._bx, rdy = ty - p._by, rl = Math.hypot(rdx, rdy);
    if (rl > cap) { tx = p._bx + rdx / rl * cap; ty = p._by + rdy / rl * cap; }
    // 온사이드(볼 앞이면 라인 뒤로 못 감) + 홀더 6m 간격 + 동료 3.5m 분리.
    if (tx > h.x) tx = Math.min(tx, offLine - 0.5);
    const hd = Math.hypot(tx - h.x, ty - h.y);
    if (hd < 6) { const f = 6 / (hd || 1); tx = h.x + (tx - h.x) * f; ty = h.y + (ty - h.y) * f; }
    for (const m of s.players) {
      if (m.side !== 'us' || m.id === p.id || m.role === 'GK') continue;
      const md = Math.hypot(m.x - tx, m.y - ty);
      if (md < 3.5) { ty += (ty >= m.y ? 1 : -1) * (3.5 - md); }
    }
    mover(p, tx, clampY(ty), paceMax(p, 1.5), dts);
  }

  // 홀더 자동 드리프트(B안) — 배짱(B2: pressResistance)만큼 압박을 허용하며 전진.
  // 저항 강한 선수(0.85→4.1m)는 수비를 더 가까이 두고도 몰고, 약한 선수(0.55→4.7m)는
  // 일찍 멈춘다. 바닥 4.0 > 스탠드오프 3.8 > BACK 3.5 — 안전 계약 유지.
  if (!holderGK) {
    const DRIFT_MAX = 4;
    const guts = Math.max(4.0, 5.8 - (h.traits?.pressResistance ?? 0.5) * 2);
    if (nd > guts) {
      const dy = near ? Math.sign(h.y - near.y || 1) * 0.35 : 0;
      const tx = Math.min((h._bx ?? h.x) + DRIFT_MAX, 100);
      const ty = clampY((h._by ?? h.y) + dy * DRIFT_MAX);
      mover(h, tx, ty, paceMax(h, 0.95), dts);
    } else {
      // 압박권 — 서서 결정(감속 정지).
      mover(h, h.x, h.y, paceMax(h, 0.9), dts);
    }
  }

  // 결정 시계 — 게이지 경제의 보조 세율. 100 → auto-hold(엔진 붕괴 소비).
  const rate = holderGK ? CLOCK_RATES.gk : (nd < 5 ? CLOCK_RATES.pressed : nd < 9 ? CLOCK_RATES.near : CLOCK_RATES.far);
  s.pressure = Math.min(100, (s.pressure ?? 0) + rate * dt);
  if ((s.pressure ?? 0) >= 100 && !engine.busy && s.status === 'live') engine.dispatch('hold');
}
