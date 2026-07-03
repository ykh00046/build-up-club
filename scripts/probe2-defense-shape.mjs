// probe2-defense-shape.mjs — 수비 2라운드: 재배치(advanceDefenseShape)의 새 구멍 탐지.
// 1) 사냥조 2인이 캐리어로 붙을 때 스텝별 상대 루트 risk가 어떻게 변하나(레인이 공짜가 되나)
// 2) 블록 중앙 압축(0.15 y-pull)이 측면 루트를 싸게 만드나 — 중앙 vs 측면 risk/선택 비중
// 3) 상대 후방 지원 전진(-2m)이 실제로 발동하는 스텝 비율(사문화 여부)
// 4) 사냥조가 누구인가(역할) + 스텝별 regainP/cutP 트렌드(드랍→프레스 시퀀싱 유인)
// (조사 전용 — 게임 코드는 건드리지 않음)
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { oppBuildDryRun } from '../js/engine/dry-run.js';

const N = Number(process.argv[2] ?? 800);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

function openDefense(seed, scen = 'A1', opts = {}) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss: { x: 42, y: 34 }, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

const isFlank = (y) => Math.abs(y - 34) > 14;

console.log(`=== 스텝별 루트 risk / 중앙·측면 / 사냥조 — A1, drop-spam, n=${N} ===`);
for (const scen of ['A1', 'B1', 'C2', 'D2']) {
  // per step-index 집계
  const steps = [0, 1, 2].map(() => ({
    n: 0, bestRisk: [], centerRisk: [], flankRisk: [], bestIsFlank: 0,
    regainP: [], cutP: [], hunterRoles: {}, oppMoved: 0, chosenFlank: 0, chosen: 0,
  }));
  let phases = 0;
  for (let seed = 1; seed <= N; seed++) {
    const e = openDefense(seed, scen);
    if (e.state.matchDecision?.id !== 'defend') continue;
    phases++;
    let k = 0;
    let prevOppXs = null;
    while (e.state.matchDecision?.id === 'defend' && k < 3) {
      const st = steps[k];
      st.n++;
      const dl = e.state.defenseLoop;
      st.regainP.push(dl.regainP); st.cutP.push(dl.cutP);
      const carrier = e.state.players.find((p) => p.id === e.state.holderId);
      // 사냥조 = 캐리어 최근접 우리 필드 2인 (advanceDefenseShape와 동일 규칙)
      const hunters = e.state.players.filter((p) => p.side === 'us' && p.role !== 'GK')
        .sort((a, b) => dist(a, carrier) - dist(b, carrier)).slice(0, 2);
      for (const h of hunters) st.hunterRoles[h.role] = (st.hunterRoles[h.role] ?? 0) + 1;
      const read = oppBuildDryRun(e.state);
      if (read?.best) {
        st.bestRisk.push(read.best.risk);
        if (isFlank(read.best.targetReal?.y ?? read.best.target.y)) st.bestIsFlank++;
      }
      for (const c of read?.candidates ?? []) {
        const y = c.targetReal?.y ?? c.target.y;
        (isFlank(y) ? st.flankRisk : st.centerRisk).push(c.risk);
      }
      // 상대 지원 전진 발동 감지: 결정 직전 상대 비캐리어 x 스냅샷과 비교
      const oppXs = e.state.players.filter((p) => p.side === 'opp').map((p) => p.x);
      if (prevOppXs) {
        // 패스는 상대 좌표를 안 바꾼다 — 좌표 변화 = 지원 전진(advanceDefenseShape)뿐
        const moved = oppXs.filter((x, i) => Math.abs(x - prevOppXs[i]) > 0.01).length;
        if (moved > 0) st.oppMoved++;
      }
      prevOppXs = oppXs;
      const r = e.chooseSituationOption('dp_drop');
      if (r.step?.targetId) {
        st.chosen++;
        const tgt = e.state.players.find((p) => p.id === r.step.targetId);
        if (tgt && isFlank(tgt.y)) st.chosenFlank++;
      }
      if (r.recovered || r.xg != null) break;
      k++;
    }
  }
  console.log(`\n── ${scen} (국면 ${phases}) ──`);
  console.log('step | n | best.risk | 중앙후보risk | 측면후보risk | best측면% | 실선택측면% | regainP | cutP | 지원전진발동%');
  steps.forEach((st, k) => {
    console.log(`  ${k}  | ${st.n} | ${fmt(avg(st.bestRisk))} | ${fmt(avg(st.centerRisk))} | ${fmt(avg(st.flankRisk))} | ${pct(st.bestIsFlank, st.n)} | ${pct(st.chosenFlank, st.chosen)} | ${fmt(avg(st.regainP))} | ${fmt(avg(st.cutP))} | ${pct(st.oppMoved, st.n)}`);
  });
  const roles = steps.map((st) => Object.entries(st.hunterRoles).sort((a, b) => b[1] - a[1]).map(([r, c]) => `${r}:${c}`).join(' '));
  console.log(`  사냥조 역할 분포 step0[${roles[0]}] step1[${roles[1]}] step2[${roles[2]}]`);
}

console.log('\n=== 같은 타깃 레인의 risk 변화 (step0→1, 사냥조가 떠난 자리) — A1, n=600 ===');
{
  // step0에서 사냥조(2인)의 "이전 위치"에 가까웠던 레인 vs 나머지 레인의 risk 변화 비교
  let nearDelta = [], farDelta = [];
  for (let seed = 1; seed <= 600; seed++) {
    const e = openDefense(seed, 'A1');
    if (e.state.matchDecision?.id !== 'defend') continue;
    const carrier0 = e.state.players.find((p) => p.id === e.state.holderId);
    const hunters0 = e.state.players.filter((p) => p.side === 'us' && p.role !== 'GK')
      .sort((a, b) => dist(a, carrier0) - dist(b, carrier0)).slice(0, 2)
      .map((p) => ({ x: p.x, y: p.y }));
    const read0 = oppBuildDryRun(e.state);
    const risk0 = new Map((read0?.candidates ?? []).map((c) => [c.target.id, c]));
    const r = e.chooseSituationOption('dp_drop');
    if (r.recovered || r.xg != null || e.state.matchDecision?.id !== 'defend') continue;
    const read1 = oppBuildDryRun(e.state);
    for (const c1 of read1?.candidates ?? []) {
      const c0 = risk0.get(c1.target.id);
      if (!c0) continue;
      const y = c1.targetReal?.y ?? c1.target.y, x = c1.targetReal?.x ?? c1.target.x;
      const nearHunter = hunters0.some((h) => Math.hypot(h.x - x, h.y - y) < 14);
      (nearHunter ? nearDelta : farDelta).push(c1.risk - c0.risk);
    }
  }
  console.log(`사냥조 출발 위치 14m 내 타깃 레인: n=${nearDelta.length} risk Δ평균 ${fmt(avg(nearDelta))} (음수=싸짐)`);
  console.log(`그 외 레인:                     n=${farDelta.length} risk Δ평균 ${fmt(avg(farDelta))}`);
}
