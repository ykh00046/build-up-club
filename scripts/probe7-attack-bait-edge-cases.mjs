// 7R 감사 — 유인–3자 콤비 엣지케이스·익스플로잇 점검.
// (1) 리시버=홀더(자기 자신) 엣지 — tryBait(engine.js:1451)는 대인 스킴에서
//     marker.markId 를 그대로 리시버로 쓴다(engine.js:1468). 만약 지금 홀더를
//     담당하는 마커가 "홀더에 가장 가까운 markId 보유 수비수"로도 뽑히면(자기
//     자신을 마킹하는 수비수를 자기 자신에게 유인하는 셈) receiverId === carrierId
//     가 되어 release()가 "홀더가 홀더에게 패스"하는 자기참조 상태가 된다.
// (2) 릴레이 런 텔레포트 무결성 — tryBait이 releaser.x/y를 순간이동시킨다
//     (engine.js:1486). 반복 유인 시 우리 선수끼리 겹치거나(<1.5m), 피치 밖으로
//     나가거나, NaN 좌표가 생기는지.
// (3) 유인 스팸(릴리스 없이 캐리 반복) — state.baited가 매 캐리마다 재설정되는데
//     (engine.js:1626 dispatch), 마커를 계속 다시 유인하면 그 마커의 committedTurns
//     가 press.js의 자연 감소(444줄)보다 빠르게 재충전되어 사실상 영구 커밋(수비수
//     고정)이 되는지 — 그리고 linesBroken/baits가 부당하게 누적되는지.
// (4) 릴리서 없음 / 마커 없음 — 인위적으로 지원 없는 포메이션을 만들어 크래시나
//     NaN 없이 안전하게 실패(state.baited=null)하는지.
//
// 실행: node scripts/probe7-attack-bait-edge-cases.mjs [경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { PITCH_W, PITCH_H, dist } from '../js/data/pitch.js';

const N = Number(process.argv[2] ?? 400);

// ── (1) 리시버=홀더 자기참조 엣지 ──────────────────────────────────────────
console.log('=== (1) 리시버=홀더(자기참조) 엣지 빈도 (man/hybrid 셀, 자기대국) ===');
{
  const CELLS = ['A1', 'A2', 'B1', 'B2', 'E2'];
  let totalBaits = 0, selfRefBaits = 0;
  let selfRefReleaseOk = 0, selfRefReleaseTried = 0;
  let sample = null;
  for (const cell of CELLS) {
    for (let i = 0; i < N; i++) {
      const e = createEngine(getScenario(cell), 71000 + i, { baitCombo: true });
      let turns = 0, stuck = 0;
      while (e.state.status === 'live' && turns < 60) {
        settle(e);
        if (e.state.status !== 'live') break;
        const view = buildPolicyView(e, 'us');
        const a = aiPolicy(view);
        if (a.kind === 'noop') { if (++stuck > 4) break; continue; }
        const preBaited = e.state.baited;
        const r = executePolicyAction(e, a); settle(e);
        // carry가 방금 유인을 armed했는지 체크(carry 이후 state.baited 새로 생김)
        if (a.actionId === 'carry' && !preBaited && e.state.baited) {
          totalBaits++;
          if (e.state.baited.receiverId === e.state.baited.carrierId) {
            selfRefBaits++;
            if (!sample) sample = { cell, turn: e.state.turn, receiverId: e.state.baited.receiverId };
          }
        }
        if (a.actionId === 'release' && preBaited && preBaited.receiverId === preBaited.carrierId) {
          selfRefReleaseTried++;
          if (r?.ok) selfRefReleaseOk++;
        }
        if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
        turns++;
      }
    }
  }
  console.log(`  전체 유인 성립 ${totalBaits}회 중 자기참조(receiver===carrier) ${selfRefBaits}회 (${(selfRefBaits / Math.max(1, totalBaits) * 100).toFixed(1)}%)`);
  console.log(`  자기참조 상태에서 release 시도 ${selfRefReleaseTried}회, 성공 ${selfRefReleaseOk}회`);
  if (sample) console.log(`  샘플: ${sample.cell} turn=${sample.turn} receiverId=${sample.receiverId} (홀더 자신)`);
  console.log('  발생 시 release()는 "홀더가 자기 자신에게 패스"로 처리 — 실제 볼 소유자(state.holderId)는');
  console.log('  안 바뀌지만, 릴리서(제3자)의 레인 위험만으로 판정 후 성공하면 홀더 본인이 planCarry의');
  console.log('  실제 태클 위험 없이 drop 지점(자기 위치 근방 +몇 m)으로 재배치되고 FACING+라인브레이크');
  console.log('  가 무료로 적립된다 — carry의 경로 태클 리스크를 우회하는 저비용 전진 경로 가능성.\n');
}

// ── (2) 릴레이 런 텔레포트 무결성 ──────────────────────────────────────────
console.log('=== (2) 릴레이 런 텔레포트 무결성 (겹침·피치이탈·NaN) ===');
{
  let checks = 0, overlaps = 0, outOfBounds = 0, nanCoords = 0;
  let minGapSeen = Infinity, minGapSample = null;
  for (const cell of ['B1', 'B2', 'A1']) {
    for (let i = 0; i < Math.min(N, 200); i++) {
      const e = createEngine(getScenario(cell), 72000 + i, { baitCombo: true });
      let turns = 0, stuck = 0;
      while (e.state.status === 'live' && turns < 60) {
        settle(e);
        if (e.state.status !== 'live') break;
        const view = buildPolicyView(e, 'us');
        const a = aiPolicy(view);
        if (a.kind === 'noop') { if (++stuck > 4) break; continue; }
        const preBaited = e.state.baited;
        const r = executePolicyAction(e, a); settle(e);
        if (a.actionId === 'carry' && !preBaited && e.state.baited) {
          checks++;
          const ours = e.state.players.filter((p) => p.side === 'us');
          for (const p of ours) {
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) nanCoords++;
            if (p.x < 0 || p.x > PITCH_W || p.y < 0 || p.y > PITCH_H) outOfBounds++;
          }
          for (let a1 = 0; a1 < ours.length; a1++) {
            for (let b1 = a1 + 1; b1 < ours.length; b1++) {
              const d = dist(ours[a1], ours[b1]);
              if (d < minGapSeen) { minGapSeen = d; minGapSample = { cell, ids: [ours[a1].id, ours[b1].id], d }; }
              if (d < 1.5) overlaps++;
            }
          }
        }
        if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
        turns++;
      }
    }
  }
  console.log(`  유인 성립 스냅샷 ${checks}회 점검`);
  console.log(`  NaN 좌표 ${nanCoords}건, 피치 이탈 ${outOfBounds}건, 선수 간 겹침(<1.5m) ${overlaps}건`);
  console.log(`  관측 최소 간격: ${minGapSeen.toFixed(2)}m (${minGapSample ? `${minGapSample.cell} ${minGapSample.ids.join('-')}` : 'n/a'})`);
}

// ── (3) 유인 스팸 — 릴리스 없이 반복 유인 ──────────────────────────────────
console.log('\n=== (3) 유인 스팸 (동일 마커 연속 재유인, 릴리스 안 함) ===');
{
  // B1(man/high/tight): probe-bait-combo.mjs와 같은 배치(밴드 안 착지, targetGap=3)
  // 로 첫 유인을 걸고, 이후 마커를 사이에 둔 좌우 지점을 번갈아 캐리해 태클 없이
  // 밴드(2~5m) 안에 계속 머무르며 release는 절대 호출하지 않는다.
  const targetGap = 3;
  const e = createEngine(getScenario('B1'), 4000, { baitCombo: true });
  const marker = e.state.players.find((p) => p.side === 'opp' && p.markId && p.line === 'mid');
  const h = e.holder();
  h.x = marker.x + (targetGap + 4); h.y = marker.y; h.tx = h.x; h.ty = h.y;
  const pointA = { x: marker.x + targetGap, y: marker.y - 3 };
  const pointB = { x: marker.x + targetGap, y: marker.y + 3 };

  let baitedCount = 0, lbBefore = e.state.facts.linesBroken, baitsFactBefore = e.state.facts.baits;
  const committedHistory = [];
  let turnsRun = 0;
  for (let turn = 0; turn < 15 && e.state.status === 'live'; turn++) {
    const point = turn % 2 === 0 ? pointA : pointB;
    const r = e.dispatch('carry', null, point); settle(e);
    turnsRun++;
    if (!r.ok) { console.log(`  턴 ${turn}: 캐리 실패(태클) — 중단`); break; }
    if (e.state.baited) baitedCount++;
    const mk = e.state.players.find((p) => p.id === marker.id);
    committedHistory.push(mk ? mk.committedTurns : null);
  }
  console.log(`  ${turnsRun}턴 실행, 유인 성립 ${baitedCount}회 (release는 전혀 호출 안 함)`);
  console.log(`  마커 committedTurns 추이: [${committedHistory.join(', ')}]`);
  console.log(`  linesBroken 변화: ${lbBefore} → ${e.state.facts.linesBroken} (release 없이 carry만으로 증가하면 캐리 자체의 실이동 분만이어야 함)`);
  console.log(`  facts.baits 변화: ${baitsFactBefore} → ${e.state.facts.baits} (모든 carry가 무조건 +1 — 유인 성패 무관, report/economy 가중치 재료)`);
  const neverZero = committedHistory.length > 0 && committedHistory.every((c) => c === null || c > 0);
  console.log(`  committedTurns가 한 번도 0 이하로 안 떨어짐: ${neverZero} → ${neverZero ? '마커가 사실상 영구 커밋(고정)될 수 있음(release 안 해도 유인만으로 상대 수비 한 명을 계속 묶어둘 수 있음)' : '정상적으로 풀렸다 다시 걸림'}`);
}

// ── (4) 마커/릴리서 없음 — 안전 실패 확인 ─────────────────────────────────
console.log('\n=== (4) 지원/마커 없음 엣지 — 크래시·NaN 없이 안전 실패하는지 ===');
{
  // 4a. zonal(D2/C1)에서 마커는 항상 존재(아무 필드 수비수나 후보) — 정말 "마커
  //     없음"이 되려면 opps()가 텅 비어야 하는데, 그건 불가하므로 releaser 없음을
  //     인위적으로 만든다: us 선수를 홀더/리시버만 남기고 나머지를 결측 취급하도록
  //     GK 역할로 바꿔 releaser 후보에서 제외되게 한다.
  const e = createEngine(getScenario('B1'), 5001, { baitCombo: true });
  for (const p of e.state.players) {
    if (p.side === 'us' && p.role !== 'GK') p.role = 'GK';   // 홀더 제외 전원 GK화(릴리서 후보 소거)
  }
  const h = e.holder(); h.role = 'ST';   // 홀더만 필드 롤 유지
  const marker = e.state.players.find((p) => p.side === 'opp' && p.markId);
  if (marker) { h.x = marker.x + 3; h.y = marker.y; h.tx = h.x; h.ty = h.y; }
  let crashed = false, msg = '';
  try {
    const r1 = e.dispatch('carry', null, { x: marker.x + 1, y: marker.y }); settle(e);
    const r2 = e.dispatch('release'); settle(e);
    console.log(`  릴리서 없음: carry.ok=${r1.ok} baited=${!!e.state.baited} release.ok=${r2.ok} (기대: baited가 안 서거나, release가 안전 실패)`);
  } catch (err) { crashed = true; msg = err.message; }
  console.log(`  크래시: ${crashed} ${crashed ? `(${msg})` : ''}`);
}

console.log('\n완료.');
