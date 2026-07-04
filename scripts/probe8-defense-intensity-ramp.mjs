// 8R 신설 — intensityOverride(low/mid/high/vhigh) 램프가 regainP·실점에 단조적으로
// 반영되는지, 재배치(advanceDefenseShape)에 텔레포트성 부자연 이동이 없는지 확인.
// intDef 상수(engine.js:52): low=-0.02 mid=0 high=0.04 vhigh=0.07. defensivePressProb는
// "-intDef"(높을수록 회수 어려움), resolveOppShot base는 "+intDef"(높을수록 실점 xG 상승) —
// "상대 OVR(디비전 램프)"의 체감 난이도로 설계된 항(CLAUDE.md). 폭이 0.09 밖에 안 돼
// 단조성은 되더라도 체감폭이 작을 수 있다 — 그 크기까지 정직하게 잰다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const N = Number(process.argv[2] ?? 3000);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];
const INTENSITIES = ['low', 'mid', 'high', 'vhigh'];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log(`=== 강도 램프 — regainP(첫 결정) · 실점% · 결정당 평균 이동거리(텔레포트 감시), n=${N}/셀 ===`);
for (const scen of ['A1', 'B1']) {
  for (const entry of ['reset', 'loss']) {
    console.log(`\n--- ${scen}/${entry} (성향 balanced 고정) ---`);
    let prevRegain = null, prevConcede = null;
    for (const intensity of INTENSITIES) {
      let entries = 0, conceded = 0, sumFirstRegainP = 0, sumFirstCutP = 0;
      let maxJump = 0, jumpSamples = 0, sumJump = 0;
      for (let i = 0; i < N; i++) {
        const loss = LOSSES[i % 3];
        const e = openDefense(scen, 20000 + i, loss, { defenseEntry: entry, opponentBuildDisposition: 'balanced', intensityOverride: intensity });
        if (!e.state.defenseLoop) continue;
        entries++;
        let first = true;
        for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
          const view = buildPolicyView(e, 'us');
          if (first) { sumFirstRegainP += view.pressRead.regainP; sumFirstCutP += view.pressRead.cutP; first = false; }
          const act = pressPolicy(view);
          if (act.kind !== 'situation_choice') break;
          const before = e.holder();
          const beforeXY = before ? { x: before.x, y: before.y } : null;
          const r = e.chooseSituationOption(act.choiceId);
          const after = e.holder();
          if (after && beforeXY) {
            const jump = Math.hypot(after.x - beforeXY.x, after.y - beforeXY.y);
            sumJump += jump; jumpSamples++;
            if (jump > maxJump) maxJump = jump;
          }
          if (r.conceded === true) { conceded++; break; }
          if (r.recovered || r.conceded === false || r.restarted) break;
        }
      }
      const avgRegain = sumFirstRegainP / entries;
      const concedePct = conceded / entries * 100;
      const avgJump = jumpSamples ? sumJump / jumpSamples : 0;
      const regainTrend = prevRegain === null ? '' : (avgRegain < prevRegain ? '↓(회수 어려워짐, 기대대로)' : avgRegain > prevRegain ? '↑(역행!)' : '=');
      const concedeTrend = prevConcede === null ? '' : (concedePct > prevConcede ? '↑(실점 늘어남, 기대대로)' : concedePct < prevConcede ? '↓(역행!)' : '=');
      console.log(`  [${intensity.padEnd(5)}] 첫결정regainP평균=${avgRegain.toFixed(3)} ${regainTrend.padEnd(20)} 실점%=${concedePct.toFixed(2).padStart(6)} ${concedeTrend.padEnd(20)} 평균이동=${avgJump.toFixed(2)} 최대이동=${maxJump.toFixed(2)}`);
      prevRegain = avgRegain; prevConcede = concedePct;
    }
  }
}
console.log('\n판정: regainP는 low→vhigh로 갈수록 단조 감소, 실점%은 단조 증가해야 "램프가 방향대로 작동".');
console.log('"역행!" 표시가 하나라도 뜨면 비단조 — 실측 노이즈(표본부족)인지 실제 역전인지 표본을 늘려 재확인 필요.');
console.log('평균/최대 이동거리가 강도별로 갑자기 튀면(예: high에서만 유독 크면) 재배치 로직이 강도에 반응한다는');
console.log('뜻인데, advanceDefenseShape(engine.js:298)는 강도를 참조하지 않으므로 여기서 튀는 값이 있으면');
console.log('회수 위치 점프(dp_press/cut 성공 시 캐리어 좌표로 순간이동, engine.js:469-471) 등 다른 원인을 봐야 한다.');
