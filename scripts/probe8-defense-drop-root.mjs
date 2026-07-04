// 8R 신설 — dp_drop 크라이시스 사다리 사문화의 근본 원인을 직접 계측.
// 가설(engine.js:463-476, 477-492 대조): dl.beaten은 dp_press·dp_mark 실패에서만
// ++된다. dp_cut 실패는 절대 beaten을 올리지 않는다(resolveDefendStep 분기 확인).
// aggressive/direct 성향은 cut이 5택을 지배(probe7 grid: C43~100%)하므로 press/mark를
// 거의 안 쓰고 → beaten이 거의 0에 머물고 → policy.js:164 beatenDeep(beaten>=1)이
// 참이 될 수 없어 → dp_foul(policy.js:167)·dp_drop 승격(policy.js:168-170) 모두
// 원천 차단된다. 이걸 "cut 실패 횟수" 대비 "beaten 누적" 비율로 직접 확인한다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 2000);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];

function openDefense(seed, loss, opts) {
  const e = createEngine(getScenario('A1'), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log('=== part 1: 선택별 실패가 beaten을 올리는가 (cut 실패 vs press/mark 실패), n=' + N + '/성향 ===');
for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
  let cutFails = 0, cutFailBeatenDelta = 0, pressFails = 0, pressFailBeatenDelta = 0, markFails = 0, markFailBeatenDelta = 0;
  let decisions = 0, everBeatenDeep = 0;
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(1000 + i, loss, { defenseEntry: 'loss', opponentBuildDisposition: disp });
    if (!e.state.defenseLoop) continue;
    for (let s = 0; s < 6 && e.state.defenseLoop; s++) {
      const view = buildPolicyView(e, 'us');
      const act = pressPolicy(view);
      if (act.kind !== 'situation_choice') break;
      decisions++;
      const beatenBefore = e.state.defenseLoop.beaten ?? 0;
      const stepsBefore = e.state.defenseLoop.steps ?? 0;
      if (beatenBefore >= 1 && stepsBefore >= 1) everBeatenDeep++;
      const r = e.chooseSituationOption(act.choiceId);
      const beatenAfter = e.state.defenseLoop?.beaten ?? beatenBefore;
      const delta = beatenAfter - beatenBefore;
      const failed = !r.recovered && r.conceded === undefined && !r.restarted && !r.fouled;
      if (act.choiceId === 'dp_cut' && failed) { cutFails++; cutFailBeatenDelta += delta; }
      if (act.choiceId === 'dp_press' && failed) { pressFails++; pressFailBeatenDelta += delta; }
      if (act.choiceId === 'dp_mark' && failed) { markFails++; markFailBeatenDelta += delta; }
      if (r.conceded === true || r.recovered || r.restarted) break;
    }
  }
  console.log(`[${disp.padEnd(10)}] 결정수=${decisions.toString().padStart(5)} beatenDeep 도달 관측=${everBeatenDeep.toString().padStart(4)}회`
    + ` | cut실패=${cutFails.toString().padStart(4)}(beaten+=${cutFailBeatenDelta})`
    + ` press실패=${pressFails.toString().padStart(4)}(beaten+=${pressFailBeatenDelta})`
    + ` mark실패=${markFails.toString().padStart(4)}(beaten+=${markFailBeatenDelta})`);
}

console.log('\n=== part 2: bestOdds 하한 — markP*pred가 markUses=0(한 번도 안 씀)일 때 성향별 얼마인가 ===');
console.log('(policy.js:163 bestOdds = max(regainP, cutP, markP*pred) — mark을 한 번도 안 써도 이 항이 바닥을 깐다)');
const PRED = { safe: 0.95, balanced: 0.85, aggressive: 0.7, direct: 0.6 };
for (const disp of Object.keys(PRED)) {
  for (const uses of [0, 1, 2, 3]) {
    const markP = Math.max(0.3, 0.6 - 0.15 * uses);
    const val = markP * PRED[disp];
    console.log(`  ${disp.padEnd(10)} markUses=${uses}  markP=${markP.toFixed(2)}  markP*pred=${val.toFixed(3)}  ${val < 0.40 ? '(<0.40 → regainPoor 기여 가능)' : '(>=0.40 → bestOdds 바닥 역할, regainPoor 차단)'}`);
  }
}

console.log('\n판정: aggressive/direct에서 cut실패의 beaten+= 합이 0이면, 두 성향은 cut을 아무리 반복 실패해도');
console.log('beatenDeep에 도달할 수 없다는 뜻 — dp_foul·dp_drop 승격 모두 코드 경로가 아니라 애초에 도달 불가능.');
console.log('part2에서 aggressive의 markUses=0 값이 0.40 이상이면, mark을 한 번도 안 쓰는(니치 밖) 성향에서도');
console.log('가상 markP*pred가 bestOdds 바닥을 0.40 위로 고정해 regainPoor 자체가 거의 안 걸린다는 2차 원인이 겹친다.');

console.log('\n=== part 3: beatenDeep 도달 순간의 실제 bestOdds — 무엇이 그 값을 떠받치나 (regainP/cutP/mark 중 최댓값) ===');
for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
  let n = 0, poorCount = 0, sumBestOdds = 0;
  const holder = { regainP: 0, cutP: 0, mark: 0 };
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(5000 + i, loss, { defenseEntry: 'loss', opponentBuildDisposition: disp });
    if (!e.state.defenseLoop) continue;
    for (let s = 0; s < 6 && e.state.defenseLoop; s++) {
      const view = buildPolicyView(e, 'us');
      const pr = view.pressRead;
      const beatenNow = pr?.beaten ?? 0, stepsNow = pr?.steps ?? 0;
      if (beatenNow >= 1 && stepsNow >= 1) {
        const markVal = (pr.markP ?? 0) * (pr.pred ?? 1);
        const best = Math.max(pr.regainP ?? 0, pr.cutP ?? 0, markVal);
        n++; sumBestOdds += best;
        if (best < 0.40) poorCount++;
        if (pr.regainP >= pr.cutP && pr.regainP >= markVal) holder.regainP++;
        else if (pr.cutP >= markVal) holder.cutP++;
        else holder.mark++;
      }
      const act = pressPolicy(view);
      if (act.kind !== 'situation_choice') break;
      const r = e.chooseSituationOption(act.choiceId);
      if (r.conceded === true || r.recovered || r.restarted) break;
    }
  }
  console.log(`[${disp.padEnd(10)}] beatenDeep 관측=${n.toString().padStart(4)}  평균bestOdds=${(n ? sumBestOdds / n : 0).toFixed(3)}`
    + `  regainPoor(<0.40) 비율=${(n ? poorCount / n * 100 : 0).toFixed(1)}%`
    + `  |  최댓값 주체: regainP=${holder.regainP} cutP=${holder.cutP} markP*pred=${holder.mark}`);
}
console.log('\n최댓값 주체가 markP*pred에 쏠려 있는데 regainPoor 비율이 낮으면(예: aggressive), "한 번도 안 쓰는 mark의');
console.log('가상 값"이 실제로 bestOdds 바닥을 떠받쳐 위기 사다리를 잠그고 있다는 뜻 — policy.js:163의 구조적 결함.');
