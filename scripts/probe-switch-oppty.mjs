// 스위치 병목 진단 — 스위치가 '가능'한데(약측 동료가 열림) '안 쓰이는'지,
// 아니면 상황이 희소한지 가른다. 매 결정 시점에 (a) 열린 약측 스위치 후보 존재
// 여부, (b) AI가 실제 고른 액션의 스위치 여부를 집계.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { nearestDefender } from '../js/engine/space.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 400);
const CELLS = ['A1', 'A2', 'B1', 'B2'];

let decisions = 0, switchAvail = 0, switchPlayed = 0, gamesWithSwitch = 0;

for (const cell of CELLS) {
  for (let i = 0; i < N; i++) {
    const e = createEngine(getScenario(cell), 7000 + i);
    let turns = 0, stuck = 0, playedSwitchThisGame = false;
    while (e.state.status === 'live' && turns < 60) {
      settle(e);
      if (e.state.status !== 'live') break;
      const h = e.holder();
      if (h?.side === 'us') {
        // 열린 약측 스위치 후보 존재? (|Δy|>20 동료 중 최근접 수비수 12m+)
        const mates = e.state.players.filter((p) => p.side === 'us' && p.id !== h.id && p.role !== 'GK');
        const opps = e.state.players.filter((p) => p.side === 'opp');
        const openSwitch = mates.some((m) => Math.abs(m.y - h.y) > 20 && nearestDefender(m, opps).d > 12);
        decisions++;
        if (openSwitch) switchAvail++;
      }
      const view = buildPolicyView(e, 'us');
      const action = aiPolicy(view);
      if (action.kind === 'noop') { if (++stuck > 4) break; continue; }
      const before = e.state.facts.switches;
      const r = executePolicyAction(e, action);
      settle(e);
      if (e.state.facts.switches > before) { switchPlayed++; playedSwitchThisGame = true; }
      if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
      turns++;
    }
    if (playedSwitchThisGame) gamesWithSwitch++;
  }
}

const G = N * CELLS.length;
console.log(`=== 스위치 기회 vs 실행 — ${CELLS.join('/')} × ${N}경기 ===`);
console.log(`결정 시점 ${decisions} | 열린 약측 스위치 가용 ${switchAvail} (${(switchAvail/decisions*100).toFixed(1)}%)`);
console.log(`실제 스위치 실행 ${switchPlayed} (가용 대비 ${(switchPlayed/Math.max(1,switchAvail)*100).toFixed(1)}%)`);
console.log(`스위치 1+ 경기 ${gamesWithSwitch}/${G} (${(gamesWithSwitch/G*100).toFixed(1)}%)`);
console.log('해석: 가용은 높은데 실행이 낮으면 → evaluator 저평가(보너스 필요). 가용 자체가 낮으면 → 상황 희소.');
