// 5R 신규 — loss 진입에서 drop(내려서기)이 왜 죽어 보이는가 정량화.
// 가설(브라우저 체감): loss 진입은 "위기 국면"이 짧아(1결정으로 끝남) contained가
// 못 쌓여 blockStall(0.12×contained, 캡 0.36)이 발동할 기회 자체가 없다.
// reset(GK 재시작, 구계약)과 비교해 국면 길이 차이가 원인인지 직접 증명한다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

const N = Number(process.argv[2] ?? 1000);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];

function openDefense(seed, loss, opts) {
  const e = createEngine(getScenario('A1'), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log('=== 1) 진입 x 수렴 — loss@3지점이 실제로 몇 x에서 시작하나 (steps-to-shot = 진입x-22) ===');
for (const loss of LOSSES) {
  for (const entry of ['reset', 'loss']) {
    const e = openDefense(42, loss, { defenseEntry: entry, opponentBuildDisposition: 'balanced' });
    const h = e.holder();
    console.log(`  loss@${loss.x}(y${loss.y}) ${entry.padEnd(5)} → 진입 ${h?.id} x=${h?.x?.toFixed(1)} (사거리까지 ${(h.x - 22).toFixed(1)}m)`);
  }
}
console.log('  (해석: loss는 MIN_ENTRY_X=48 하드 가드로 항상 x≈50-53에 수렴 — "깊은/중원/높은" 상실 지점 차이가');
console.log('   진입 "깊이"엔 거의 반영 안 되고 진입 "홀더 신원"만 가른다.)');

console.log(`\n=== 2) 결정 수 분포 — dp_drop 고정, reset(구 위기) vs loss(신 위기), n=${N} ===`);
console.log('진입    성향        회수%  실점%  평균결정 | 분포(1/2/3/4/5+)');
for (const entry of ['reset', 'loss']) {
  for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
    let regain = 0, conceded = 0, enter = 0;
    const decisions = [0, 0, 0, 0, 0];
    // 스텝별(decision index) regain 발생 카운트 — contained 누적에 따른 blockStall 체감.
    const regainAtStep = [0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(5000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
      if (!e.state.defenseLoop) continue;
      enter++;
      let d = 0;
      for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
        d++;
        const r = e.chooseSituationOption('dp_drop');
        if (r.recovered) { regain++; regainAtStep[Math.min(d, 5) - 1]++; break; }
        if (r.conceded === true) { conceded++; break; }
        if (r.conceded === false || r.restarted) break;
        if (!r.ok) break;
      }
      decisions[Math.min(d, 5) - 1]++;
    }
    const avgD = decisions.reduce((s, c, i) => s + c * (i + 1), 0) / Math.max(1, enter);
    console.log(`${entry.padEnd(7)} ${disp.padEnd(11)} ${(regain / enter * 100).toFixed(1).padStart(5)} ${(conceded / enter * 100).toFixed(1).padStart(6)}  ${avgD.toFixed(2).padStart(8)} | ${decisions.join('/')} (regain@step: ${regainAtStep.join('/')})`);
  }
}
console.log('  (contained=1일 때 stall 12%, 2일 때 24%, 3일 때 36% 캡 — loss는 대부분 decision=1에서 끝나');
console.log('   contained 누적이 아예 안 된다. reset은 decision 3까지 흔해 blockStall이 실제로 쌓인다.)');

console.log(`\n=== 3) drop 순EV(회수%−실점%) vs cut·press — loss 전용, 성향별, n=${N} ===`);
function measure(choice, disp, entry) {
  let regain = 0, conceded = 0, enter = 0;
  for (let i = 0; i < N; i++) {
    const loss = LOSSES[i % 3];
    const e = openDefense(9000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: disp });
    if (!e.state.defenseLoop) continue;
    enter++;
    for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
      const r = e.chooseSituationOption(choice);
      if (r.recovered) { regain++; break; }
      if (r.conceded === true) { conceded++; break; }
      if (r.conceded === false || r.restarted) break;
      if (!r.ok) break;
    }
  }
  return { regain: regain / enter * 100, conceded: conceded / enter * 100 };
}
for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
  const drop = measure('dp_drop', disp, 'loss');
  const cut = measure('dp_cut', disp, 'loss');
  const press = measure('dp_press', disp, 'loss');
  console.log(`  ${disp.padEnd(11)} drop(회수${drop.regain.toFixed(1)}/실점${drop.conceded.toFixed(1)})  cut(회수${cut.regain.toFixed(1)}/실점${cut.conceded.toFixed(1)})  press(회수${press.regain.toFixed(1)}/실점${press.conceded.toFixed(1)})`);
}
console.log('\n판정: loss 진입에서 drop은 "실점이 유독 높다"기보다(대개 press보다 낮음) "회수가 사실상 없다"(cut/press 대비 -30~-35pt)가');
console.log('진짜 약점 — 국면이 1결정으로 끝나 blockStall이 발동 전에 판이 닫힌다. AI(pressPolicy) 채택률 0%(policyuse 실측)와 일치.');
