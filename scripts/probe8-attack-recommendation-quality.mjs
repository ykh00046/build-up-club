// probe8-attack-recommendation-quality — 8R 항목 4: best 뿐 아니라 gamble/trap/reset
// 까지 전부 "실행 가능"(합법)하고 "말이 되는"(리시버 존재, 무의미한 후진 아님) 추천인지.
// 기존 probe-attack-bestlegal.mjs(7R 이전)는 best 만 검사했다 — 이번엔 4종 전부 +
// "물리적으로 이상한 추천"(뒤로 가는데도 최선으로 뽑히는 best, 타깃 없는 후보) 두 가지를
// 새로 검사한다.
//
// 실행: node scripts/probe8-attack-recommendation-quality.mjs [셀당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { offsideLine } from '../js/engine/space.js';
import { PITCH_W } from '../js/data/pitch.js';

const N = Number(process.argv[2] ?? 200);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;

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
  if (c.action === 'hold') return { legal: true }; // hold는 항상 합법(디스패치 가드 없음)
  if (c.action === 'carry') {
    // carry는 point 필요 — dispatch가 point 자체를 요구하진 않지만(전 지점 클램프),
    // previewCarry 산출 point가 실존해야 실행 가능한 추천이다.
    return { legal: !!c.point };
  }
  if (c.action === 'pass_space') {
    const aim = { x: Math.min((c.target?.x ?? 0) + 10, PITCH_W - 2), y: c.target?.y ?? 0 };
    const d = Math.hypot(aim.x - h.x, aim.y - h.y);
    if (d < 4) return { legal: false, why: 'tooClose' };
    if (d > 28 && (h.traits?.longPass ?? 0) < 0.5) return { legal: false, why: 'longGate' };
    if (c.target && isOffsideStatic(engine, c.target)) return { legal: false, why: 'offside' };
    return { legal: true };
  }
  // to_feet
  if (!c.target) return { legal: false, why: 'noReceiver' };
  if (c.target && isOffsideStatic(engine, c.target)) return { legal: false, why: 'offside' };
  return { legal: true };
}

const tally = {
  decisions: 0,
  perLane: { best: { n: 0, illegal: 0 }, gamble: { n: 0, illegal: 0 }, trap: { n: 0, illegal: 0 }, reset: { n: 0, illegal: 0 } },
  illegalWhy: {},
  bestBackward: 0, bestBackwardWithBetterForward: 0, bestBackwardByAction: {},
  noReceiverCandidates: 0, totalPassLikeCandidates: 0,
};

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
      for (const lane of ['best', 'gamble', 'trap', 'reset']) {
        const c = b[lane];
        if (!c) continue;
        tally.perLane[lane].n++;
        const leg = candidateLegality(engine, c);
        if (!leg.legal) {
          tally.perLane[lane].illegal++;
          tally.illegalWhy[`${lane}:${leg.why}`] = (tally.illegalWhy[`${lane}:${leg.why}`] || 0) + 1;
        }
      }
      // "뒤로 가는 best" — progress<=0(전진성 없음)인데도 best로 뽑혔는가.
      // reset은 설계상 후진 허용(안전 리사이클)이라 제외 — 여기선 best만.
      if ((b.best.progress ?? 0) <= 0 && b.best.type !== 'shot') {
        tally.bestBackward++;
        tally.bestBackwardByAction[b.best.action] = (tally.bestBackwardByAction[b.best.action] || 0) + 1;
        const betterForward = b.candidates.some((c) => c !== b.best && (c.progress ?? 0) > 4 && c.net >= b.best.net - 0.05);
        if (betterForward) tally.bestBackwardWithBetterForward++;
      }
      // 타깃 없는 pass류 후보(리시버 없는 추천)
      for (const c of b.candidates) {
        if (c.type === 'pass' && c.action !== 'hold' && c.action !== 'carry') {
          tally.totalPassLikeCandidates++;
          if (!c.target) tally.noReceiverCandidates++;
        }
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

console.log(`=== 추천 품질(best/gamble/trap/reset) 프로브 — 10셀 × ${N}경기 ===\n`);
for (const cell of CELLS) for (let i = 0; i < N; i++) playMatch(i * 7 + 13, cell);

const p = (a, b) => (b ? (a / b * 100).toFixed(2) : '0');
console.log(`결정 시점 ${tally.decisions}회\n`);
console.log('[레인별 합법성]');
for (const [lane, t] of Object.entries(tally.perLane)) {
  console.log(`  ${lane.padEnd(6)} 노출 ${String(t.n).padStart(6)}  불법 ${String(t.illegal).padStart(4)}  (${p(t.illegal, t.n)}%)`);
}
if (Object.keys(tally.illegalWhy).length) {
  console.log('\n[불법 사유 분해]');
  for (const [k, v] of Object.entries(tally.illegalWhy).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${v}`);
}

console.log('\n[물리적 이상 추천]');
console.log(`  best 후진(progress<=0, 슛 제외) ${tally.bestBackward} (${p(tally.bestBackward, tally.decisions)}%)`);
console.log(`    액션별: ${Object.entries(tally.bestBackwardByAction).map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log(`    그중 net이 비슷하거나 나은 전진 대안이 있었는데도 후진 best ${tally.bestBackwardWithBetterForward} (${p(tally.bestBackwardWithBetterForward, tally.decisions)}%)`);
console.log(`  리시버 없는 pass류 후보 ${tally.noReceiverCandidates}/${tally.totalPassLikeCandidates} (${p(tally.noReceiverCandidates, tally.totalPassLikeCandidates)}%)`);

console.log('\n[진단]');
const flags = [];
for (const [lane, t] of Object.entries(tally.perLane)) {
  if (t.illegal > 0) flags.push(`${lane}: 불법 추천 ${t.illegal}/${t.n} (${p(t.illegal, t.n)}%) — 실행 불가한 추천이 노출됨`);
}
if (tally.bestBackwardWithBetterForward > 0) flags.push(`best가 ${tally.bestBackwardWithBetterForward}회 "후진인데 비슷하거나 나은 전진 대안이 있었음에도" 선택됨 — net 랭킹이 방향성을 안 봄`);
if (tally.noReceiverCandidates > 0) flags.push(`리시버 없는 pass류 후보 ${tally.noReceiverCandidates}건 — 추천은 있는데 받을 사람이 없음`);
if (flags.length === 0) console.log('  발견 없음(PASS) — best/gamble/trap/reset 전부 합법, 후진 best·무수신 추천 0건.');
else for (const f of flags) console.log(`  - ${f}`);

console.log('\n완료.');
