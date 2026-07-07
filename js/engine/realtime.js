// 실시간 압박 레이어(2026-07) — 결정 대기(턴이 끊긴) 동안 시간이 상황을 바꾼다.
//
// 계약: 엔진 '기존 파일'은 불변(이 모듈은 신규 추가). DOM을 모른다 — engine만 받아
// 헤드리스 테스트 가능(scripts/realtime-press-test.mjs가 게이트). main.js가 렌더
// 루프에서 매 프레임 호출한다.
//
// 동작(모두 결정 대기 중에만):
//  1) 압박수 1명이 볼로 조여온다(pace 속도) — 왜 시간이 쫓기는지 눈에 보이게.
//     스탠드오프 3.8m: 엔진 오리엔테이션 문법의 BACK 문턱(3.5m) 밖 — 기다림의 벌은
//     '게이지'지, 전방 패스가 몰래 다 빨개지는 이중 처벌이 아니다(검토 R2).
//     홀더가 GK면 조여오지 않는다(후방 방출은 여유 — 검토 R4).
//  2) 우리 오프볼 전원이 각을 만든다(마커 반대+전방, 마킹 빡셀수록 크게). 턴 시작
//     위치(base)에 앵커 — 유계, 온사이드.
//  3) 압박수가 아닌 상대는 base로 복귀 — 조여옴이 턴을 넘어 누적돼 수비가 볼 주변으로
//     뭉치는 드리프트를 막는다(검토 R3). base는 결정 창마다 리셋(엔진 액션의 이동이
//     새 진실이 된다).
//  4) 결정 시계 — 게이지가 실시간으로 찬다(압박 가까울수록 빠르게). 100이면 auto-hold
//     → 엔진의 기존 붕괴 소비(볼 상실). 속도는 기존 게이지 경제(4R, 액션당 ±2~14)를
//     '보조'하는 크기(3초에 +7~18) — 시계가 경제를 지배하지 않는다(검토 R1).

const STANDOFF = 3.8;
const paceSpeed = (p, base) => base * (0.6 + (p.traits?.pace ?? 0.6) * 0.6);
function syncRender(p) { p.rx = p.tx = p.fx = p.x; p.ry = p.ty = p.fy = p.y; }

// 시계 속도(/ms) — 튜닝 노브. 3초 체류 기준: GK +3.6 · 먼 압박 +7.5 · 중간 +12 · 코앞 +18.
export const CLOCK_RATES = { gk: 0.0012, pressed: 0.006, near: 0.004, far: 0.0025 };

export function applyRealtimePress(engine, dt, active) {
  const s = engine.state;
  if (!active) {
    for (const p of s.players) { p._bx = undefined; p._by = undefined; }
    return;
  }
  const h = engine.holder(); if (!h) return;
  const dts = dt / 1000;
  const holderGK = h.role === 'GK';

  // 결정 창 시작 시 전원 base 앵커(엔진 액션 후 위치가 진실).
  for (const p of s.players) { if (p._bx === undefined) { p._bx = p.x; p._by = p.y; } }

  // 오프사이드 라인(2nd-최심 상대 x) — 우리 각 만들기 온사이드 클램프.
  const oxs = s.players.filter((p) => p.side === 'opp').map((p) => p.x).sort((a, b) => b - a);
  const offLine = oxs[1] ?? 105;

  // 1) 압박수(볼 최근접 상대) 조여옴 + 3) 나머지 상대는 base 복귀.
  let near = null, nd = Infinity;
  for (const p of s.players) {
    if (p.side !== 'opp' || p.role === 'GK') continue;
    const d = Math.hypot(p.x - h.x, p.y - h.y);
    if (d < nd) { nd = d; near = p; }
  }
  for (const o of s.players) {
    if (o.side !== 'opp' || o.role === 'GK') continue;
    if (o === near && !holderGK) {
      if (nd > STANDOFF) {
        const dx = h.x - o.x, dy = h.y - o.y, d = Math.hypot(dx, dy) || 1;
        const mv = Math.min(nd - STANDOFF, paceSpeed(o, 1.6) * dts);
        o.x += dx / d * mv; o.y += dy / d * mv; syncRender(o);
      }
    } else {
      const bx = o._bx ?? o.x, by = o._by ?? o.y;
      const dx = bx - o.x, dy = by - o.y, d = Math.hypot(dx, dy);
      if (d > 0.05) {
        const mv = Math.min(d, paceSpeed(o, 1.2) * dts);
        o.x += dx / d * mv; o.y += dy / d * mv; syncRender(o);
      }
    }
  }

  // 2) 우리 오프볼 — 각 만들기(base 앵커·마킹 강도별 크기·온사이드).
  for (const p of s.players) {
    if (p.side !== 'us' || p.role === 'GK' || p.id === s.holderId) continue;
    let mk = null, md = Infinity;
    for (const o of s.players) { if (o.side !== 'opp' || o.role === 'GK') continue; const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < md) { md = d; mk = o; } }
    let ax = 0.55, ay = 0;
    if (mk && md < 12) { const dx = p._bx - mk.x, dy = p._by - mk.y, dl = Math.hypot(dx, dy) || 1; ax += dx / dl * 1.2; ay += dy / dl * 1.2; }
    const al = Math.hypot(ax, ay) || 1;
    const offMag = md < 7 ? 5.5 : md < 12 ? 3.0 : 1.6;
    let tx = p._bx + ax / al * offMag, ty = p._by + ay / al * offMag;
    if (tx > h.x) tx = Math.min(tx, offLine - 0.5);
    ty = Math.max(4, Math.min(64, ty));
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
    const mv = Math.min(d, paceSpeed(p, 1.4) * dts);
    p.x += dx / d * mv; p.y += dy / d * mv; syncRender(p);
  }

  // 2.5) 홀더 자동 드리프트(B안 — "공을 가지면 계속 이동") — 볼 잡은 필드 선수는
  //    결정 대기 중 천천히 전진하며 압박 반대편으로 잔걸음. '운반' 액션은 의도적인
  //    길게 몰기(유인 도구)로 남는다 — 이 드리프트는 조준 없는 자동 잔걸음.
  //    base 앵커로 창당 최대 DRIFT_MAX(4m). 최근접 수비수 5m 이내면 전진 안 함(제
  //    발로 태클권·HALF에 안 들어감 — 압박은 어차피 조여온다). 전진은 공짜가 아니다:
  //    드리프트하는 동안 시계가 차니 "잔걸음 전진 = 게이지로 산다".
  if (!holderGK) {
    const DRIFT_MAX = 4;
    if (nd > 5.0) {
      const dy = near ? Math.sign(h.y - near.y || 1) * 0.35 : 0;
      const tx = Math.min((h._bx ?? h.x) + DRIFT_MAX, 100);
      const ty = Math.max(4, Math.min(64, (h._by ?? h.y) + dy * DRIFT_MAX));
      const dx = tx - h.x, dyy = ty - h.y, d = Math.hypot(dx, dyy);
      if (d > 0.05) {
        const mv = Math.min(d, paceSpeed(h, 0.9) * dts);   // 캐리=느린 걸음
        h.x += dx / d * mv; h.y += dyy / d * mv; syncRender(h);
      }
    }
  }

  // 4) 결정 시계 — 게이지 경제의 보조 세율(지배 금지). 100 → auto-hold(엔진 붕괴 소비).
  const rate = holderGK ? CLOCK_RATES.gk : (nd < 5 ? CLOCK_RATES.pressed : nd < 9 ? CLOCK_RATES.near : CLOCK_RATES.far);
  s.pressure = Math.min(100, (s.pressure ?? 0) + rate * dt);
  if ((s.pressure ?? 0) >= 100 && !engine.busy && s.status === 'live') engine.dispatch('hold');
}
