// 유인–3자 콤비 Phase 0 측정 (docs/bait-third-man-design.md §7).
// (1) 임계거리별 유인 커밋 성공 곡선 — 스위트스폿(닿기 직전) 존재 검증.
// (2) 유인 성공 시 직접 패스(베이터→뒷공간)가 3자 릴리스보다 막혀 있나(Phase 1은
//     아직이므로 여기선 "유인 성립 + 마커가 레인을 막았다"까지만 확인).
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { evaluateLane } from '../js/engine/space.js';

const N = Number(process.argv[2] ?? 400);

// 대인 스킴(man)에서 홀더가 한 마커를 향해 다양한 거리로 캐리 → 커밋률.
function baitAtDistance(targetGap) {
  let baited = 0, attempts = 0, tackled = 0;
  for (let i = 0; i < N; i++) {
    const e = createEngine(getScenario('B1'), 4000 + i, { baitCombo: true });  // B1=man/high/tight
    const h = e.holder();
    // 홀더에서 가장 가까운 대인 마커를 찾아 그쪽으로 targetGap 남기고 캐리 목표 설정.
    const opps = e.state.players.filter((p) => p.side === 'opp' && p.line !== 'gk' && p.markId);
    if (!opps.length) continue;
    const marker = opps[i % opps.length];
    // 홀더를 마커에서 (targetGap+4)m 지점에 두고 4m 캐리 → 밴드에 착지(현실적
    // 중반 빌드업: 마커가 캐리 사거리 안). 캐리 방향은 마커 쪽.
    h.x = marker.x + (targetGap + 4); h.y = marker.y;
    const point = { x: marker.x + targetGap, y: marker.y };
    attempts++;
    const r = e.dispatch('carry', null, point);
    if (r.ok === false) { tackled++; continue; }
    if (e.state.baited) baited++;
  }
  return { gap: targetGap, baitRate: baited / attempts * 100, tackleRate: tackled / attempts * 100, n: attempts };
}

console.log(`=== 유인 커밋 곡선 (B1 man, 마커에서 남긴 거리별, n=${N}) ===`);
console.log('남긴거리  유인성공%  태클%');
for (const gap of [1, 2, 3, 4, 5, 6, 8]) {
  const r = baitAtDistance(gap);
  console.log(`  ${String(gap).padStart(2)}m     ${r.baitRate.toFixed(1).padStart(5)}    ${r.tackleRate.toFixed(1).padStart(5)}`);
}
console.log('기대: 2~5m 밴드에서 유인↑, <2m는 태클 급증(스위트스폿=닿기 직전).');

// (2) 실전 자기대국에서 유인이 실제로 발동하나(도달 가능성) — Phase 3 전에도
// AI가 우연히 밴드로 캐리하면 발동해야. baitCombo on/off는 아직 옵트인.
console.log('\n=== 실전 자기대국 유인 발동 빈도 (baitCombo on) ===');
const { buildPolicyView, executePolicyAction, aiPolicy, settle } = await import('../js/engine/policy.js');
for (const cell of ['A1', 'B1', 'B2']) {
  let baits = 0, games = 0, gamesWithBait = 0;
  for (let i = 0; i < N; i++) {
    const e = createEngine(getScenario(cell), 8000 + i, { baitCombo: true });
    games++; let turns = 0, stuck = 0, had = false;
    while (e.state.status === 'live' && turns < 60) {
      settle(e); if (e.state.status !== 'live') break;
      const a = aiPolicy(buildPolicyView(e, 'us'));
      if (a.kind === 'noop') { if (++stuck > 4) break; continue; }
      const r = executePolicyAction(e, a); settle(e);
      if (e.state.baited && a.actionId === 'carry') { baits++; had = true; }
      if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
      turns++;
    }
    if (had) gamesWithBait++;
  }
  console.log(`  ${cell}: 경기당 유인 ${(baits / games).toFixed(2)}회, 유인 1+ 경기 ${(gamesWithBait / games * 100).toFixed(0)}%`);
}
console.log('참고: Phase 3에서 evaluator가 유인 캐리를 의도적으로 추천하면 빈도↑. 지금은 우연 발동 기준.');

// (3) Phase 1 릴리스 — 유인 성공 후 3자 릴리스가 리시버를 뒷공간으로 내려보내
// FACING(전진 방향)으로 받게 하나(A안: 가치=오리엔테이션+전진, 레인 차단 아님).
// 현실적 위치(리시버=마커 옆 마킹, 3자 지원=측면 깨끗한 각)로 검증.
console.log('\n=== Phase 1 릴리스 (A안: 드롭→FACING→라인브레이크) ===');
{
  let baited = 0, relOk = 0, facing = 0, lb = 0;
  for (let i = 0; i < N; i++) {
    const e = createEngine(getScenario('B1'), 4000 + i, { baitCombo: true });
    const marker = e.state.players.find((p) => p.side === 'opp' && p.markId && p.line === 'mid');
    if (!marker) continue;
    const recv = e.state.players.find((p) => p.id === marker.markId);
    if (recv) { recv.x = marker.x + 2; recv.y = marker.y; recv.tx = recv.x; recv.ty = recv.y; }
    const support = e.state.players.find((p) => p.side === 'us' && p.role !== 'GK' && p.id !== (recv && recv.id));
    if (support) { support.x = marker.x - 2; support.y = marker.y + 18; support.tx = support.x; support.ty = support.y; }
    const h = e.holder(); h.x = marker.x - 6; h.y = marker.y; h.tx = h.x; h.ty = h.y;
    e.dispatch('carry', null, { x: marker.x - 3, y: marker.y }); settle(e);
    if (!e.state.baited) continue;
    baited++;
    const lb0 = e.state.facts.linesBroken;
    const r = e.dispatch('release'); settle(e);
    if (r.ok) { relOk++; const rc = e.holder(); if (rc && rc.orientation === 'FACING') facing++; if (e.state.facts.linesBroken > lb0) lb++; }
  }
  console.log(`  유인 ${baited}/${N} | 릴리스 성공 ${(relOk / Math.max(1, baited) * 100).toFixed(0)}% | FACING ${(facing / Math.max(1, relOk) * 100).toFixed(0)}% | 라인브레이크 ${(lb / Math.max(1, relOk) * 100).toFixed(0)}%`);
  console.log('  기대: 릴리스 성공 시 FACING 100%(내려와 전진 방향) + 라인브레이크 100%(마커 라인 넘어 전진).');
}
