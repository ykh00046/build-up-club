// 강도별 득점 출처 분해 — vhigh가 왜 더 쉬운가를 사실(facts)로 가른다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 400);

function play(seed, intensity) {
  const e = createEngine(getScenario('A1'), seed, { intensityOverride: intensity, defenseLoop: false });
  let turns = 0, stuck = 0;
  while (e.state.status === 'live' && turns < 60) {
    settle(e);
    if (e.state.status !== 'live') break;
    const a = aiPolicy(buildPolicyView(e, 'us'));
    if (a.kind === 'noop') { if (++stuck > 4) break; continue; }
    const r = executePolicyAction(e, a);
    settle(e);
    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
  settle(e);
  return e.state;
}

for (const it of ['mid', 'vhigh']) {
  const agg = { n: 0, goals: 0, win: 0, lines: 0, baits: 0, shots: 0, xgSum: 0, goalXg: 0, goalWin: 0, commits: 0 };
  for (let i = 0; i < N; i++) {
    const s = play(9000 + i, it);
    const f = s.facts || {};
    agg.n++;
    agg.win += f.windowsUsed ?? 0;
    agg.lines += f.linesBroken ?? 0;
    agg.baits += f.baits ?? 0;
    const o = s.outcome;
    if (o?.xg != null) { agg.shots++; agg.xgSum += o.xg; }
    if (o?.tone === 'goal') {
      agg.goals++;
      agg.goalXg += o.xg ?? 0;
      agg.goalWin += f.windowsUsed ?? 0;
    }
  }
  console.log(`${it}: goal ${(agg.goals / agg.n * 100).toFixed(1)}% | 경기당 창사용 ${(agg.win / agg.n).toFixed(2)} 라인브레이크 ${(agg.lines / agg.n).toFixed(2)} 베이트 ${(agg.baits / agg.n).toFixed(2)} | 슛경기 ${(agg.shots / agg.n * 100).toFixed(0)}% 평균xG ${(agg.xgSum / Math.max(1, agg.shots)).toFixed(3)} | 골경기 평균xG ${(agg.goalXg / Math.max(1, agg.goals)).toFixed(3)} 골경기 창사용 ${(agg.goalWin / Math.max(1, agg.goals)).toFixed(2)}`);
}
