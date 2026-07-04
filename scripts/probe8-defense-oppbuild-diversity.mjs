// 8R 신설 — 상대 전개 성향(chooseOppBuild)이 실제로 다른 루트를 뽑는지, STEP_CAP/capDelta가
// 부자연스러운 원거리 전진(사실상 텔레포트)을 만드는지 확인. dp_drop을 반복 선택해
// (회수 시도 없음 → 상대 전개를 최대한 그대로 관찰) 매 스텝의 progress/risk를 수집.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

const N = Number(process.argv[2] ?? 2000);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const STEP_CAP = 32;

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 성향별 실제 전개 스텝 통계(dp_drop 고정, 개입 최소화), n=${N}/셀 ===`);
for (const scen of ['A1', 'C1']) {
  console.log(`\n--- ${scen} ---`);
  for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
    const progresses = [], risks = [];
    let atCap = 0, overSoftCap = 0, steps = 0, entries = 0;
    for (let i = 0; i < N; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(scen, 30000 + i, loss, { defenseEntry: 'loss', opponentBuildDisposition: disp });
      if (!e.state.defenseLoop) continue;
      entries++;
      for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
        const r = e.chooseSituationOption('dp_drop');
        if (r.step?.ok) {
          progresses.push(r.step.progress);
          risks.push(r.step.risk);
          steps++;
          if (r.step.progress >= STEP_CAP * 0.95) atCap++;
          if (disp === 'direct' && r.step.progress > STEP_CAP) overSoftCap++;
        }
        if (r.conceded === true || r.recovered || r.conceded === false || r.restarted) break;
      }
    }
    const avg = (a) => a.length ? (a.reduce((s, v) => s + v, 0) / a.length) : 0;
    progresses.sort((a, b) => a - b);
    const median = progresses.length ? progresses[Math.floor(progresses.length / 2)] : 0;
    console.log(`  ${disp.padEnd(10)} 스텝수=${steps.toString().padStart(4)} 진입=${entries}` +
      ` 평균progress=${avg(progresses).toFixed(1)} 중앙값=${median.toFixed(1)}` +
      ` 평균risk=${avg(risks).toFixed(3)} 캡근접(≥${(STEP_CAP * 0.95).toFixed(0)})=${(atCap / (steps || 1) * 100).toFixed(1)}%` +
      (disp === 'direct' ? ` 소프트캡(32)초과=${(overSoftCap / (steps || 1) * 100).toFixed(1)}%(burst 1.5배 캡 정상 사용)` : ''));
  }
}
console.log('\n판정 가이드:');
console.log('- safe가 다른 성향보다 평균risk가 뚜렷이 낮고 direct가 평균progress(전진폭)가 뚜렷이 크면 "성향별 다른 루트"가 실측된 것.');
console.log('- 모든 성향이 risk/progress 값이 거의 같으면 disposition이 겉으로만 다르고 실제로는 거의 같은 루트를 고른다는 뜻.');
console.log('- 캡근접 비율이 높으면(예: >40%) 대부분의 전진이 "캡 한계까지 밀어붙이는 원거리 패스"로 수렴 —');
console.log('  현실적인 점진 전진이 아니라 캡 경계에 몰린 부자연 전진일 수 있다(진짜 텔레포트는 아니나 다양성 저하).');
