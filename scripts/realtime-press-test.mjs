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
  const mk = e.state.players.find((p) => p.side === 'opp' && p.role !== 'GK');
  mk.x = lw.x + 1.6; mk.y = lw.y;                      // 타이트 마킹
  const sep0 = dist(mk, lw);
  const b0 = { x: lw.x, y: lw.y };
  run(e, 4);
  const sep1 = Math.min(...e.state.players.filter((p) => p.side === 'opp' && p.role !== 'GK').map((p) => dist(p, lw)));
  ok(sep1 > sep0 + 1.5, `타이트 마킹 윙어 분리 ${sep0.toFixed(1)}→${sep1.toFixed(1)}m (각 만들기)`);
  ok(dist(b0, lw) <= 6.3, `오퍼 이동 base 유계 ${dist(b0, lw).toFixed(1)}m ≤ 6.3`);
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
  ok(back < 1.0, `비압박수 base 복귀 (이탈 5m → 잔여 ${back.toFixed(2)}m)`);
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
  ok(nd1 >= nd0 - 0.5, `GK 방출 중 조여옴 없음 (${nd0.toFixed(1)}→${nd1.toFixed(1)}m)`);
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
  o.x = h.x + 4.5; o.y = h.y;
  const x0 = h.x;
  run(e, 3);
  ok(Math.abs(h.x - x0) < 0.6, `압박 근접 시 드리프트 정지 (Δ${(h.x - x0).toFixed(2)}m)`);
}

// [10] GK는 드리프트 안 함(방출 대기)
{
  const e = mkEngine('us-gk');
  const h = e.holder();
  const x0 = h.x, y0 = h.y;
  run(e, 3);
  ok(Math.hypot(h.x - x0, h.y - y0) < 0.1, 'GK 드리프트 없음');
}

console.log(fail === 0 ? '\n실시간 압박 레이어 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
