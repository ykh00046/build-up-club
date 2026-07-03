// 6R 신규 — (a) 국면당 실점률이 성향별로 합리적 밴드에 있는지(balanced ~10-15% 기대),
// 시나리오 전반에 걸쳐 확인. (b) 위기 에스컬레이션 사다리(foul→drop)가 재조정 계수로
// 여전히 사실상 발동 안 하는지(5R 기록 재확인) — 6R은 dp_press/cut/mark 계수만 바꿨고
// 사다리 조건(policy.js:154-161)의 값 자체(bestOdds/beatenDeep/foulLeft)는 raw
// regainP/cutP/markP*pred 를 쓰므로 안 바뀌었어야 하지만, "어떤 선택이 실제로 뽑히는가"가
// bestOdds 계산엔 안 쓰이고 beatenDeep(steps>=1) 도달 여부에는 간접 영향을 줄 수 있어
// 재확인이 필요하다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1500);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const SCENARIOS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 1) 국면당 실점률 밴드 — 시나리오 10종 전부, 진입 'loss'(커리어 실사용), balanced, n=${N} ===`);
console.log('기대 밴드: balanced ~10-15%. 크게 벗어나면(0% 또는 25%+) 시나리오별 편차 과다.');
const bandOut = [];
for (const scen of SCENARIOS) {
  let conceded = 0, enter = 0;
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(scen, 24000 + i, loss, { defenseEntry: 'loss', opponentBuildDisposition: 'balanced' });
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
  const rate = conceded / (enter || 1) * 100;
  const inBand = rate >= 8 && rate <= 18;
  bandOut.push({ scen, rate });
  console.log(`  [${scen}] 실점률 ${rate.toFixed(1)}%  (enter=${enter})  ${inBand ? '밴드내' : '⚠ 밴드이탈(8-18% 기준)'}`);
}
const rates = bandOut.map((b) => b.rate);
console.log(`  전체 평균 ${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)}%  최소 ${Math.min(...rates).toFixed(1)}%  최대 ${Math.max(...rates).toFixed(1)}%`);

console.log(`\n=== 2) 위기 사다리 재확인 — armed 빈도(현재 계수), 시나리오 A1/D2/E1, 성향 4종, 진입 반복 25회/런×300런 ===`);
function forceEntry(e, loss, entry) {
  if (e.state.status !== 'live') return false;
  if (e.state.transition || e.state.defenseLoop || e.state.defensivePress) return false;
  e.state.transitionUsed = false;
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return !!e.state.defenseLoop;
}
function ladderArmed(view) {
  const pr = view.pressRead;
  if (!pr) return false;
  const bestOdds = Math.max(pr.regainP ?? 0, pr.cutP ?? 0, (pr.markP ?? 0) * (pr.pred ?? 1));
  const beatenDeep = (pr.beaten ?? 0) >= 1 && (pr.steps ?? 0) >= 1;
  const regainPoor = bestOdds < 0.40;
  const foulLeft = (pr.fouls ?? 0) < 2;
  return beatenDeep && regainPoor && !foulLeft;
}
const RUNS = Math.max(200, Math.floor(N / 5));
for (const scen of ['A1', 'D2', 'E1']) {
  for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
    let armedCount = 0, armedDropPicked = 0, totalEntries = 0, totalDecisions = 0;
    for (let run = 0; run < RUNS; run++) {
      const e = createEngine(getScenario(scen), 50000 + run, { defenseEntry: 'loss', opponentBuildDisposition: disp });
      for (let entries = 0; entries < 20; entries++) {
        const loss = LOSSES[entries % 3];
        if (!forceEntry(e, loss, 'loss')) break;
        totalEntries++;
        for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
          const view = buildPolicyView(e, 'us');
          const act = pressPolicy(view);
          if (act.kind !== 'situation_choice') break;
          totalDecisions++;
          if (ladderArmed(view)) {
            armedCount++;
            if (act.choiceId === 'dp_drop') armedDropPicked++;
          }
          const r = e.chooseSituationOption(act.choiceId);
          if (r.recovered || r.conceded === true || r.conceded === false || r.restarted) break;
          if (!r.ok) break;
        }
        if (e.state.status !== 'live') break;
      }
    }
    console.log(`  [${scen}/${disp.padEnd(10)}] 진입누계=${totalEntries} 결정누계=${totalDecisions} 사다리armed=${armedCount}회 (drop택=${armedDropPicked})`);
  }
}
console.log('\n판정: 1) 밴드이탈 시나리오가 다수면 실점 모델이 시나리오 형태(로우블록/게겐 등)에 과민 — 커리어 난이도 편차 우려.');
console.log('2) armed가 거의 항상 0이면 위기 사다리(foul→drop)는 6R 재조정 후에도 여전히 설계상만 존재 — 5R 기록과 동일 결론.');
