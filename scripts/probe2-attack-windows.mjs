// probe2-attack-windows — 2라운드: discipline/백프레셔 부작용 정량화.
// (1) 강도별 창 생성 분해: full_commit(수비수 committedTurns===2 발생) vs
//     real 창(엣지 성립) vs false 창(partial). real:fake 비율이 강도별로 어떻게 변했나.
// (2) 가짜 창에 속는 비용: 활성 false 창 반경 안으로 향한 패스 vs 그 외 패스의
//     실패율 비교(속으면 실제로 뭘 잃나). AI 정책은 winBonus 를 real 에만 주므로
//     "우연히" 가짜 창을 향한 패스가 표본이 된다.
// (3) 액션 믹스 + 압박 게이지 분포: pass_space 단조성·게이지 상시 ~3 유지 여부.
//
// 실행: node scripts/probe2-attack-windows.mjs [강도당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { PITCH_W } from '../js/data/pitch.js';

const N = Number(process.argv[2] ?? 400);
const TURN_CAP = 60;
const INTENSITIES = ['low', 'mid', 'high', 'vhigh'];

function passAimOf(action, engine) {
  // 정책 액션이 겨눈 지점(패스류만).
  if (action.actionId === 'pass_space' && action.point) return action.point;
  if (action.actionId === 'to_feet' && action.targetId) {
    const t = engine.state.players.find((p) => p.id === action.targetId);
    return t ? { x: t.x, y: t.y } : null;
  }
  return null;
}

function playMatch(seed, intensity, S) {
  const engine = createEngine(getScenario('A1'), seed, { intensityOverride: intensity, defenseLoop: false });
  let turns = 0, stuck = 0;
  while (engine.state.status === 'live' && turns < TURN_CAP) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }

    // ── 압박 게이지 샘플(액션 직전) ──
    if (!engine.state.matchDecision) S.pressureSamples.push(engine.state.pressure);

    // ── 액션 믹스 ──
    const aid = action.kind === 'engine_action' ? action.actionId : `sit:${action.choiceId}`;
    S.actions[aid] = (S.actions[aid] || 0) + 1;

    // ── 이 패스가 활성 창을 향했나(디스패치 전 창 기준) ──
    const wBefore = engine.rewardWindowVisible?.() ?? null;
    const aim = action.kind === 'engine_action' ? passAimOf(action, engine) : null;
    let aimedAtFalse = false, aimedAtReal = false;
    if (wBefore && aim) {
      const d = Math.hypot(aim.x - wBefore.x, aim.y - wBefore.y);
      if (d < wBefore.r) { if (wBefore.kind === 'false') aimedAtFalse = true; else aimedAtReal = true; }
    }

    // ── 커밋/창 관측: 디스패치 직후 새로 생긴 것 ──
    const preCommitted = new Set(engine.state.players.filter((p) => p.side === 'opp' && p.committedTurns > 0).map((p) => p.id));
    const r = executePolicyAction(engine, action);
    const isPass = aim !== null;
    if (isPass) {
      S.passes++;
      const failed = !r || r.ok === false;
      if (aimedAtFalse) { S.passIntoFalse++; if (failed) S.passIntoFalseFail++; }
      else if (aimedAtReal) { S.passIntoReal++; if (failed) S.passIntoRealFail++; }
      else { S.passPlain++; if (failed) S.passPlainFail++; }
    }
    // 새 full_commit: committedTurns===2 인 수비수가 새로 생김
    const newFull = engine.state.players.some((p) => p.side === 'opp' && p.committedTurns === 2 && !preCommitted.has(p.id));
    if (newFull) S.fullCommits++;
    const w = engine.state.rewardWindow;
    let newReal = false;
    if (w && w.openedTurnSeen !== true) {
      // 이 디스패치의 pressReact 가 만든 창(이전 창은 마킹됐거나 교체/소비됨).
      // full_commit+엣지→real(turn+2) / partial→false(turn+1)
      if (w.kind === 'real') { S.realWindows++; newReal = true; }
      else if (w.kind === 'false') S.falseWindows++;
      w.openedTurnSeen = true; // 프로브 전용 마킹(엔진은 이 필드를 안 읽음)
    }
    if (newFull && !newReal) S.fullNoEdge++; // 점프했지만 엣지 불성립 → real 창 미개방

    settle(engine);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(engine);
  const o = engine.state.outcome;
  S.windowsUsed += engine.state.facts.windowsUsed;
  return { tone: o?.tone ?? 'timeout', turns };
}

function pct(a, b) { return b ? (a / b * 100).toFixed(1) : '—'; }
function quantile(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

console.log(`=== 창(real/false) 분해 프로브: A1 × 강도 4종 × ${N}경기 ===\n`);

for (const intensity of INTENSITIES) {
  const S = {
    fullCommits: 0, fullNoEdge: 0, realWindows: 0, falseWindows: 0, windowsUsed: 0,
    passes: 0, passIntoFalse: 0, passIntoFalseFail: 0, passIntoReal: 0, passIntoRealFail: 0,
    passPlain: 0, passPlainFail: 0,
    actions: {}, pressureSamples: [],
  };
  const tones = { goal: 0, near: 0, fail: 0, timeout: 0 };
  let totTurns = 0;
  for (let i = 0; i < N; i++) {
    const m = playMatch(i * 7 + 13, intensity, S);
    tones[m.tone] = (tones[m.tone] || 0) + 1;
    totTurns += m.turns;
  }
  const totalActs = Object.values(S.actions).reduce((a, b) => a + b, 0);
  const mix = Object.entries(S.actions).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v, totalActs)}%`).join('  ');
  const ratio = S.falseWindows ? (S.realWindows / S.falseWindows).toFixed(2) : '∞';
  console.log(`[${intensity}] goal ${pct(tones.goal, N)}%  near ${pct(tones.near, N)}%  fail ${pct(tones.fail, N)}%  평균턴 ${(totTurns / N).toFixed(1)}`);
  console.log(`  창: full_commit ${S.fullCommits}회(엣지無 ${S.fullNoEdge}) → real ${S.realWindows} / false ${S.falseWindows}  (real:false = ${ratio}:1)  창사용 ${S.windowsUsed}회`);
  console.log(`  속는 비용: false창向 패스 ${S.passIntoFalse}건 실패 ${pct(S.passIntoFalseFail, S.passIntoFalse)}%  | real창向 ${S.passIntoReal}건 실패 ${pct(S.passIntoRealFail, S.passIntoReal)}%  | 창밖 ${S.passPlain}건 실패 ${pct(S.passPlainFail, S.passPlain)}%`);
  console.log(`  게이지: 중앙값 ${quantile(S.pressureSamples, 0.5)}  p90 ${quantile(S.pressureSamples, 0.9)}  max ${Math.max(...S.pressureSamples)}  (샘플 ${S.pressureSamples.length})`);
  console.log(`  믹스: ${mix}\n`);
}
console.log('완료.');
