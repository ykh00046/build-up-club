// probe8-attack-bait-scheme-diff — 8R 항목 1: 유인-3자 콤비가 스킴별(man/hybrid/
// zonal/gegen)로 다르게 동작하는지. 7R의 probe7-bait-unit.mjs는 B1(man) 한 셀만
// 결정적 셋업으로 검증했다 — 이번엔 같은 패턴을 A1(hybrid)·C1(zonal)·C2(gegen)에
// 그대로 이식해 4갈래 비교한다.
//
// tryBait()/previewBait() 코드(engine.js)를 보면 scheme==='zonal'|'gegen'인 경우
// manLike=false → marker 선택이 markId 무관(가장 가까운 아무 필드 수비수)하고,
// receiverId 는 항상 nearestReceiverToVacated(마커 자리 최근접 '다른' 우리팀 선수)
// 경로로만 나온다(man/hybrid의 markId 폴백 분기 자체가 없음). 그래서 zonal/gegen은
// "받는 사람이 이치에 맞는가"(비워진 자리에서 합리적으로 가까운가)가 핵심 검증 대상.
//
// 확인:
//   (1) 불변식 3종(자기참조 없음/오프사이드 없음/FACING) — 스킴별 유지되는가.
//   (2) 리시버-vacated 거리 분포 — zonal/gegen에서 "말이 안 되는" 리시버(비워진
//       자리와 동떨어진 팀원)가 뽑히는지.
//   (3) commitP·previewBait value 스킴별 분포 — 특정 스킴에서 유인이 과대/과소평가.
//
// 실행: node scripts/probe8-attack-bait-scheme-diff.mjs [시드수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { offsideLine } from '../js/engine/space.js';
import { dist } from '../js/data/pitch.js';

const SEEDS = Number(process.argv[2] ?? 300);
const settle = (e) => { let g = 0; while (e.busy && g++ < 30) e.update(999); };

// 셀별 결정적 셋업 — 각 셀의 실제 포메이션 id에 맞춰 홀더/마커/리시버 후보를 배치.
// 패턴은 probe7-bait-unit.mjs 케이스 A/B와 동일: 홀더가 마커를 밴드(2~5m) 안으로
// 캐리해 tryBait을 트리거한다.
const SETUPS = {
  A1: { cell: 'A1', label: 'hybrid (A1)', holderId: 'us-l8', markerCandidates: ['opp-l8', 'opp-6', 'opp-lb'] },
  B1: { cell: 'B1', label: 'man (B1)', holderId: 'us-6', markerCandidates: ['opp-rcm'] },
  C1: { cell: 'C1', label: 'zonal (C1)', holderId: 'us-l8', markerCandidates: ['opp-rcm', 'opp-lcm', 'opp-rm'] },
  C2: { cell: 'C2', label: 'gegen (C2)', holderId: 'us-6', markerCandidates: ['opp-6', 'opp-l8', 'opp-r8'] },
};

function placeHolderNearMarker(e, holderId, markerCandidates) {
  const h = e.state.players.find((p) => p.id === holderId);
  if (!h) return null;
  // 마커 후보 중 지금 홀더에서 가장 가까운 하나를 골라, 그 마커를 밴드 경계(4.5m)로 당긴다.
  let marker = null, md = Infinity;
  for (const id of markerCandidates) {
    const d = e.state.players.find((p) => p.id === id);
    if (!d) continue;
    const dd = dist(h, d);
    if (dd < md) { md = dd; marker = d; }
  }
  if (!marker) return null;
  // 홀더를 마커에서 4.5m 지점으로 이동(밴드 안, 캐리 사거리 안).
  const dx = marker.x - h.x, dy = marker.y - h.y;
  const dd = Math.hypot(dx, dy) || 1;
  const gap = 4.5;
  h.x = marker.x - (dx / dd) * (dd - gap + gap); // no-op guard
  h.x = marker.x - (dx / dd) * gap;
  h.y = marker.y - (dy / dd) * gap;
  h.tx = h.x; h.ty = h.y;
  e.state.holderId = holderId;
  return marker;
}

function run(cellKey, seeds) {
  const setup = SETUPS[cellKey];
  let armed = 0, selfRef = 0, relOk = 0, offside = 0, facingOk = 0, notFacing = 0;
  const commitPs = [], values = [], receiverVacatedDist = [];
  for (let i = 0; i < seeds; i++) {
    const e = createEngine(getScenario(setup.cell), 3000 + i, { baitCombo: true });
    settle(e);
    const marker = placeHolderNearMarker(e, setup.holderId, setup.markerCandidates);
    if (!marker) continue;
    const h = e.holder();
    if (!h) continue;
    const pv = e.previewBait?.();
    if (pv) { commitPs.push(pv.commitP); values.push(pv.value); }
    // 밴드 안으로 소폭 캐리 → tryBait 커밋 롤.
    const point = { x: h.x + (marker.x - h.x) * 0.15, y: h.y + (marker.y - h.y) * 0.15 };
    const r = e.dispatch('carry', null, point);
    if (!r.ok) continue;
    const b = e.state.baited;
    if (!b) continue;
    armed++;
    if (b.receiverId === b.carrierId) selfRef++;
    const vacated = b.vacated;
    const recv0 = e.state.players.find((p) => p.id === b.receiverId);
    if (recv0 && vacated) receiverVacatedDist.push(dist(recv0, vacated));
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
  return { label: setup.label, armed, selfRef, relOk, offside, facingOk, notFacing, commitPs, values, receiverVacatedDist, seeds };
}

function stats(arr) {
  if (!arr.length) return { n: 0, mean: NaN, min: NaN, max: NaN };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { n: arr.length, mean, min: Math.min(...arr), max: Math.max(...arr) };
}

console.log(`=== 유인-3자 콤비 스킴별 비교 프로브 (hybrid/man/zonal/gegen) — 시드 ${SEEDS} ===\n`);

// ── 0) 정적 매트릭스 — 10셀 전부의 markId 배정 현황.
// tryBait/previewBait(engine.js) 의 manLike(=scheme==='man'||'hybrid') 게이트는
// `if (manLike && !def.markId) continue;` 로 마커 후보를 markId 있는 수비수로만
// 제한한다. formations.js 를 정적으로 스캔해 "manLike인데 markId 배정이 0인 셀"을
// 찾으면, 그 셀은 previewBait/tryBait 가 항상 null/false — 유인 콤비가 구조적으로
// 죽어 있다는 뜻이다(포지션·시드와 무관, 확률이 아니라 필연).
console.log('[0) 정적 스캔 — 10셀 markId 배정 vs manLike 게이트]');
{
  const { getScenario: gs } = await import('../js/data/scenarios.js');
  const CELLS10 = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
  var deadCells = [];
  for (const c of CELLS10) {
    const sc = gs(c);
    const opp = sc.buildOpp();
    const withMark = opp.filter((d) => d.markId).length;
    const manLike = sc.scheme === 'man' || sc.scheme === 'hybrid';
    const dead = manLike && withMark === 0;
    if (dead) deadCells.push(c);
    console.log(`  ${c}  scheme=${sc.scheme.padEnd(9)} manLike=${String(manLike).padEnd(5)} markId수비수 ${withMark}/${opp.length}${dead ? '   <-- 유인 콤비 구조적 불가(previewBait 항상 null)' : ''}`);
  }
}

const results = {};
for (const cell of ['A1', 'B1', 'C1', 'C2']) {
  results[cell] = run(cell, SEEDS);
}

console.log('[불변식 3종 — 자기참조/오프사이드/FACING]');
for (const [cell, r] of Object.entries(results)) {
  const pass = r.armed > 0 && r.selfRef === 0 && r.offside === 0 && r.notFacing === 0;
  console.log(`  ${cell.padEnd(3)} ${r.label.padEnd(14)} arm ${String(r.armed).padStart(4)}/${r.seeds}  자기참조 ${r.selfRef}  release성공 ${r.relOk}  오프사이드 ${r.offside}  FACING ${r.facingOk}(비FACING ${r.notFacing})  ${pass ? 'PASS' : 'FAIL'}`);
}

console.log('\n[리시버-vacated 거리 — 리시버가 "비워진 자리"에서 합리적으로 가까운가]');
for (const [cell, r] of Object.entries(results)) {
  const s = stats(r.receiverVacatedDist);
  console.log(`  ${cell.padEnd(3)} n=${s.n}  평균 ${s.mean?.toFixed(2)}m  최소 ${s.min?.toFixed(2)}  최대 ${s.max?.toFixed(2)}`);
}

console.log('\n[commitP / previewBait value 분포 — 스킴별 유인 가치 평가]');
for (const [cell, r] of Object.entries(results)) {
  const c = stats(r.commitPs), v = stats(r.values);
  console.log(`  ${cell.padEnd(3)} commitP n=${c.n} 평균 ${c.mean?.toFixed(3)} (${c.min?.toFixed(2)}~${c.max?.toFixed(2)})   value 평균 ${v.mean?.toFixed(3)} (${v.min?.toFixed(3)}~${v.max?.toFixed(3)})`);
}

console.log('\n[진단]');
const flags = [];
if (deadCells.length) flags.push(`정적 스캔: ${deadCells.join(', ')} — manLike(hybrid) 스킴인데 opp 포메이션에 markId 배정이 전무 → previewBait/tryBait 항상 null/false (유인-3자 콤비 완전 비활성, 10셀 중 ${deadCells.length}개)`);
for (const [cell, r] of Object.entries(results)) {
  if (r.armed === 0) flags.push(`${cell}: 유인이 한 번도 arm 되지 않음 — 셋업 자체가 이 스킴에서 성립 안 함(밴드 진입 실패 가능)`);
  if (r.selfRef > 0) flags.push(`${cell}: 자기참조 퇴화 재발 ${r.selfRef}건`);
  if (r.offside > 0) flags.push(`${cell}: release 오프사이드 우회 재발 ${r.offside}건`);
  if (r.notFacing > 0) flags.push(`${cell}: 리시버 비FACING ${r.notFacing}건 — 라인 브레이크 실패인데도 release 성공`);
  const rv = stats(r.receiverVacatedDist);
  if (rv.n && rv.max > 20) flags.push(`${cell}: 리시버-vacated 최대거리 ${rv.max.toFixed(1)}m — 비워진 자리와 동떨어진 팀원이 리시버로 뽑힘`);
}
const cWithData = Object.entries(results).filter(([, r]) => r.commitPs.length);
if (cWithData.length >= 2) {
  const means = cWithData.map(([cell, r]) => ({ cell, mean: stats(r.commitPs).mean }));
  const spread = Math.max(...means.map((m) => m.mean)) - Math.min(...means.map((m) => m.mean));
  if (spread > 0.15) flags.push(`스킴 간 commitP 평균 격차 ${spread.toFixed(3)} — ${means.map((m) => `${m.cell}:${m.mean.toFixed(2)}`).join(' ')}`);
}
if (flags.length === 0) console.log('  발견 없음(PASS) — 4개 스킴 모두 불변식 유지, 리시버 지오메트리 합리적.');
else for (const f of flags) console.log(`  - ${f}`);

console.log('\n완료.');
