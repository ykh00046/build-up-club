// 7R 감사 — 유인–3자 콤비 회귀: (A) baitCombo 옵트인 불변식, (B) ON/OFF goal% 밴드
// 이탈 여부(특히 man B1/B2), (C) release 실패 → 턴오버 → 수비 국면 정상 연결.
//
// 실행: node scripts/probe7-attack-bait-invariant-band.mjs [셀당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 400);
const CELLS = ['A1', 'A2', 'B1', 'B2'];
const TURN_CAP = 60;

// ── (A) baitCombo:false 옵트인 불변식 ──────────────────────────────────────
console.log('=== (A) baitCombo OFF 옵트인 불변식 (기본값, 명시 false 둘 다) ===');
for (const flagLabel of ['기본값(미지정)', 'false 명시']) {
  const opts = flagLabel === 'false 명시' ? { baitCombo: false } : {};
  let games = 0, previewNonNull = 0, baitedEverSet = 0, releaseCalled = 0, releaseSucceeded = 0, carryDivergence = 0;
  for (const cell of CELLS) {
    for (let i = 0; i < N; i++) {
      const e = createEngine(getScenario(cell), 81000 + i, opts);
      games++;
      let turns = 0, stuck = 0;
      while (e.state.status === 'live' && turns < TURN_CAP) {
        settle(e);
        if (e.state.status !== 'live') break;
        if (e.holder?.()?.side === 'us') {
          const pv = e.previewBait?.();
          if (pv !== null && pv !== undefined) previewNonNull++;
        }
        if (e.state.baited) baitedEverSet++;
        const view = buildPolicyView(e, 'us');
        const a = aiPolicy(view);
        if (a.kind === 'noop') { if (++stuck > 4) break; continue; }
        if (a.actionId === 'release') {
          releaseCalled++;
          const r = executePolicyAction(e, a); settle(e);
          if (r?.ok) releaseSucceeded++;
          if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
          turns++;
          continue;
        }
        const r = executePolicyAction(e, a); settle(e);
        if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
        turns++;
      }
    }
  }
  console.log(`  [${flagLabel}] 경기 ${games} | previewBait 비-null ${previewNonNull}회 | state.baited 관측 ${baitedEverSet}회 | release 시도 ${releaseCalled}회(성공 ${releaseSucceeded})`);
  console.log(`  legalActionsFor는 baited일 때만 release를 노출하므로(policy.js:57) release 시도 자체가 0이면 정상.`);
}

// ── (B) ON/OFF goal% 밴드 비교 ─────────────────────────────────────────────
console.log('\n=== (B) baitCombo ON vs OFF — goal% 밴드 (동일 시드) ===');
function runBand(cell, on) {
  let goal = 0, near = 0, fail = 0, games = 0;
  for (let i = 0; i < N; i++) {
    const e = createEngine(getScenario(cell), 82000 + i, on ? { baitCombo: true } : {});
    games++;
    let turns = 0, stuck = 0;
    while (e.state.status === 'live' && turns < TURN_CAP) {
      settle(e);
      if (e.state.status !== 'live') break;
      const view = buildPolicyView(e, 'us');
      const a = aiPolicy(view);
      if (a.kind === 'noop') { if (++stuck > 4) break; continue; }
      const r = executePolicyAction(e, a); settle(e);
      if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
      turns++;
    }
    const tone = e.state.outcome?.tone ?? 'timeout';
    if (tone === 'goal') goal++;
    else if (tone === 'near') near++;
    else fail++;
  }
  return { games, goal, near, fail, goalPct: goal / games * 100 };
}

for (const cell of CELLS) {
  const off = runBand(cell, false);
  const on = runBand(cell, true);
  const delta = on.goalPct - off.goalPct;
  const flag = Math.abs(delta) >= 5 ? '  <-- 5pp+ 이탈' : '';
  console.log(`  ${cell}: OFF goal% ${off.goalPct.toFixed(1)}  ON goal% ${on.goalPct.toFixed(1)}  Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp${flag}`);
}
console.log('  참고: docs/bait-third-man-design.md는 "콤비는 순EV 최적이 아니다(man에서 AI가 쓰면 -5pp)"를');
console.log('  이미 알려진 트레이드오프로 문서화했다 — 여기 목적은 그 -5pp 안에 있는지, 더 벌어졌는지 확인.');

// ── (C) release 실패 → 턴오버 → 수비 국면 정상 연결 ────────────────────────
console.log('\n=== (C) release 실패 시 턴오버 → 수비 국면 연결 (유령 상태 없는지) ===');
{
  let releaseFails = 0, properTurnover = 0, ghostBaited = 0, ghostStatus = 0, transitionEntered = 0;
  for (const cell of ['B1', 'B2']) {
    for (let i = 0; i < N; i++) {
      const e = createEngine(getScenario(cell), 83000 + i, { baitCombo: true });
      let turns = 0, stuck = 0;
      while (e.state.status === 'live' && turns < TURN_CAP) {
        settle(e);
        if (e.state.status !== 'live') break;
        const view = buildPolicyView(e, 'us');
        const a = aiPolicy(view);
        if (a.kind === 'noop') { if (++stuck > 4) break; continue; }
        if (a.actionId === 'release') {
          const r = executePolicyAction(e, a); settle(e);
          if (!r.ok) {
            releaseFails++;
            // 기대: turnover 로 상태 전환(수비 국면 진입: state.transition 또는
            // state.status !== 'live') — state.baited는 이미 release()가 즉시
            // null 처리(engine.js:1373)하지만, 혹시 남아있는지도 재확인.
            if (e.state.baited) ghostBaited++;
            if (e.state.status !== 'live') properTurnover++;
            else if (e.state.transition) { properTurnover++; transitionEntered++; }
            else if (e.holder?.()?.side === 'opp') properTurnover++;
            else ghostStatus++;
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
  }
  console.log(`  release 실패(가로채기) ${releaseFails}회`);
  console.log(`  정상 턴오버(소유권 opp/경기종료/전환창 진입) ${properTurnover}회 (그 중 전환창 ${transitionEntered}회)`);
  console.log(`  유령 state.baited 잔존 ${ghostBaited}회, 유령 상태(턴오버 안 됨) ${ghostStatus}회`);
}

console.log('\n완료.');
