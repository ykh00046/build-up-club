// 8R 신설 — C2(게겐)/loss 진입이 전 성향에서 결정/진입=1.00, 5택 100% 단일선택으로
// 완전 붕괴한 원인 추적(probe8-defense-entry-symmetry.mjs에서 발견).
// 가설: MIN_ENTRY_X 가드(engine.js:390, DEFENSE_SHOT_X+26=48)는 "최소 한 스텝 여유"를
// 보장하려 했지만 그 여유(26)가 STEP_CAP(32, opp-build-policy.js:56) 또는 direct의
// burst 1.5배 캡(48)보다 작다 — 게겐 포메이션(build433Gegen)은 전방/미드가 전부
// x<=36(우리 진영 근접, 하이프레스 잔상)이라 진입 승격이 항상 백4(x=51~56)로 튀고,
// 거기서 첫 전개 한 방이 STEP_CAP 안에서 곧장 슛거리(x<=22)까지 닿는다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

const N = Number(process.argv[2] ?? 500);
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];

function openDefense(scen, seed, loss, opts) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

for (const scen of ['A1', 'C2']) {
  console.log(`\n=== ${scen}/loss 진입 지점(entry.x) 분포 vs A1 대조 ===`);
  for (const disp of ['safe', 'direct']) {
    const xs = [];
    let oneStepToShot = 0, entries = 0;
    for (let i = 0; i < N; i++) {
      const loss = LOSSES[i % 3];
      const e = openDefense(scen, 9000 + i, loss, { defenseEntry: 'loss', opponentBuildDisposition: disp });
      if (!e.state.defenseLoop) continue;
      entries++;
      const entryX = e.holder()?.x;
      xs.push(entryX);
      // 첫 결정에서 dp_drop(회수시도 없음)을 골라 상대 전개를 그대로 관찰 — 진짜 캡 여유를 잰다.
      const r = e.chooseSituationOption('dp_drop');
      const afterX = e.holder()?.x;
      if (r.conceded !== undefined || r.recovered) {
        // 1스텝만에 슛/회수로 끝남 = 결정이 딱 하나였던 에피소드
        oneStepToShot++;
      }
      void afterX;
    }
    xs.sort((a, b) => a - b);
    const avg = (xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(1);
    const min = xs[0]?.toFixed(1), max = xs[xs.length - 1]?.toFixed(1);
    console.log(`  ${disp.padEnd(10)} entry.x 평균=${avg} (범위 ${min}~${max})  1스텝만에 종료(drop 강제해도)=${oneStepToShot}/${entries}`);
  }
}

console.log('\n=== 게겐 포메이션 원본 좌표 확인 — 전방/미드가 전부 MIN_ENTRY_X(48) 아래인가 ===');
import('../js/data/formations.js').then(({ build433Gegen, build433Hybrid }) => {
  for (const [name, fn] of [['build433Gegen(C2)', build433Gegen], ['build433Hybrid(A1)', build433Hybrid]]) {
    const arr = fn();
    const below48 = arr.filter((p) => p.line !== 'gk' && p.x <= 48).length;
    const total = arr.filter((p) => p.line !== 'gk').length;
    console.log(`  ${name}: MIN_ENTRY_X(48) 이하 필드플레이어 ${below48}/${total}  →  ${arr.filter((p) => p.line !== 'gk').map((p) => `${p.label}=${p.x}`).join(', ')}`);
  }
  console.log('\n판정: 게겐이 하이브리드보다 "48 이하" 필드플레이어 수가 많고 백4만 48 초과라면, loss 승격은');
  console.log('거의 항상 백4로 튄다 — 거기서 STEP_CAP(32)/direct burst(48) 캡 안에서 shot-range(22)까지');
  console.log('한 방에 닿는 루트가 있으면 "1스텝 보장"이 뚫려 위 실측처럼 1결정 붕괴가 재현된다.');
});
