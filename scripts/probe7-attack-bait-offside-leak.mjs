// 7R 감사 — 유인–3자 콤비 release() 오프사이드 우회 점검.
//
// [7R 수정 후] release()는 이제 drop을 offsideLine 앞으로 온사이드 클램프한다
// (engine.js: "오프사이드 정직성"). 이 프로브의 drop 재현식도 동일 클램프를 적용해
// '실제 착지'를 재현하므로, 수정이 유효하면 오프사이드율은 0에 수렴해야 한다.
// (수정 전에는 이 검사가 없어 백라인 마커 유인 시 86%가 오프사이드였다.)
//
// 발견 가설(수정 전): engine.js resolvePassTo()(to_feet/pass_space가 쓰는 공용 패스
// 해소)는 모든 전진 수신을 isOffside(target)로 검사하는데, release()는 이 공용 경로를
// 타지 않고 자체 로직으로 리시버를 drop 지점으로 직접 이동시켜 검사를 우회했다.
//
// 콤비의 존재 이유가 "마커 라인을 넘어 뒷공간으로 들어가는 라인 브레이크"이므로
// drop 지점(vacated.x+4, 즉 끌려나온 마커 원위치+4m 전진)이 상대 최종 수비라인
// (offsideLine = 최심 아웃필드 수비수 x)을 실제로 넘는 경우가 잦을 것이다. 다른
// 모든 전진 패스라면 여기서 실패(오프사이드)해야 하는데 release()는 그 검사가
// 없어 항상 "가로채기 위험"만으로 판정한다 — 규칙 우회.
//
// 측정: 자기대국(baitCombo on, evaluator가 유인을 추천) 중 실제 발생하는 모든
// bait→release 사이클에서, release 직전 state.baited.vacated로 drop 지점을 그대로
// 재현하고, 그 순간의 opps()로 offsideLine을 계산해 "resolvePassTo였다면 오프사이드로
// 막혔을 비율"을 잰다. 또한 마커의 라인(front/mid/back)별로 분해한다(백라인 마커를
// 유인하면 100%에 가깝게 오프사이드일 것이라는 가설).
//
// 실행: node scripts/probe7-attack-bait-offside-leak.mjs [경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { offsideLine } from '../js/engine/space.js';
import { PITCH_W, PITCH_H, clamp } from '../js/data/pitch.js';

const N = Number(process.argv[2] ?? 400);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];   // man/hybrid 스킴이 섞인 셀
const TURN_CAP = 60;

console.log(`=== 유인–3자 릴리스 오프사이드 우회 점검 (${CELLS.length}셀 × ${N}경기) ===\n`);

let totalReleases = 0, offsideReleases = 0, offsideSuccessful = 0;
let markerLineCounts = { front: 0, mid: 0, back: 0 };
let markerLineOffside = { front: 0, mid: 0, back: 0 };
let sampleCases = [];

for (const cell of CELLS) {
  let cellReleases = 0, cellOffside = 0;
  for (let i = 0; i < N; i++) {
    const e = createEngine(getScenario(cell), 90000 + i, { baitCombo: true });
    let turns = 0, stuck = 0;
    while (e.state.status === 'live' && turns < TURN_CAP) {
      settle(e);
      if (e.state.status !== 'live') break;
      const view = buildPolicyView(e, 'us');
      const a = aiPolicy(view);
      if (a.kind === 'noop') { if (++stuck > 4) break; continue; }

      // 7R 수정 후: '실제' 리시버 착지로 판정한다(pre-derive 재현은 release가 settle
      // 후 계산하는 offsideLine과 시점이 달라 부정확). release 전 홀더·라인을 스냅샷,
      // release 실행 후 리시버 좌표가 라인을 넘었는지 본다.
      if (a.actionId === 'release' && e.state.baited) {
        const b = e.state.baited;
        const opps = e.state.players.filter((p) => p.side === 'opp');
        const line = offsideLine(opps);
        const carrierX = e.holder()?.x ?? 0;
        const marker = e.state.players.find((p) => p.id === b.markerId);
        const r = executePolicyAction(e, a); settle(e);

        totalReleases++; cellReleases++;
        if (marker) markerLineCounts[marker.line] = (markerLineCounts[marker.line] || 0) + 1;
        if (r?.ok) {
          const recv = e.state.players.find((p) => p.id === b.receiverId);
          const isOff = recv && recv.x > carrierX && recv.x > line + 0.2;
          if (isOff) {
            offsideReleases++; cellOffside++; offsideSuccessful++;
            if (marker) markerLineOffside[marker.line] = (markerLineOffside[marker.line] || 0) + 1;
            if (sampleCases.length < 6) sampleCases.push({ cell, markerLine: marker?.line, dropX: recv.x.toFixed(1), offsideLine: line.toFixed(1) });
          }
        }
        if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
        turns++;
        continue;
      }

      const r = executePolicyAction(e, a); settle(e);
      if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
      turns++;
    }
  }
  console.log(`  ${cell}: 릴리스 ${cellReleases}회 중 오프사이드 판정 ${cellOffside}회 (${cellReleases ? (cellOffside / cellReleases * 100).toFixed(1) : '0.0'}%)`);
}

console.log(`\n[전체] 릴리스 ${totalReleases}회 중 오프사이드였을 것 ${offsideReleases}회 (${(offsideReleases / Math.max(1, totalReleases) * 100).toFixed(1)}%)`);
console.log(`       그 중 release()가 실제로 성공 처리한 건 ${offsideSuccessful}회 (엔진이 규칙 위반을 그대로 완성시킴)`);

console.log('\n[마커 라인별 분해]');
for (const line of ['front', 'mid', 'back']) {
  const c = markerLineCounts[line] || 0;
  const o = markerLineOffside[line] || 0;
  console.log(`  ${line.padEnd(4)}  n=${c}  오프사이드율 ${c ? (o / c * 100).toFixed(1) : '0.0'}%`);
}

console.log('\n[샘플: 오프사이드였을 릴리스]');
for (const s of sampleCases) {
  console.log(`  ${s.cell} marker.line=${s.markerLine}  drop.x=${s.dropX}  offsideLine=${s.offsideLine}`);
}

console.log('\n비교 참고: resolvePassTo()(engine.js:1050)는 모든 전진 패스에 isOffside(target)를');
console.log('강제한다(engine.js:1052-1054, log.offside 실패). release()(engine.js:1348)는 이 호출이');
console.log('없다 — 위 오프사이드% 만큼 "다른 액션이었다면 막혔을 패스"가 release 한정으로 통과한다.');
console.log('완료.');
