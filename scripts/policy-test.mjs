// Phase 0 정책 계약 회귀 — docs/symmetric-duel-design.md.
// 정책이 (1) 유효한 PolicyAction 을 내고 (2) state 를 직접 안 건드리고
// (3) 한 경기를 완주시키며 (4) 결과가 degenerate 하지 않음을 고정한다.

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import {
  buildPolicyView, executePolicyAction, attackPolicy, pressPolicy, aiPolicy,
  isValidPolicyAction, settle, buildPressDecisionTrace,
} from '../js/engine/policy.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };

console.log('=== 정책 계약 테스트 (Phase 0) ===\n');

// [1] PolicyView / PolicyAction 형태
let e = createEngine(getScenario('A1'), 7);
const view = buildPolicyView(e, 'us');
ok(view.side === 'us' && view.possession === 'us', 'view: side·possession 채워짐');
ok(Array.isArray(view.legalActions) && view.legalActions.length > 0, 'view: legalActions 존재');
ok(view.boardRead !== undefined, 'view: boardRead 필드 존재');
ok(view.oppBuildRead?.possession === 'opp', 'view: oppBuildRead 필드 존재');
ok(view.oppBuildRead?.holderAssumption === 'deepest', 'view: 우리 점유 중 oppBuildRead 는 최후방 빌더 가정');
const a = aiPolicy(view);
ok(isValidPolicyAction(a), 'attack 정책이 유효한 PolicyAction 반환');
ok(a.kind === 'engine_action' && typeof a.actionId === 'string', 'engine_action 형태');
ok(Array.isArray(view.recentActions), 'view: recentActions 존재');

const spaceCandidate = view.boardRead?.candidates.find((candidate) => candidate.action === 'pass_space');
if (spaceCandidate) {
  const spaceAction = attackPolicy({ ...view, boardRead: { ...view.boardRead, best: spaceCandidate, candidates: [spaceCandidate] } });
  ok(spaceAction.point.x > spaceCandidate.target.x, '공간 패스 정책은 선수 발밑이 아니라 앞 공간을 겨냥');
}

// [2] 정책은 state 를 직접 수정하지 않는다
const snap = JSON.stringify({ phase: e.state.phase, holderId: e.state.holderId, turn: e.state.turn, status: e.state.status });
aiPolicy(buildPolicyView(e, 'us'));
buildPolicyView(e, 'us');
const snap2 = JSON.stringify({ phase: e.state.phase, holderId: e.state.holderId, turn: e.state.turn, status: e.state.status });
ok(snap === snap2, '정책/뷰 생성은 state 를 변경하지 않음');

// [3] 압박 정책 — 결정이 열리면 유효한 선택지
e = createEngine(getScenario('A1'), 11);
e.openPressingMode();
const pview = buildPolicyView(e, 'us');
ok(pview.situation?.id === 'defensive_press', 'view: 압박 상황 노출');
ok(pview.oppBuildRead?.holderAssumption === 'actual', 'view: 압박 상황 oppBuildRead 는 실제 상대 점유자 기준');
ok(pview.oppBuildRead?.holderId === e.state.holderId, 'view: oppBuildRead holderId 가 현재 상대 점유자와 일치');
const pa = pressPolicy(pview);
ok(isValidPolicyAction(pa) && pa.kind === 'situation_choice', '압박 정책이 situation_choice 반환');
ok(['dp_press', 'dp_cut', 'dp_drop'].includes(pa.choiceId), '압박 선택지가 유효함');
const ptrace = buildPressDecisionTrace(pview, pa);
ok(ptrace?.choiceId === pa.choiceId, '압박 trace: 선택지 기록');
ok(ptrace?.holderAssumption === 'actual', '압박 trace: 실제 상대 점유 기준 기록');
ok(ptrace?.best === null || Number.isFinite(ptrace.best.risk), '압박 trace: best 레인 위험도 요약');
ok(typeof ptrace?.pressingOpinion === 'string' && ptrace.pressingOpinion.length > 0, '압박 trace: 압박 AI 의견 포함');
ok(typeof ptrace?.buildUpOpinion === 'string' && ptrace.buildUpOpinion.length > 0, '압박 trace: 탈압박 AI 의견 포함');

const pressBase = {
  situation: { id: 'defensive_press', choices: [{ id: 'dp_press' }, { id: 'dp_cut' }, { id: 'dp_drop' }] },
  pressRead: { regainP: 0.43, cutP: 0.39 },
};
const laneCut = pressPolicy({
  ...pressBase,
  oppBuildRead: {
    best: { risk: 0.22, safety: 0.78, net: 0.24 },
    gamble: { risk: 0.48 },
    trap: { risk: 0.72 },
  },
});
ok(laneCut.choiceId === 'dp_cut', '압박 정책: oppBuildRead 의 위험 레인이 있으면 차단 선택');

const safeEscapeDrop = pressPolicy({
  ...pressBase,
  oppBuildRead: {
    best: { risk: 0.08, safety: 0.93, net: 0.44 },
    gamble: { risk: 0.16 },
    trap: { risk: 0.2 },
  },
});
ok(safeEscapeDrop.choiceId === 'dp_drop', '압박 정책: 상대 최선 탈출 루트가 안전하면 후퇴 선택');
ok(buildPressDecisionTrace(view, a) === null, '압박 trace: defensive_press 가 아니면 null');

// [4] 한 경기 완주 (정책만으로, 사람 입력 없이)
function autoPlay(seed) {
  const eng = createEngine(getScenario('A1'), seed);
  let turns = 0, stuck = 0;
  while (eng.state.status === 'live' && turns < 60) {
    settle(eng);
    if (eng.state.status !== 'live') break;
    const act = aiPolicy(buildPolicyView(eng, 'us'));
    if (act.kind === 'noop') { if (++stuck > 4) break; continue; }
    const r = executePolicyAction(eng, act);
    settle(eng);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(eng);
  return { status: eng.state.status, tone: eng.state.outcome?.tone ?? 'timeout', turns };
}
const run = autoPlay(3);
ok(run.status === 'over' || run.turns >= 1, '정책만으로 경기가 진행/종료됨');

// [5] 비-degenerate — 여러 시드에서 결과가 한 가지로 고정되지 않음
const tones = new Set();
let finished = 0;
for (let i = 0; i < 40; i++) {
  const r = autoPlay(i * 5 + 1);
  tones.add(r.tone);
  if (r.status === 'over') finished++;
}
ok(finished >= 30, `대부분 경기가 종료됨 (${finished}/40)`);
ok(tones.size >= 2, `결과가 다양함 (tones: ${[...tones].join(',')})`);

console.log(fail === 0 ? '\n정책 계약 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
