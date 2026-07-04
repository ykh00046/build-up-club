// 8R 신설 — dp_foul(전술 파울) 밸브 감사.
// 질문: (1) 실전(정책) 픽률 — 과용/사문화 중 어디인가. (2) 파울로 재개될 때 위치가
// 얼마나 되돌아가는가(상대 이득/손해). (3) 파울을 아예 못 쓰게 하면(counterfactual)
// 실점률이 유의미하게 바뀌는가 — 바뀌면 foul이 "숨은 필수 밸브", 안 바뀌면 "장식".
// (4) 3회째 파울 카드/프리킥 에스컬레이션(engine.js:441)이 AI 정책 플레이에서
// 도달 가능한가 — policy.js:166 foulLeft=fouls<2 게이트로 정책은 최대 2회만 쓴다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 1500);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const SCENARIOS = ['A1', 'B2', 'C2'];
const DISPS = ['safe', 'balanced', 'aggressive', 'direct'];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

// pressPolicy를 호출하되 dp_foul을 legal choices에서 빼서 "파울 없는 세계"를 시뮬레이션.
function policyWithoutFoul(view) {
  if (!view.situation) return pressPolicy(view);
  const choices = view.situation.choices.filter((c) => c.id !== 'dp_foul');
  return pressPolicy({ ...view, situation: { ...view.situation, choices } });
}

function runEpisode(scen, seed, loss, opts, allowFoul) {
  const e = openDefense(scen, seed, loss, opts);
  if (!e.state.defenseLoop) return null;
  let foulsUsed = 0, gainSum = 0, decisions = 0;
  let cardEscalations = 0, foulAttemptsAt3rd = 0;
  for (let s = 0; s < 10 && e.state.defenseLoop; s++) {
    const view = buildPolicyView(e, 'us');
    const act = allowFoul ? pressPolicy(view) : policyWithoutFoul(view);
    if (act.kind !== 'situation_choice') break;
    decisions++;
    const carrierBefore = e.holder();
    const beforeX = carrierBefore ? carrierBefore.x : null;
    const foulsBefore = e.state.facts?.fouls ?? 0;
    if (act.choiceId === 'dp_foul' && foulsBefore >= 2) foulAttemptsAt3rd++;
    const r = e.chooseSituationOption(act.choiceId);
    if (act.choiceId === 'dp_foul' && r.ok) {
      foulsUsed++;
      if (r.conceded === true) cardEscalations++;   // 카드 후 프리킥 실점(engine.js:441-448)
      else if (r.reset) {   // 일반 파울 리셋(engine.js:461) — 필드는 restarted가 아니라 reset
        const after = e.holder();
        if (after && beforeX != null) gainSum += (after.x - beforeX);
      }
    }
    if (r.conceded === true) return { conceded: true, foulsUsed, gainSum, decisions, cardEscalations, foulAttemptsAt3rd };
    if (r.recovered || r.conceded === false || r.restarted) return { conceded: false, foulsUsed, gainSum, decisions, cardEscalations, foulAttemptsAt3rd };
  }
  return { conceded: false, foulsUsed, gainSum, decisions, cardEscalations, foulAttemptsAt3rd, timeout: true };
}

console.log(`=== dp_foul 실전 픽률 + 위치 이득 + counterfactual(파울 금지) 실점률 비교, n=${N}/셀 ===`);
console.log('시나리오/진입/성향   실점%(有foul) 실점%(無foul)  Δ실점%p   파울사용률(결정당%)  평균이득x  3회째시도  카드실점');
for (const scen of SCENARIOS) {
  for (const entry of ['reset', 'loss']) {
    for (const disp of DISPS) {
      let concededWith = 0, concededWithout = 0, entries = 0;
      let foulPicks = 0, decisionsTotal = 0, gainSum = 0, gainN = 0;
      let attempts3rd = 0, cardEsc = 0;
      for (let i = 0; i < N; i++) {
        const loss = LOSSES[i % 3];
        const opts = { defenseEntry: entry, opponentBuildDisposition: disp };
        const withFoul = runEpisode(scen, 40000 + i, loss, opts, true);
        const withoutFoul = runEpisode(scen, 40000 + i, loss, opts, false);
        if (!withFoul || !withoutFoul) continue;
        entries++;
        if (withFoul.conceded) concededWith++;
        if (withoutFoul.conceded) concededWithout++;
        foulPicks += withFoul.foulsUsed;
        decisionsTotal += withFoul.decisions;
        gainSum += withFoul.gainSum;
        gainN += withFoul.foulsUsed;
        attempts3rd += withFoul.foulAttemptsAt3rd;
        cardEsc += withFoul.cardEscalations;
      }
      const pctWith = (concededWith / entries * 100).toFixed(1);
      const pctWithout = (concededWithout / entries * 100).toFixed(1);
      const delta = (concededWith / entries * 100 - concededWithout / entries * 100).toFixed(1);
      const foulRate = (foulPicks / decisionsTotal * 100).toFixed(1);
      const avgGain = gainN ? (gainSum / gainN).toFixed(1) : 'n/a';
      console.log(`${scen}/${entry.padEnd(5)}/${disp.padEnd(10)}    ${pctWith.padStart(6)}      ${pctWithout.padStart(6)}      ${delta.padStart(6)}      ${foulRate.padStart(6)}          ${String(avgGain).padStart(6)}      ${attempts3rd}        ${cardEsc}`);
    }
  }
}
console.log('\n판정 가이드:');
console.log('- Δ실점%p ≈ 0 이면 foul을 빼도 결과가 안 바뀜 → 밸브가 사실상 장식(사문화 후보).');
console.log('- Δ실점%p 가 뚜렷이 음수(有foul이 더 낮음)면 foul이 실제로 실점을 막는 숨은 필수기.');
console.log('- 평균이득x 가 크면(예: >20) 파울 재개가 상대를 크게 되돌려보내는 셈 — 비용(파울누적/카드) 대비 과대 보상 후보.');
console.log('- 3회째시도/카드실점이 항상 0이면 policy.js:166 foulLeft 게이트 때문에 카드 에스컬레이션(engine.js:441)은');
console.log('  AI 정책 하에서 구조적으로 도달 불가 — 코드는 살아있지만 실전에선 죽은 분기.');
