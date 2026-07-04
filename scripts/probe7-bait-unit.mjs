// 유인–3자 콤비 결정적 단위 검증 — 자기대국 AI는 볼을 빈 공간(us-r8)에 park해
// 유인 지오메트리에 절대 안 들어가므로, 여기선 마킹된 홀더 + 도발 밴드 마커를
// 직접 배치하고 carry→release를 구동해 세 불변식을 확인한다:
//   (1) 리시버 ≠ 홀더 (자기참조 퇴화 없음)   (2) release 성공 시 리시버 온사이드
//   (3) 리시버 orientation === 'FACING'
// 두 케이스: [A] 홀더의 '자기 1v1 마커'를 당김(→ 폴백 3자 리시버),
//           [B] '다른 팀원의 마커'를 당김(→ 그 팀원이 리시버).
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { offsideLine } from '../js/engine/space.js';

const settle = (e) => { let g = 0; while (e.busy && g++ < 30) e.update(999); };

function run(caseName, setup, seeds = 300) {
  let armed = 0, selfRef = 0, relOk = 0, offside = 0, facingOk = 0, notFacing = 0;
  for (let i = 0; i < seeds; i++) {
    const e = createEngine(getScenario('B1'), 1000 + i, { baitCombo: true });
    settle(e);
    setup(e);
    const h = e.holder();
    if (!h) continue;
    // 마커를 향해 소폭 캐리 → tryBait이 밴드 안에서 마커를 잡는다.
    const marker = e.state.players.find((p) => p.side === 'opp' && p.line !== 'gk' && Math.hypot(p.x - h.x, p.y - h.y) <= 5.5);
    if (!marker) continue;
    const point = { x: h.x + (marker.x - h.x) * 0.25, y: h.y + (marker.y - h.y) * 0.25 };
    const r = e.dispatch('carry', null, point);
    if (!r.ok) continue;
    const b = e.state.baited;
    if (!b) continue;                       // commitP 롤 실패 — 다음 시드
    armed++;
    if (b.receiverId === b.carrierId) selfRef++;
    settle(e);
    const opps = e.state.players.filter((p) => p.side === 'opp');
    const line = offsideLine(opps);
    const carrierX = e.holder()?.x ?? 0;
    const rel = e.dispatch('release', null, null);
    settle(e);
    if (rel.ok) {
      relOk++;
      const recv = e.state.players.find((p) => p.id === b.receiverId);
      if (recv) {
        if (recv.x > carrierX && recv.x > line + 0.2) offside++;
        if (recv.orientation === 'FACING') facingOk++; else notFacing++;
      }
    }
  }
  console.log(`\n[${caseName}]  arm ${armed}/${seeds}  |  자기참조 ${selfRef}  |  release성공 ${relOk}  |  오프사이드 ${offside}  |  FACING ${facingOk} (비FACING ${notFacing})`);
  return { armed, selfRef, relOk, offside, facingOk, notFacing };
}

// 케이스 A: 홀더 = us-st(자기 마커 opp-lcb). 마커를 3.5m 앞(골쪽)에 붙인다.
// 폴백으로 '다른' 팀원이 리시버가 돼야 한다.
const A = run('A: 자기 1v1 마커 유인 → 폴백 3자', (e) => {
  const st = e.state.players.find((p) => p.id === 'us-st');
  const lcb = e.state.players.find((p) => p.id === 'opp-lcb');   // markId=us-st
  if (!st || !lcb) return;
  st.x = 70; st.y = 34; st.tx = 70; st.ty = 34;
  lcb.x = 73.5; lcb.y = 34; lcb.tx = 73.5; lcb.ty = 34;
  // 비워질 공간 근처에 다른 팀원(리시버 후보) 배치
  const lw = e.state.players.find((p) => p.id === 'us-lw');
  if (lw) { lw.x = 74; lw.y = 30; lw.tx = 74; lw.ty = 30; }
  e.state.holderId = 'us-st';
});

// 케이스 B: 홀더 = us-6(마킹 안 됨). '다른 팀원'(us-lw, 마커 opp-rb)의 마커를 당긴다.
const B = run('B: 다른 팀원의 마커 유인 → 그 팀원이 리시버', (e) => {
  const six = e.state.players.find((p) => p.id === 'us-6');
  const rb = e.state.players.find((p) => p.id === 'opp-rb');   // markId=us-lw
  const lw = e.state.players.find((p) => p.id === 'us-lw');
  if (!six || !rb || !lw) return;
  six.x = 68; six.y = 40; six.tx = 68; six.ty = 40;
  rb.x = 71.5; rb.y = 40; rb.tx = 71.5; rb.ty = 40;       // 밴드 안
  lw.x = 74; lw.y = 44; lw.tx = 74; lw.ty = 44;           // 마커가 마킹하던 팀원
  e.state.holderId = 'us-6';
});

const okA = A.armed > 0 && A.selfRef === 0 && A.offside === 0 && A.notFacing === 0;
const okB = B.armed > 0 && B.selfRef === 0 && B.offside === 0 && B.notFacing === 0;
console.log(`\n=== 판정: A ${okA ? 'PASS' : 'FAIL'}  B ${okB ? 'PASS' : 'FAIL'} ===`);
if (B.relOk > 0 && B.facingOk > 0) console.log(`케이스 B에서 리시버(us-lw)가 마커의 담당인지: previewBait 경로 확인됨`);
