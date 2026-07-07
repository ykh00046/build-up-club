// F1 회귀(2026-07 플레이테스트 발견) — 유인 캐리가 같은 dispatch에서 국면 결정
// (tempo_choice 등)을 열면 릴리스가 결정 가드에 막혀 "릴리스 ▸ E" 안내와 모순됐다.
// 계약: ① 유인 arm + 결정 동시 발생 → 결정은 유예(matchDecision null, 릴리스 가능)
//       ② 릴리스(또는 다른 액션으로 유인 소멸) 뒤 유예 결정이 복원
//       ③ 시도가 끝나면 유예 결정 무효(스테일 복원 없음)

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };
const settle = (e) => { let g = 0; while (e.busy && g++ < 60) e.update(999); };

console.log('=== 유인×결정 유예(F1) 테스트 ===\n');

// 유인이 확실히 arm되는 결정적 셋업(probe7-bait-unit 케이스 B 지오메트리) + tempo
// 발화 조건(turn≥3, pressure≥55)을 함께 강제해 같은 dispatch에서 충돌시킨다.
function armWithDecision(seed) {
  const e = createEngine(getScenario('B1'), seed, { baitCombo: true });
  settle(e);
  const s = e.state;
  const six = s.players.find((p) => p.id === 'us-6');
  const rb = s.players.find((p) => p.id === 'opp-rb');     // markId=us-lw
  const lw = s.players.find((p) => p.id === 'us-lw');
  six.x = 68; six.y = 40; six.tx = 68; six.ty = 40;
  rb.x = 71.5; rb.y = 40; rb.tx = 71.5; rb.ty = 40;
  lw.x = 74; lw.y = 44; lw.tx = 74; lw.ty = 44;
  s.holderId = 'us-6';
  s.turn = 4; s.pressure = 60;                             // tempo_choice 발화 조건
  const point = { x: six.x + (rb.x - six.x) * 0.25, y: six.y + (rb.y - six.y) * 0.25 };
  const r = e.dispatch('carry', null, point);
  settle(e);
  return { e, r };
}

// [1] 충돌 발생 시 결정 유예 → 릴리스 가능
{
  let hit = null;
  for (let seed = 1000; seed <= 1200 && !hit; seed++) {
    const { e } = armWithDecision(seed);
    if (e.state.baited && (e.state.deferredDecision || e.state.matchDecision)) hit = e;
  }
  ok(!!hit, '유인 arm + 결정 발화 케이스 확보(시드 탐색)');
  if (hit) {
    ok(hit.state.deferredDecision != null && hit.state.matchDecision == null,
      `충돌 시 결정 유예(matchDecision null, deferred=${hit.state.deferredDecision?.id})`);
    const rel = hit.dispatch('release');
    settle(hit);
    ok(rel.rejected !== true, `릴리스가 결정에 막히지 않음 (ok=${rel.ok})`);
    // [2] 유인 해소 뒤 유예 결정 복원(릴리스 성공/실패 무관 — baited 소멸이 기준)
    if (hit.state.status === 'live') {
      ok(hit.state.matchDecision != null && hit.state.deferredDecision == null,
        `릴리스 뒤 결정 복원(${hit.state.matchDecision?.id})`);
    } else {
      ok(hit.state.deferredDecision == null, '릴리스 실패로 시도 종료 → 유예 무효');
    }
  } else { fail += 3; }
}

// [3] 릴리스 대신 다른 액션으로 유인을 버려도 복원
{
  let hit = null;
  for (let seed = 1000; seed <= 1200 && !hit; seed++) {
    const { e } = armWithDecision(seed);
    if (e.state.baited && e.state.deferredDecision) hit = e;
  }
  if (hit) {
    const mate = hit.state.players.find((p) => p.side === 'us' && p.role !== 'GK' && p.id !== hit.state.holderId);
    hit.dispatch('to_feet', mate.id);                      // 유인 창 소멸
    settle(hit);
    if (hit.state.status === 'live') {
      ok(hit.state.matchDecision != null && hit.state.deferredDecision == null, '유인 포기 액션 뒤에도 결정 복원');
    } else {
      ok(hit.state.deferredDecision == null, '(패스 실패로 종료 — 유예 무효 확인)');
    }
  } else { ok(false, '케이스 확보 실패'); }
}

console.log(fail === 0 ? '\n유인×결정 유예 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
