// probe-attack-bestlegal — evaluateBoard/scanOptions 추천이 "실행 가능한" 액션인지 검증.
// scanOptions 는 pass_space 조준점 최소거리(d<4 거부)와 오프사이드를 검사하지 않는다.
// 매 결정 시점에 best/후보 전체의 디스패치 합법성을 정적으로 판정해 비율을 잰다.
//
// 실행: node scripts/probe-attack-bestlegal.mjs [셀당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { offsideLine } from '../js/engine/space.js';
import { PITCH_W } from '../js/data/pitch.js';

const N = Number(process.argv[2] ?? 150);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;

const tally = {
  decisions: 0,
  bestIllegal: 0,
  bestTooClose: 0,
  bestOffside: 0,
  candIllegal: 0,
  candTotal: 0,
  perCell: {},
};

function isOffsideStatic(engine, p) {
  const h = engine.holder();
  if (!h || p.x <= h.x) return false;
  const line = offsideLine(engine.state.players.filter((d) => d.side === 'opp'));
  return p.x > line + 0.2;
}

function candidateLegality(engine, c) {
  const h = engine.holder();
  if (!h) return { legal: true };
  if (c.type === 'shot') return { legal: !!engine.shotZoneNow?.() };
  if (c.action === 'pass_space') {
    const aim = { x: Math.min((c.target?.x ?? 0) + 10, PITCH_W - 2), y: c.target?.y ?? 0 };
    const d = Math.hypot(aim.x - h.x, aim.y - h.y);
    if (d < 4) return { legal: false, why: 'tooClose' };
    if (d > 28 && (h.traits?.longPass ?? 0) < 0.5) return { legal: false, why: 'longGate' };
    if (c.target && isOffsideStatic(engine, c.target)) return { legal: false, why: 'offside' };
    return { legal: true };
  }
  // to_feet
  if (c.target && isOffsideStatic(engine, c.target)) return { legal: false, why: 'offside' };
  return { legal: true };
}

function playMatch(seed, cell) {
  const engine = createEngine(getScenario(cell), seed);
  let turns = 0, stuck = 0;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');

    const b = view.boardRead;
    if (b?.best) {
      tally.decisions++;
      const cellT = tally.perCell[cell] ?? (tally.perCell[cell] = { n: 0, bad: 0 });
      cellT.n++;
      const leg = candidateLegality(engine, b.best);
      if (!leg.legal) {
        tally.bestIllegal++;
        cellT.bad++;
        if (leg.why === 'tooClose') tally.bestTooClose++;
        if (leg.why === 'offside') tally.bestOffside++;
      }
      for (const c of b.candidates) {
        tally.candTotal++;
        if (!candidateLegality(engine, c).legal) tally.candIllegal++;
      }
    }

    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const r = executePolicyAction(engine, action);
    settle(engine);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
}

console.log(`=== best 합법성 프로브: 10셀 × ${N}경기 ===\n`);
for (const cell of CELLS) for (let i = 0; i < N; i++) playMatch(i * 7 + 13, cell);

const p = (a, b) => (b ? (a / b * 100).toFixed(1) : '0');
console.log(`결정 시점 ${tally.decisions}회`);
console.log(`  best 가 디스패치 불가:      ${tally.bestIllegal} (${p(tally.bestIllegal, tally.decisions)}%)`);
console.log(`    ├ pass_space 조준 4m 미만: ${tally.bestTooClose} (${p(tally.bestTooClose, tally.decisions)}%)`);
console.log(`    └ 오프사이드 수신자:       ${tally.bestOffside} (${p(tally.bestOffside, tally.decisions)}%)`);
console.log(`  후보 전체 불법 비율:         ${tally.candIllegal}/${tally.candTotal} (${p(tally.candIllegal, tally.candTotal)}%)`);
console.log('\n[셀별 best 불법률]');
for (const [cell, c] of Object.entries(tally.perCell)) {
  console.log(`  ${cell}  ${p(c.bad, c.n).padStart(5)}%  (${c.bad}/${c.n})`);
}
console.log('\n참고: scanOptions(engine.js)가 UI 오버레이·힌트에도 그대로 쓰인다 — 불법 추천은 플레이어에게도 노출.');
console.log('완료.');
