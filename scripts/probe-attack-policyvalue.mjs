// probe-attack-policyvalue — evaluateBoard 추천의 실제 가치 검증.
// 같은 시드에서 4개 정책을 비교한다:
//   ai      = aiPolicy(반복 페널티 + 슛 게이트 포함)
//   greedy  = boardRead.best 를 그대로 따름(net 1위, 가공 없음)
//   safest  = 최저 risk 후보만 따름(전진 무시) — "안전 지상주의"가 이기면 net 가중이 틀린 것
//   random  = 합법 액션 균등 랜덤(홀드/캐리/슛 포함) — 하한 기준선
//
// 실행: node scripts/probe-attack-policyvalue.mjs [셀당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { PITCH_W } from '../js/data/pitch.js';

const N = Number(process.argv[2] ?? 120);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;

function toAction(candidate) {
  if (!candidate) return { kind: 'engine_action', actionId: 'hold' };
  if (candidate.type === 'shot') return { kind: 'engine_action', actionId: 'shoot' };
  if (candidate.action === 'pass_space') {
    return { kind: 'engine_action', actionId: 'pass_space', point: { x: Math.min((candidate.target?.x ?? 0) + 10, PITCH_W - 2), y: candidate.target?.y } };
  }
  return { kind: 'engine_action', actionId: 'to_feet', targetId: candidate.target?.id };
}

const policies = {
  ai: (view) => aiPolicy(view),

  greedy: (view) => {
    if (view.situation) return aiPolicy(view);
    return toAction(view.boardRead?.best ?? null);
  },

  safest: (view) => {
    if (view.situation) return aiPolicy(view);
    const cands = view.boardRead?.candidates ?? [];
    const shot = cands.find((c) => c.type === 'shot');
    if (shot && shot.safety >= 0.3) return toAction(shot);
    const safest = [...cands].filter((c) => c.type !== 'shot').sort((a, b) => a.risk - b.risk)[0];
    return toAction(safest ?? null);
  },

  random: (view, engine, rand) => {
    if (view.situation) {
      const cs = view.situation.choices;
      return { kind: 'situation_choice', choiceId: cs[Math.floor(rand() * cs.length)].id };
    }
    const h = engine.holder();
    const mates = engine.state.players.filter((p) => p.side === 'us' && p.role !== 'GK' && p.id !== h.id);
    const opts = [];
    for (const m of mates) {
      opts.push({ kind: 'engine_action', actionId: 'to_feet', targetId: m.id });
      opts.push({ kind: 'engine_action', actionId: 'pass_space', point: { x: Math.min(m.x + 10, PITCH_W - 2), y: m.y } });
    }
    opts.push({ kind: 'engine_action', actionId: 'hold' });
    opts.push({ kind: 'engine_action', actionId: 'carry', point: { x: Math.min(h.x + 8, PITCH_W - 2), y: h.y + (rand() * 8 - 4) } });
    if (view.legalActions.includes('shoot')) opts.push({ kind: 'engine_action', actionId: 'shoot' });
    return opts[Math.floor(rand() * opts.length)];
  },
};

// 결정적 LCG — random 정책 재현용.
function makeRand(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function playMatch(seed, cell, policyName) {
  const engine = createEngine(getScenario(cell), seed);
  const rand = makeRand(seed * 31 + 7);
  const policy = policies[policyName];
  let turns = 0, stuck = 0;
  const stuckCap = policyName === 'random' ? 12 : 4; // 랜덤은 재추첨 허용
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = policy(view, engine, rand);
    if (!action || action.kind === 'noop') { if (++stuck > stuckCap) break; continue; }
    const r = executePolicyAction(engine, action);
    settle(engine);
    if (!r || r.ok === false) { if (++stuck > stuckCap) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  return { tone: o?.tone ?? 'timeout', kind: o?.kind ?? 'timeout', turns };
}

console.log(`=== 정책 가치 프로브: 10셀 × ${N}경기 × 4정책 ===\n`);

const results = {};
for (const p of Object.keys(policies)) results[p] = { goal: 0, near: 0, fail: 0, timeout: 0, turns: 0, n: 0 };

for (const cell of CELLS) {
  for (let i = 0; i < N; i++) {
    const seed = i * 7 + 13;
    for (const p of Object.keys(policies)) {
      const m = playMatch(seed, cell, p);
      results[p][m.tone] = (results[p][m.tone] || 0) + 1;
      results[p].turns += m.turns;
      results[p].n++;
    }
  }
}

const T = N * CELLS.length;
console.log('정책     goal%   near%   fail%   t.o.%   평균턴');
for (const [p, r] of Object.entries(results)) {
  console.log(`${p.padEnd(8)} ${(r.goal / T * 100).toFixed(1).padStart(5)}  ${(r.near / T * 100).toFixed(1).padStart(6)}  ${(r.fail / T * 100).toFixed(1).padStart(6)}  ${(r.timeout / T * 100).toFixed(1).padStart(6)}  ${(r.turns / T).toFixed(1).padStart(6)}`);
}

console.log('\n해석: ai/greedy 가 random 을 크게 못 이기면 evaluateBoard net 이 실제 성공과 어긋남.');
console.log('safest 가 greedy 를 이기면 risk 대비 전진 보상(net 가중)이 과대.');
console.log('완료.');
