// 5R 신규 — (a) 성향 4티어 단조성이 시나리오를 바꿔도 유지되나(A1 외 D2/E1 추가),
// (b) 진입 다양성이 상실 지점의 x뿐 아니라 y(측면)에도 실제로 반응하나(측면 상실=측면 진입).
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1200);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 1) 성향 4티어 단조 — 시나리오별(A1/D2/E1) 실점률, 진입 'loss', 정책 채택(adaptive), n=${N} ===`);
for (const scen of ['A1', 'D2', 'E1']) {
  const row = [];
  for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
    let conceded = 0, enter = 0;
    for (let i = 0; i < N; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(scen, 40000 + i, loss, { defenseEntry: 'loss', opponentBuildDisposition: disp });
      if (!e.state.defenseLoop) continue;
      enter++;
      for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
        const view = buildPolicyView(e, 'us');
        const act = pressPolicy(view);
        if (act.kind !== 'situation_choice') break;
        const r = e.chooseSituationOption(act.choiceId);
        if (r.recovered || r.conceded === true || r.conceded === false || r.restarted) { if (r.conceded === true) conceded++; break; }
        if (!r.ok) break;
      }
    }
    row.push((conceded / enter * 100).toFixed(1));
  }
  const nums = row.map(Number);
  const monotone = nums[0] <= nums[1] && nums[1] <= nums[2] && nums[2] <= nums[3];
  console.log(`  [${scen}] safe ${row[0]}%  balanced ${row[1]}%  aggressive ${row[2]}%  direct ${row[3]}%   → 단조 ${monotone ? '✓' : '✗ 위반'}`);
}

console.log(`\n=== 2) 진입 다양성 — x 3지점 × y 5레벨(측면 상실=측면 진입 확인), defenseEntry:'loss', n=${Math.floor(N / 5)}/셀 ===`);
const YS = [6, 20, 34, 48, 62];   // 왼쪽 터치라인 → 중앙 → 오른쪽 터치라인
for (const lx of [24, 42, 62]) {
  const holders = {};
  for (const ly of YS) {
    const dist = {};
    const M = Math.max(50, Math.floor(N / 5));
    for (let i = 0; i < M; i++) {
      const e = openDefense('A1', 45000 + i, { x: lx, y: ly }, { defenseEntry: 'loss', opponentBuildDisposition: 'balanced' });
      if (!e.state.defenseLoop) continue;
      const h = e.holder();
      dist[h.id] = (dist[h.id] || 0) + 1;
      holders[h.id] = true;
    }
    const top = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
    console.log(`  x=${lx} y=${ly.toString().padStart(2)} → 최다 진입 ${top?.[0] ?? 'n/a'} (${top ? (top[1] / M * 100).toFixed(0) : 0}%)`);
  }
  console.log(`  x=${lx} 전체 y대역 고유 진입 홀더: ${Object.keys(holders).length}곳 — ${Object.keys(holders).join(', ')}`);
}
console.log('\n게이트: (1) 시나리오 3종 전부 실점률 단조 safe≤balanced≤aggressive≤direct.');
console.log('(2) 각 x에서 y를 훑으면 진입 홀더가 최소 2곳 이상으로 갈려야("측면 상실=측면 진입" 생존).');
