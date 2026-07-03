// 4R 플랜 C 1순위 — fail% 급락 + goal% 강도 상충 분해.
// defenseLoop ON/OFF 대조로 "수비 국면 완화분 vs 공격 자체 변화분"을 가른다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 500);

function play(seed, intensity, defenseLoop) {
  const e = createEngine(getScenario('A1'), seed, { intensityOverride: intensity, defenseLoop });
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
  return e.state.outcome ?? { tone: 'timeout', kind: 'timeout' };
}

for (const dl of [false, true]) {
  console.log(`\n=== defenseLoop ${dl ? 'ON' : 'OFF'} — A1 × 강도 4종 × ${N} ===`);
  console.log('강도   goal%  near%  fail%  conceded%  timeout%');
  for (const it of ['low', 'mid', 'high', 'vhigh']) {
    const c = { goal: 0, near: 0, fail: 0, conceded: 0, timeout: 0, n: 0 };
    for (let i = 0; i < N; i++) {
      const o = play(5000 + i, it, dl);
      c.n++;
      if (o.kind === 'conceded') c.conceded++;
      const tone = o.tone ?? 'timeout';
      if (tone === 'goal') c.goal++;
      else if (tone === 'near') c.near++;
      else if (o.kind === 'timeout') c.timeout++;
      else c.fail++;
    }
    const p = (x) => (x / c.n * 100).toFixed(1).padStart(5);
    console.log(`${it.padEnd(6)} ${p(c.goal)}  ${p(c.near)}  ${p(c.fail)}  ${p(c.conceded)}     ${p(c.timeout)}`);
  }
}
console.log('\n해석: OFF는 순수 공격 결과. ON−OFF의 fail/conceded 차이 = 수비 국면 기여분.');
