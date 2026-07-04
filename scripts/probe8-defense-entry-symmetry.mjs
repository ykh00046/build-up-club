// 8R 신설 — loss vs reset 진입 대칭성. 같은 셀·성향에서 두 진입이 "합리적으로 다른"
// 수준인지(loss=상실 지점 근접 진입이라 더 위험한 건 의도된 설계), 아니면 한쪽이
// 사실상 붕괴(결정 수 ~0, 5택 중 다양성 소실, 실점률 폭주)하는지 측정.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1500);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const SCENARIOS = ['A1', 'B1', 'C1', 'C2'];   // hybrid/man/zonal/gegen 4스킴 대표

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== reset vs loss — 결정수/실점률/5택분포, n=${N}/셀 ===`);
for (const scen of SCENARIOS) {
  console.log(`\n--- ${scen} ---`);
  for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
    const row = {};
    for (const entry of ['reset', 'loss']) {
      let entries = 0, conceded = 0, decisions = 0, immediateShotAt0 = 0;
      const pick = { dp_press: 0, dp_cut: 0, dp_mark: 0, dp_drop: 0, dp_foul: 0 };
      for (let i = 0; i < N; i++) {
        const loss = LOSSES[i % 3];
        const e = openDefense(scen, 8000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
        if (!e.state.defenseLoop) continue;
        entries++;
        let decisionsThis = 0;
        for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
          const view = buildPolicyView(e, 'us');
          const act = pressPolicy(view);
          if (act.kind !== 'situation_choice') break;
          pick[act.choiceId] = (pick[act.choiceId] || 0) + 1;
          decisions++; decisionsThis++;
          const r = e.chooseSituationOption(act.choiceId);
          if (r.conceded === true) { conceded++; break; }
          if (r.recovered || r.conceded === false || r.restarted) break;
        }
        if (decisionsThis === 0) immediateShotAt0++;
      }
      const tot = decisions || 1;
      row[entry] = {
        avgDec: (decisions / entries).toFixed(2),
        concedePct: (conceded / entries * 100).toFixed(1),
        dist: Object.keys(pick).map((k) => `${k.replace('dp_', '')}${Math.round(pick[k] / tot * 100)}`).join(' '),
        zeroDec: immediateShotAt0,
      };
    }
    const r = row.reset, l = row.loss;
    console.log(`  ${disp.padEnd(10)} reset: 결정/진입=${r.avgDec} 실점%=${r.concedePct.padStart(5)} 0결정즉시슛=${r.zeroDec}  [${r.dist}]`);
    console.log(`  ${''.padEnd(10)} loss : 결정/진입=${l.avgDec} 실점%=${l.concedePct.padStart(5)} 0결정즉시슛=${l.zeroDec}  [${l.dist}]`);
  }
}
console.log('\n판정: loss가 reset보다 결정/진입이 낮고 실점%이 높은 건 설계 의도(상실지점 근접=더 위험).');
console.log('경고 신호는 "0결정즉시슛"이 loss에서 크게 튀거나(선택할 새도 없이 슛으로 끝남 = 결정 게임의 부정),');
console.log('5택 분포가 loss에서 1-2개로 완전히 좁아지는 것(다양성 소실) — reset 대비 상대적으로 비교.');
