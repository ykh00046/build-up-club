// 6R 신규 — 성향 4티어가 "단조(≤)"를 통과해도 실제로 서로 다른 플레이를 만드는지 감사.
// probe5-defense-tier-entry는 nums[i]<=nums[i+1] 만 검사하므로 두 성향이 완전히 동일한
// 값을 내도(타이) "단조 ✓"로 통과한다 — 진짜 4티어인지, 사실상 3(혹은 그 이하)티어로
// 붕괴했는지는 못 잡는다. 여기서는 (a) 픽 분포·결과가 바이트 단위로 동일한 성향쌍을
// 직접 찾고, (b) E1 게겐미러 비단조가 6R 재조정 후에도 남아있는지 재확인한다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 2000);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const SCENARIOS = ['A1', 'D2', 'E1'];
const DISPS = ['safe', 'balanced', 'aggressive', 'direct'];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

function measure(scen, entry, disp, seedBase) {
  const pick = { dp_press: 0, dp_cut: 0, dp_mark: 0, dp_drop: 0, dp_foul: 0 };
  let regain = 0, conceded = 0, saved = 0, enter = 0, decisions = 0;
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(scen, seedBase + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
    if (!e.state.defenseLoop) continue;
    enter++;
    for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
      const view = buildPolicyView(e, 'us');
      const act = pressPolicy(view);
      if (!act.choiceId || act.kind !== 'situation_choice') break;
      pick[act.choiceId] = (pick[act.choiceId] || 0) + 1;
      decisions++;
      const r = e.chooseSituationOption(act.choiceId);
      if (r.recovered) { regain++; break; }
      if (r.conceded === true) { conceded++; break; }
      if (r.conceded === false || r.restarted) { saved++; break; }
      if (!r.ok) break;
    }
  }
  return { pick, regain, conceded, saved, enter, decisions };
}

console.log(`=== 1) 성향쌍 동일성 — 픽분포+결과가 바이트 단위로 일치하는 인접쌍 탐지, n=${N} ===`);
for (const scen of SCENARIOS) {
  for (const entry of ['reset', 'loss']) {
    const results = {};
    for (const disp of DISPS) results[disp] = measure(scen, entry, disp, 9000);
    const sig = (r) => JSON.stringify(r.pick) + `|${r.regain}|${r.conceded}|${r.saved}|${r.decisions}`;
    const sigs = DISPS.map((d) => sig(results[d]));
    const dupes = [];
    for (let i = 0; i < DISPS.length; i++) for (let j = i + 1; j < DISPS.length; j++) {
      if (sigs[i] === sigs[j]) dupes.push(`${DISPS[i]}≡${DISPS[j]}`);
    }
    const flag = dupes.length ? `  ⚠ 완전동일: ${dupes.join(', ')}` : '  구분됨';
    console.log(`  [${scen}/${entry.padEnd(5)}]${flag}`);
    if (dupes.length) {
      for (const d of DISPS) {
        const r = results[d];
        console.log(`      ${d.padEnd(11)} pick=${JSON.stringify(r.pick)} regain=${r.regain} conceded=${r.conceded} saved=${r.saved} decisions=${r.decisions}`);
      }
    }
  }
}

console.log(`\n=== 2) 실점률 단조성 재확인(엄격 — 동률도 표시) — 시나리오별, 진입 'loss', n=${N} ===`);
for (const scen of SCENARIOS) {
  const rates = DISPS.map((disp) => {
    const r = measure(scen, 'loss', disp, 40000);
    return r.conceded / (r.enter || 1) * 100;
  });
  const strictMonotone = rates.every((v, i) => i === 0 || v > rates[i - 1]);
  const looseMonotone = rates.every((v, i) => i === 0 || v >= rates[i - 1]);
  let verdict = '✓ 엄격단조(전부 진짜 오름)';
  if (!looseMonotone) verdict = '✗ 위반(역전 존재)';
  else if (!strictMonotone) verdict = '△ 동률 포함(≤는 통과하지만 진짜 4단계 아님)';
  console.log(`  [${scen}] ${DISPS.map((d, i) => `${d}=${rates[i].toFixed(1)}%`).join('  ')}  → ${verdict}`);
}

console.log('\n판정: 1)에서 완전동일 쌍이 나오면 해당 셀은 그 두 성향을 플레이상 구분 못하는 "티어 붕괴".');
console.log('2)에서 E1이 여전히 역전(✗)이면 게겐미러 비단조는 6R 재조정으로 해결되지 않음 — 별도 원인(cut 반위험 창발) 추적 필요.');
