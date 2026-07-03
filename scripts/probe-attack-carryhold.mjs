// probe-attack-carryhold — hold/carry 가 죽은 선택인지 검증.
// (1) 구조 센서스: evaluateBoard 후보에 carry/hold 가 아예 없는지(코드상 없음) 수치 확인.
// (2) 반사실 실험: aiPolicy 에 carry/hold 를 주입한 변형 정책이 기본보다 나은가?
//     - aiCarry:  FINAL_THIRD 인데 슛존 밖이면 골문 쪽으로 운반해 존 진입 시도
//     - aiHold:   압박 낮고 best.net 나쁠 때 1회 홀드로 커밋(점프) 유도 후 창 사용
//     - aiBoth:   둘 다
//
// 실행: node scripts/probe-attack-carryhold.mjs [셀당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { PITCH_W, PITCH_H } from '../js/data/pitch.js';

const N = Number(process.argv[2] ?? 150);
const CELLS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
const TURN_CAP = 60;

// ── (1) 후보 센서스 ─────────────────────────────────────────────────
const census = { byAction: {}, boards: 0, emptyBoards: 0, bestByAction: {} };
function recordBoard(view) {
  const b = view.boardRead;
  if (!b) return;
  census.boards++;
  if (!b.candidates.length) census.emptyBoards++;
  for (const c of b.candidates) census.byAction[c.action] = (census.byAction[c.action] || 0) + 1;
  if (b.best) census.bestByAction[b.best.action] = (census.bestByAction[b.best.action] || 0) + 1;
}

// ── (2) 변형 정책 ───────────────────────────────────────────────────
function carryOverride(view, engine) {
  // 파이널서드인데 슛존 밖 → 존까지 몇 m 안 남았으면 운반으로 진입 (중앙으로 비스듬히).
  if (view.phase !== 'FINAL_THIRD' || view.legalActions.includes('shoot')) return null;
  const h = engine.holder();
  if (!h || h.x < 70) return null;
  const best = view.boardRead?.best;
  if (best && best.net > 0.35) return null; // 명백히 좋은 패스가 있으면 패스
  const ty = h.y + (PITCH_H / 2 - h.y) * 0.5;
  return { kind: 'engine_action', actionId: 'carry', point: { x: Math.min(h.x + 9, PITCH_W - 2), y: ty } };
}

function holdOverride(view, engine, held) {
  // 빌드업 초반, 압박 게이지 여유 있고 확실한 전진이 없을 때 1회 홀드 → 커밋 유도.
  if (view.phase !== 'BUILDUP') return null;
  if (engine.state.pressure > 55) return null;
  if (held.count >= 2) return null;
  const best = view.boardRead?.best;
  if (best && best.net > 0.25) return null;
  held.count++;
  return { kind: 'engine_action', actionId: 'hold' };
}

const variants = {
  base: () => (view) => aiPolicy(view),
  aiCarry: (engine) => (view) => (!view.situation && carryOverride(view, engine)) || aiPolicy(view),
  aiHold: (engine) => { const held = { count: 0 }; return (view) => (!view.situation && holdOverride(view, engine, held)) || aiPolicy(view); },
  aiBoth: (engine) => {
    const held = { count: 0 };
    return (view) => (!view.situation && (carryOverride(view, engine) || holdOverride(view, engine, held))) || aiPolicy(view);
  },
};

function playMatch(seed, cell, variantName, doCensus) {
  const engine = createEngine(getScenario(cell), seed);
  const policy = variants[variantName](engine);
  const actions = {};
  let turns = 0, stuck = 0, windowsUsed = 0;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    if (doCensus) recordBoard(view);
    const action = policy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const key = action.actionId || action.choiceId || action.kind;
    actions[key] = (actions[key] || 0) + 1;
    const r = executePolicyAction(engine, action);
    settle(engine);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  windowsUsed = engine.state.facts.windowsUsed;
  const o = engine.state.outcome;
  return { tone: o?.tone ?? 'timeout', turns, actions, windowsUsed, baits: engine.state.facts.baits };
}

console.log(`=== carry/hold 프로브: 10셀 × ${N}경기 × 4변형 ===\n`);

const results = {};
for (const v of Object.keys(variants)) results[v] = { goal: 0, near: 0, fail: 0, timeout: 0, turns: 0, carry: 0, hold: 0, windows: 0, n: 0 };

for (const cell of CELLS) {
  for (let i = 0; i < N; i++) {
    const seed = i * 7 + 13;
    for (const v of Object.keys(variants)) {
      const m = playMatch(seed, cell, v, v === 'base');
      results[v][m.tone] = (results[v][m.tone] || 0) + 1;
      results[v].turns += m.turns;
      results[v].carry += m.actions.carry || 0;
      results[v].hold += m.actions.hold || 0;
      results[v].windows += m.windowsUsed;
      results[v].n++;
    }
  }
}

const T = N * CELLS.length;
console.log('[후보 센서스] evaluateBoard 가 낸 후보의 액션 구성 (base 정책 경기 중 관측)');
console.log(`  보드 관측 ${census.boards}회 · 빈 보드 ${census.emptyBoards}회`);
for (const [k, v] of Object.entries(census.byAction).sort((a, b) => b[1] - a[1])) {
  console.log(`  후보 ${k.padEnd(12)} ${String(v).padStart(7)}`);
}
console.log('  best 추천 구성:', JSON.stringify(census.bestByAction));
console.log('  → carry/hold 후보 수:', (census.byAction.carry || 0) + (census.byAction.hold || 0));

console.log('\n[변형 정책 성과]');
console.log('변형     goal%   near%   fail%   t.o.%   평균턴  carry수  hold수  창사용');
for (const [v, r] of Object.entries(results)) {
  console.log(`${v.padEnd(8)} ${(r.goal / T * 100).toFixed(1).padStart(5)}  ${(r.near / T * 100).toFixed(1).padStart(6)}  ${(r.fail / T * 100).toFixed(1).padStart(6)}  ${(r.timeout / T * 100).toFixed(1).padStart(6)}  ${(r.turns / T).toFixed(1).padStart(6)}  ${String(r.carry).padStart(6)}  ${String(r.hold).padStart(6)}  ${String(r.windows).padStart(5)}`);
}
console.log('\n해석: aiCarry/aiHold 가 base 대비 goal% 를 올리면 → 정책이 아니라 evaluateBoard 가');
console.log('carry/hold 를 후보로 못 내는 것이 진짜 구멍(둘 다 UI 보드 추천에서도 죽어 있음).');
console.log('완료.');
