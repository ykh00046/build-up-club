// 4R 플랜 A 게이트 — 진입 다양화(defenseEntry:'loss') + 스텝 캡의 밸런스 측정.
// 수용 밴드: 정책별 회수 30~65%, 실점 5~18%, 1결정 국면 <10%, 평균 결정 ≥2.2,
// 진입 홀더 3군데 이상.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

const N = Number(process.argv[2] ?? 600);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];   // 깊은-우/중원/높은-좌 상실

function openDefense(seed, loss, opts = {}) {
  const e = createEngine(getScenario('A1'), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 1) 진입 홀더 분포 — defenseEntry:'loss' × 상실 3지점 (n=${N / 3}/지점) ===`);
{
  const dist = {};
  for (const loss of LOSSES) {
    for (let i = 0; i < N / 3; i++) {
      const e = openDefense(2000 + i, loss, { defenseEntry: 'loss', opponentBuildDisposition: 'balanced' });
      if (!e.state.defenseLoop) continue;
      const key = `loss@${loss.x} → ${e.holder()?.id}`;
      dist[key] = (dist[key] || 0) + 1;
    }
  }
  for (const [k, v] of Object.entries(dist).sort()) console.log(`  ${k}: ${v}`);
  const holders = new Set(Object.keys(dist).map((k) => k.split('→ ')[1]));
  console.log(`  → 고유 진입 홀더 ${holders.size}곳 (게이트: ≥3)`);
}

console.log(`\n=== 2) 결정 수 분포 + EV — 'loss' vs 'reset', 성향 × 정책 (n=${N}) ===`);
for (const entry of ['reset', 'loss']) {
  for (const disp of ['safe', 'balanced', 'direct']) {
    for (const policy of ['dp_press', 'dp_cut', 'dp_drop']) {
      let regain = 0, conceded = 0, enter = 0;
      const decisions = [0, 0, 0, 0, 0];   // 1..5+ 결정
      for (let i = 0; i < N; i++) {
        const loss = LOSSES[i % 3];
        const e = openDefense(3000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
        if (!e.state.defenseLoop) continue;
        enter++;
        let d = 0;
        for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
          d++;
          const r = e.chooseSituationOption(policy);
          if (r.recovered) { regain++; break; }
          if (r.conceded === true) { conceded++; break; }
          if (r.conceded === false || r.restarted) break;
          if (!r.ok) break;
        }
        decisions[Math.min(d, 5) - 1]++;
      }
      const avgD = decisions.reduce((s, c, i) => s + c * (i + 1), 0) / Math.max(1, enter);
      const oneD = (decisions[0] / Math.max(1, enter) * 100).toFixed(0);
      console.log(`  ${entry.padEnd(5)} ${disp.padEnd(8)} ${policy} | 회수 ${(regain / enter * 100).toFixed(1)}% 실점 ${(conceded / enter * 100).toFixed(1)}% | 평균결정 ${avgD.toFixed(2)} 1결정 ${oneD}% | 분포 ${decisions.join('/')}`);
    }
  }
}
console.log('\n게이트: loss 경로에서 회수 30~65% · 실점 5~18% · 1결정 <10% · 평균결정 ≥2.2');
