// probe-attack-press-sanity — 상대 압박수 위치/움직임 합리성 + 압박 강도 구별성.
// (1) 강도 스윕: A1 시나리오에 intensityOverride low/mid/high/vhigh — goal%/턴/압박게이지가
//     실제로 달라지는가(무의미하면 디비전 램프 글루가 헛돎).
// (2) 홀더 주변 진공: 액션 직전 최근접 수비수 거리 분포 — BUILDUP/PROGRESSION 중
//     10m+ 진공 비율(압박이 '압박'인가).
// (3) 순간이동: 액션 1회(디스패치+정착) 동안 수비수 이동거리 최대값 분포 — 13m 초과는
//     MAX_STEP_COMMIT(10)·dt(≤1.15) 상한 위반 후보.
//
// 실행: node scripts/probe-attack-press-sanity.mjs [강도당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 200);
const TURN_CAP = 60;
const INTENSITIES = ['low', 'mid', 'high', 'vhigh'];

function playMatch(seed, intensity, stats) {
  const engine = createEngine(getScenario('A1'), seed, { intensityOverride: intensity });
  let turns = 0, stuck = 0;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }

    // 관측: 액션 직전 홀더-최근접 수비수 거리 (우리 소유·정상 국면만)
    const h = engine.holder?.();
    const phase = engine.state.phase;
    if (h && h.side === 'us' && (phase === 'BUILDUP' || phase === 'PROGRESSION' || phase === 'FINAL_THIRD') && !engine.state.matchDecision) {
      let nd = Infinity;
      for (const d of engine.state.players) {
        if (d.side !== 'opp' || d.line === 'gk') continue;
        const dd = Math.hypot(d.x - h.x, d.y - h.y);
        if (dd < nd) nd = dd;
      }
      stats.holderDist.push(nd);
      if (nd > 10) stats.vacuum++;
      if (nd > 16) stats.deepVacuum++;
      stats.holderObs++;
    }

    // 관측: 수비수 위치 스냅샷 → 액션 후 이동거리
    const before = new Map();
    for (const d of engine.state.players) if (d.side === 'opp') before.set(d.id, { x: d.x, y: d.y });
    const r = executePolicyAction(engine, action);
    settle(engine);
    let maxMove = 0;
    for (const d of engine.state.players) {
      if (d.side !== 'opp') continue;
      const b = before.get(d.id);
      if (!b) continue;
      const mv = Math.hypot(d.x - b.x, d.y - b.y);
      if (mv > maxMove) maxMove = mv;
    }
    if (engine.state.status === 'live' && engine.state.possession === 'us') {
      stats.maxMoves.push(maxMove);
      if (maxMove > 13) stats.teleports++;
    }

    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  return { tone: o?.tone ?? 'timeout', turns, pressureEnd: engine.state.pressure };
}

function quantile(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

console.log(`=== 압박 새너티 프로브: A1 × 강도 4종 × ${N}경기 ===\n`);
console.log('강도    goal%  near%  fail%  t.o.%  평균턴  압박끝  홀더최근접(중앙값/p10/p90)  진공10m+%  진공16m+%  텔레포트>13m');

for (const intensity of INTENSITIES) {
  const stats = { holderDist: [], holderObs: 0, vacuum: 0, deepVacuum: 0, maxMoves: [], teleports: 0 };
  const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
  let totTurns = 0, totPressure = 0;
  for (let i = 0; i < N; i++) {
    const m = playMatch(i * 7 + 13, intensity, stats);
    tones[m.tone] = (tones[m.tone] || 0) + 1;
    totTurns += m.turns;
    totPressure += m.pressureEnd;
  }
  const p = (x) => (x / N * 100).toFixed(1);
  const med = quantile(stats.holderDist, 0.5).toFixed(1);
  const p10 = quantile(stats.holderDist, 0.1).toFixed(1);
  const p90 = quantile(stats.holderDist, 0.9).toFixed(1);
  console.log(`${intensity.padEnd(6)} ${p(tones.goal).padStart(6)} ${p(tones.near).padStart(6)} ${p(tones.fail).padStart(6)} ${p(tones.timeout).padStart(6)}  ${(totTurns / N).toFixed(1).padStart(5)}  ${(totPressure / N).toFixed(0).padStart(5)}  ${med}/${p10}/${p90}`.padEnd(96)
    + ` ${(stats.vacuum / (stats.holderObs || 1) * 100).toFixed(1).padStart(7)}  ${(stats.deepVacuum / (stats.holderObs || 1) * 100).toFixed(1).padStart(7)}  ${String(stats.teleports).padStart(5)}/${stats.maxMoves.length}`);
}

console.log('\n해석: 강도별 goal% 차이가 ~3%p 이내면 intensityOverride(디비전 램프)가 체감 없음.');
console.log('진공10m+% 가 높으면 홀더가 사실상 무압박 — 압박 게임이 성립 안 함.');
console.log('완료.');
