// 실시간 압박 레이어 회귀 — js/engine/realtime.js (2026-07 검토로 게이트 편입).
// 계약: ① 비활성이면 무변조 ② 시계는 게이지 경제의 보조 세율(3s에 +7~18, GK 여유)
// ③ 압박수는 스탠드오프(3.8m, BACK 문턱 3.5 밖)까지만 ④ 우리 오퍼는 base 유계
// ⑤ 압박수 아닌 상대는 base 복귀(뭉침 드리프트 방지) ⑥ 게이지 100 → auto-hold 붕괴
// ⑦ NaN 0 · GK 홀더에겐 조여오지 않음.

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { applyRealtimePress } from '../js/engine/realtime.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function mkEngine(holderId) {
  const e = createEngine(getScenario('B1'), 4242, { baitCombo: true });
  e.state.holderId = holderId;
  return e;
}
function run(e, seconds, { pump = false } = {}) {
  const frames = Math.round(seconds * 1000 / 16);
  for (let f = 0; f < frames; f++) {
    applyRealtimePress(e, 16, true);
    if (pump) e.update(16);
  }
}

console.log('=== 실시간 압박 레이어 테스트 ===\n');

// [1] 비활성 → 무변조 + 앵커 해제
{
  const e = mkEngine('us-lcb');
  const snap = e.state.players.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('|');
  const pr = e.state.pressure ?? 0;
  for (let f = 0; f < 60; f++) applyRealtimePress(e, 16, false);
  const snap2 = e.state.players.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('|');
  ok(snap === snap2 && (e.state.pressure ?? 0) === pr, '비활성 → 위치·게이지 무변조');
  ok(e.state.players.every((p) => p._bx === undefined), '비활성 → base 앵커 해제');
}

// [2] 시계 세율 — 먼 압박 3s ≤ +9 · 코앞 3s +14~22 · GK 3s ≤ +5 (경제 지배 금지)
{
  const e = mkEngine('us-lcb');
  const h = e.holder();
  for (const o of e.state.players) if (o.side === 'opp' && o.role !== 'GK') { o.x = h.x + 25 + Math.random(); }
  e.state.pressure = 10;
  run(e, 3);
  const dFar = (e.state.pressure ?? 0) - 10;
  ok(dFar > 4 && dFar <= 9.5, `먼 압박 3s → +${dFar.toFixed(1)} (≤9.5)`);

  const e2 = mkEngine('us-lcb');
  const h2 = e2.holder();
  const p2 = e2.state.players.find((p) => p.side === 'opp' && p.role !== 'GK');
  p2.x = h2.x + 4.5; p2.y = h2.y;
  e2.state.pressure = 10;
  run(e2, 3);
  const dNear = (e2.state.pressure ?? 0) - 10;
  ok(dNear >= 13 && dNear <= 22, `코앞 압박 3s → +${dNear.toFixed(1)} (14~22 근방)`);

  const e3 = mkEngine('us-gk');
  e3.state.pressure = 10;
  run(e3, 3);
  const dGk = (e3.state.pressure ?? 0) - 10;
  ok(dGk <= 5, `GK 방출 3s → +${dGk.toFixed(1)} (여유, ≤5)`);
}

// [3] 스탠드오프 — 오래 둬도 압박수가 3.75m 안으로 안 들어옴(BACK 문턱 3.5 밖)
{
  const e = mkEngine('us-lcb');
  const h = e.holder();
  const o = e.state.players.find((p) => p.side === 'opp' && p.role !== 'GK');
  o.x = h.x + 10; o.y = h.y;
  run(e, 6);
  const nd = Math.min(...e.state.players.filter((p) => p.side === 'opp' && p.role !== 'GK').map((p) => dist(p, h)));
  ok(nd >= 3.75, `압박수 최근접 ${nd.toFixed(2)}m ≥ 3.75 (이중 처벌 없음)`);
}

// [4] 우리 오퍼 — 타이트 마킹은 벌어지고, base에서 유계(≤ offMag+0.8)
{
  const e = mkEngine('us-lcb');
  const lw = e.state.players.find((p) => p.id === 'us-lw');
  const opps = e.state.players.filter((p) => p.side === 'opp' && p.role !== 'GK');
  opps[0].x = 88;                                      // 깊은 백라인(오프사이드 라인 제공)
  const mk = opps[1];
  mk.x = lw.x + 1.6; mk.y = lw.y;                      // 타이트 마킹(라인 아님)
  const sep0 = dist(mk, lw);
  const b0 = { x: lw.x, y: lw.y };
  run(e, 4);
  const sep1 = Math.min(...e.state.players.filter((p) => p.side === 'opp' && p.role !== 'GK').map((p) => dist(p, lw)));
  ok(sep1 > sep0 + 1.5, `타이트 마킹 윙어 분리 ${sep0.toFixed(1)}→${sep1.toFixed(1)}m (런으로 벌어짐)`);
  ok(dist(b0, lw) <= 10.2, `런 이동 base 유계(윙어 cap 9) ${dist(b0, lw).toFixed(1)}m ≤ 10.2`);
}

// [5] 복귀(R3) — 압박수 아닌 상대가 창 내 이탈했으면 base로 되돌아옴(뭉침 방지)
{
  const e = mkEngine('us-lcb');
  applyRealtimePress(e, 16, true);                     // 앵커 캡처
  const others = e.state.players.filter((p) => p.side === 'opp' && p.role !== 'GK');
  const far = others.sort((a, b) => dist(b, e.holder()) - dist(a, e.holder()))[0];   // 볼에서 가장 먼(압박수 아님)
  far.x += 5;                                          // 창 내 이탈 시뮬
  run(e, 6);
  const back = Math.hypot(far.x - far._bx, far.y - far._by);
  ok(back < 3.2, `비압박수 base±셰이드 복귀 (이탈 5m → 잔여 ${back.toFixed(2)}m ≤ 셰이드 2.9)`);
}

// [6] 게이지 100 → auto-hold → 엔진 붕괴(볼 상실)
{
  const e = mkEngine('us-lcb');
  e.state.pressure = 99.5;
  run(e, 4, { pump: true });
  ok(e.state.status !== 'live', `게이지 만점 → 붕괴 (status=${e.state.status})`);
}

// [7] GK 홀더에겐 조여오지 않음 + NaN 0
{
  const e = mkEngine('us-gk');
  const h = e.holder();
  const nd0 = Math.min(...e.state.players.filter((p) => p.side === 'opp' && p.role !== 'GK').map((p) => dist(p, h)));
  run(e, 4);
  const nd1 = Math.min(...e.state.players.filter((p) => p.side === 'opp' && p.role !== 'GK').map((p) => dist(p, h)));
  // v2: 블록이 볼사이드로 '유계 셰이드'(≤~2.9m)는 하되 조여오진 않는다 — GK 여유 유지.
  ok(nd1 >= nd0 - 3.0, `GK 방출 중 유계 셰이드 외 조여옴 없음 (${nd0.toFixed(1)}→${nd1.toFixed(1)}m)`);
  const nan = e.state.players.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !Number.isFinite(e.state.pressure ?? 0);
  ok(!nan, 'NaN 0');
}

// [8] 홀더 자동 드리프트(B안) — 압박 멀면 천천히 전진, base 유계(≤4.2m)
{
  const e = mkEngine('us-lcb');
  const h = e.holder();
  for (const o of e.state.players) if (o.side === 'opp' && o.role !== 'GK') o.x = h.x + 30;
  const x0 = h.x;
  run(e, 4);
  const drift = h.x - x0;
  ok(drift > 1.2, `홀더 드리프트 전진 +${drift.toFixed(1)}m (>1.2)`);
  ok(Math.hypot(h.x - h._bx, h.y - h._by) <= 4.2, `드리프트 base 유계 ${Math.hypot(h.x - h._bx, h.y - h._by).toFixed(1)}m ≤ 4.2`);
}

// [9] 압박 근접(≤5m)이면 드리프트 정지 — 제 발로 태클권에 안 들어감
{
  const e = mkEngine('us-lcb');
  const h = e.holder();
  const o = e.state.players.find((p) => p.side === 'opp' && p.role !== 'GK');
  o.x = h.x + 4.2; o.y = h.y;   // B2: 문턱=배짱(lcb pr0.7→4.4m), 4.2는 배짱 안
  const x0 = h.x;
  run(e, 3);
  ok(Math.abs(h.x - x0) < 0.6, `배짱 안 압박 → 드리프트 정지 (Δ${(h.x - x0).toFixed(2)}m)`);
}

// [10] GK는 드리프트 안 함(방출 대기)
{
  const e = mkEngine('us-gk');
  const h = e.holder();
  const x0 = h.x, y0 = h.y;
  run(e, 3);
  ok(Math.hypot(h.x - x0, h.y - y0) < 0.1, 'GK 드리프트 없음');
}

// [11] 역할 런 — 풀백 오버랩: 볼 전진 시 측면으로 크게 질주(cap 11, 유계 ≤12)
{
  const e = mkEngine('us-l8');                        // 볼 x46(>30) — 오버랩 조건
  e.state.lineIntents.back = 'overlap';               // B1: 오버랩은 지침 선택(기본 hold=잔류)
  for (const o of e.state.players) if (o.side === 'opp' && o.role !== 'GK') o.x = 90;   // 수비 멀리
  const lb = e.state.players.find((p) => p.id === 'us-lb');
  const b0 = { x: lb.x, y: lb.y };
  run(e, 5);
  const moved = Math.hypot(lb.x - b0.x, lb.y - b0.y);
  ok(moved > 4.5, `풀백 오버랩 질주 +${moved.toFixed(1)}m (>4.5)`);
  ok(moved <= 12, `오버랩 유계 ${moved.toFixed(1)}m ≤ 12`);
  ok(Number.isFinite(lb._vx) && Math.hypot(lb._vx, lb._vy) >= 0, '속도 벡터(몸 방향 노치 재료) 존재');
}

// [12] 런 리드 — 달리는 수신자에게 패스하면 진행 방향 앞(발 앞)에 꽂힌다(≤4.5m)
{
  let hit = null;
  for (let seed = 4242; seed < 4342 && !hit; seed++) {
    const e = mkEngine('us-l8');                              // 볼 x46(>30) — 오버랩 발동 조건
    e.state.lineIntents.back = 'overlap';                     // B1: 오버랩 지침
    const lb = e.state.players.find((p) => p.id === 'us-lb');
    for (const o of e.state.players) if (o.side === 'opp' && o.role !== 'GK') o.x = 92;   // 레인 클린
    run(e, 2.0);                                              // 오버랩 질주 중간(속도 최고점)
    const spd = Math.hypot(lb._vx ?? 0, lb._vy ?? 0);
    if (spd < 0.8) continue;
    const pre = { x: lb.x, y: lb.y, vx: lb._vx, vy: lb._vy };
    const r = e.dispatch('to_feet', 'us-lb');
    if (!r.ok) continue;
    const dxy = { x: lb.x - pre.x, y: lb.y - pre.y };
    const leadLen = Math.hypot(dxy.x, dxy.y);
    const along = (dxy.x * pre.vx + dxy.y * pre.vy) / (Math.hypot(pre.vx, pre.vy) || 1);   // 진행 방향 성분
    hit = { leadLen, along };
  }
  ok(!!hit, '런 중 수신자 케이스 확보');
  if (hit) {
    ok(hit.leadLen > 0.8 && hit.leadLen <= 4.6, `리드 거리 ${hit.leadLen.toFixed(1)}m (0.8~4.6)`);
    ok(hit.along > 0, `리드가 런 진행 방향(성분 +${hit.along.toFixed(1)}m) — 발 앞에 꽂힘`);
  } else fail += 2;
}

// [13] 볼 마중 — 정지 수신자는 패서 쪽으로 한 발 나와 받는다(≤1.6m)
{
  const e = mkEngine('us-lcb');
  for (const o of e.state.players) if (o.side === 'opp' && o.role !== 'GK') o.x = 92;
  const dm = e.state.players.find((p) => p.id === 'us-6');    // ~20m 지상 패스(autoLob 회피)
  dm._vx = 0; dm._vy = 0;                                     // 정지 수신
  const from = e.holder();
  const pre = { x: dm.x, y: dm.y };
  const r = e.dispatch('to_feet', 'us-6');
  if (r.ok) {
    const moved = Math.hypot(dm.x - pre.x, dm.y - pre.y);
    ok(moved > 0.3 && moved <= 1.7 && (dm.x < pre.x + 0.01), `볼 마중 ${moved.toFixed(1)}m (패서 쪽)`);
  } else ok(true, '(패스 실패 롤 — 마중 판정 스킵)');
}

// [14] 런 프로파일(B1) — 전술 지침이 런 모양을 바꾼다
{
  // back 'hold' → 풀백이 남는다(오버랩 조건 동일 지오메트리에서 [11]의 +4.5m와 대비)
  const e = mkEngine('us-l8');
  for (const o of e.state.players) if (o.side === 'opp' && o.role !== 'GK') o.x = 90;
  e.state.lineIntents.back = 'hold';
  const lb = e.state.players.find((p) => p.id === 'us-lb');
  const b0 = { x: lb.x, y: lb.y };
  run(e, 5);
  const held = Math.hypot(lb.x - b0.x, lb.y - b0.y);
  ok(held <= 3.2, `back=hold → 풀백 잔류 ${held.toFixed(1)}m ≤ 3.2 (오버랩 기본값은 +7.6)`);

  // mid 'support' → 8번이 내려와 볼 쪽으로(홀더와의 거리 감소)
  const e2 = mkEngine('us-lcb');
  for (const o of e2.state.players) if (o.side === 'opp' && o.role !== 'GK') o.x = 90;
  e2.state.lineIntents.mid = 'support';
  const l8 = e2.state.players.find((p) => p.id === 'us-l8');
  const h2 = e2.holder();
  const d0 = dist(l8, h2);
  run(e2, 4);
  ok(dist(l8, h2) < d0 - 1 && l8.x <= l8._bx + 0.5, `mid=support → 8번 내려와 연결 (홀더 거리 ${d0.toFixed(1)}→${dist(l8, h2).toFixed(1)}m)`);

  // front 'drop' → ST가 체크런 고정(전진 대신 볼 쪽으로)
  const e3 = mkEngine('us-lcb');
  for (const o of e3.state.players) if (o.side === 'opp' && o.role !== 'GK') o.x = 90;
  e3.state.lineIntents.front = 'drop';
  const st = e3.state.players.find((p) => p.id === 'us-st');
  const sx0 = st.x;
  run(e3, 4);
  ok(st.x < sx0 + 1, `front=drop → ST 체크런(전진 안 함: x ${sx0.toFixed(0)}→${st.x.toFixed(0)})`);
}

// [15] 선수 개성(B2) — longPass 리드 무게 · pressResistance 배짱 · jumpiness 클로징
{
  const leadWith = (lp) => {
    for (let seed = 4242; seed < 4342; seed++) {
      const e = mkEngine('us-l8');
      e.state.lineIntents.back = 'overlap';
      e.holder().traits.longPass = lp;
      const lb = e.state.players.find((p) => p.id === 'us-lb');
      for (const o of e.state.players) if (o.side === 'opp' && o.role !== 'GK') o.x = 92;
      run(e, 2.0);
      if (Math.hypot(lb._vx ?? 0, lb._vy ?? 0) < 0.8) continue;
      const pre = { x: lb.x, y: lb.y };
      if (!e.dispatch('to_feet', 'us-lb').ok) continue;
      return Math.hypot(lb.x - pre.x, lb.y - pre.y);
    }
    return null;
  };
  const lo = leadWith(0.2), hi = leadWith(0.9);
  ok(lo != null && hi != null && hi > lo * 1.2, `longPass 리드 무게 (lp0.2→${lo?.toFixed(2)}m vs lp0.9→${hi?.toFixed(2)}m)`);

  const driftWith = (pr) => {
    const e = mkEngine('us-lcb');
    const h = e.holder(); h.traits.pressResistance = pr;
    const o = e.state.players.find((p) => p.side === 'opp' && p.role !== 'GK');
    o.x = h.x; o.y = h.y + 4.8;   // 순수 측면 4.8m — pr0.9(guts4.0)는 몰고, pr0.3(guts5.2)는 정지
    const x0 = h.x; run(e, 3); return h.x - x0;
  };
  const brave = driftWith(0.9), timid = driftWith(0.3);
  ok(brave > 0.8 && timid < 0.4, `배짱 드리프트 (pr0.9 +${brave.toFixed(1)}m vs pr0.3 +${timid.toFixed(1)}m)`);

  const closeWith = (j) => {
    const e = mkEngine('us-lcb');
    const h = e.holder();
    const o = e.state.players.find((p) => p.side === 'opp' && p.role !== 'GK');
    o.x = h.x + 12; o.y = h.y; o.jumpiness = j;
    const d0 = dist(o, h); run(e, 2.5); return d0 - dist(o, h);
  };
  const eager = closeWith(0.9), calm = closeWith(0.3);
  ok(eager > calm * 1.15, `jumpiness 클로징 (j0.9 ${eager.toFixed(1)}m vs j0.3 ${calm.toFixed(1)}m)`);
}

console.log(fail === 0 ? '\n실시간 압박 레이어 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);