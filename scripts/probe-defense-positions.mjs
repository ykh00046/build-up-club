// probe-defense-positions.mjs — 수비 국면 동안 선수 좌표가 실제로 움직이는지 검증.
// 우리(us) 필드 선수 / 상대(opp) 비캐리어의 스텝별 좌표 델타를 덤프한다.
// + 스텝별 캐리어 경로 / hunters 수 / regainP 트레이스. (조사용)
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

function openDefense(seed, opts = {}) {
  const e = createEngine(getScenario('A1'), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss: { x: 42, y: 34 }, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

const snap = (e) => e.state.players.map((p) => ({ id: p.id, side: p.side, x: p.x, y: p.y, tx: p.tx, ty: p.ty }));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

let globalMaxUs = 0, globalMaxOpp = 0, phases = 0;
for (const seed of [11, 23, 55, 77, 101]) {
  const e = openDefense(seed, { opponentBuildDisposition: 'balanced' });
  if (e.state.matchDecision?.id !== 'defend') continue;
  phases++;
  const s0 = snap(e);
  console.log(`\n── seed ${seed} — 수비 국면 트레이스 ──`);
  let step = 0;
  while (e.state.matchDecision?.id === 'defend' && step < 5) {
    const dl = e.state.defenseLoop;
    const carrier = e.state.players.find((p) => p.id === e.state.holderId);
    const hunters = e.state.players.filter((p) => p.side === 'us' && p.role !== 'GK' && dist(p, carrier) < 24);
    const near = hunters.filter((p) => dist(p, carrier) < 14);
    console.log(`  step ${step}: carrier=${carrier.id}(x=${carrier.x.toFixed(1)},y=${carrier.y.toFixed(1)}) hunters<24=${hunters.length} near<14=${near.length} regainP=${dl.regainP.toFixed(3)} cutP=${dl.cutP.toFixed(3)}`);
    e.chooseSituationOption(step % 3 === 0 ? 'dp_press' : step % 3 === 1 ? 'dp_cut' : 'dp_drop');
    step++;
  }
  const s1 = snap(e);
  let maxUs = 0, maxOpp = 0, maxTxUs = 0;
  for (let i = 0; i < s0.length; i++) {
    const d = Math.hypot(s0[i].x - s1[i].x, s0[i].y - s1[i].y);
    const dT = Math.hypot(s0[i].tx - s1[i].tx, s0[i].ty - s1[i].ty);
    if (s0[i].side === 'us') { maxUs = Math.max(maxUs, d); maxTxUs = Math.max(maxTxUs, dT); }
    else maxOpp = Math.max(maxOpp, d);
  }
  globalMaxUs = Math.max(globalMaxUs, maxUs); globalMaxOpp = Math.max(globalMaxOpp, maxOpp);
  console.log(`  국면 전체 좌표 이동: us 최대 ${maxUs.toFixed(2)} (tx/ty ${maxTxUs.toFixed(2)}), opp 최대 ${maxOpp.toFixed(2)}`);
}
console.log(`\n=== 종합 (${phases}개 국면): 수비 국면 중 us 선수 최대 이동 = ${globalMaxUs.toFixed(2)}, opp(비캐리어 포함) 최대 이동 = ${globalMaxOpp.toFixed(2)} ===`);
console.log('(0.00 이면 수비 국면 내내 선수 좌표가 완전히 박제 — 볼만 순간이동)');

// 보너스: 국면 시작 시 상대 최후방(=GK) 홀더 확인 + 첫 캐리어가 항상 같은지
console.log('\n── 진입 홀더 분포 (seed 1..200) ──');
const holders = {};
for (let seed = 1; seed <= 200; seed++) {
  const e = openDefense(seed);
  if (e.state.matchDecision?.id !== 'defend') continue;
  const h = e.state.holderId;
  holders[h] = (holders[h] ?? 0) + 1;
}
console.log(holders);
