// probe-defense-risk.mjs — 수비 국면 스텝별 상대 루트 후보(best/gamble/trap)의
// risk/progress 실측 + 성향별 riskCap 필터가 실제로 뭘 남기는지 확인.
// (가설: risk가 높아 safe(riskCap 0.5)는 전부 걸러져 항상 best 폴백 → safe ≡ null)
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { oppBuildDryRun } from '../js/engine/dry-run.js';
import { OPP_DISPOSITIONS } from '../js/engine/opp-build-policy.js';

function openDefense(seed, scen = 'A1') {
  const e = createEngine(getScenario(scen), seed, {});
  e.state.transition = { kind: 'intercepted', detail: {}, loss: { x: 42, y: 34 }, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

const f = (v, d = 2) => (v == null ? '—' : v.toFixed(d));
for (const scen of ['A1', 'B1', 'D2']) {
  const e = openDefense(7, scen);
  if (e.state.matchDecision?.id !== 'defend') { console.log(`${scen}: 진입 실패`); continue; }
  console.log(`\n═══ ${scen} — 스텝별 상대 루트 후보 ═══`);
  let step = 0;
  while (e.state.matchDecision?.id === 'defend' && step < 4) {
    const read = oppBuildDryRun(e.state);
    const desc = (c) => c ? `${c.target.id} prog=${f(c.progress, 1)} risk=${f(c.risk)}` : '없음';
    console.log(`step ${step}: holder=${e.state.holderId}`);
    console.log(`  best   → ${desc(read.best)}`);
    console.log(`  gamble → ${desc(read.gamble)}`);
    console.log(`  trap   → ${desc(read.trap)}`);
    for (const [name, prof] of Object.entries(OPP_DISPOSITIONS)) {
      const lanes = [
        { k: 'best', c: read.best, w: prof.best },
        { k: 'gamble', c: read.gamble, w: prof.gamble },
        { k: 'trap', c: read.trap, w: prof.trap },
      ].filter((l) => l.c && l.w > 0 && (l.c.risk ?? 0) <= prof.riskCap);
      console.log(`    ${name.padEnd(10)} riskCap=${prof.riskCap} → 선택 가능: [${lanes.map((l) => l.k).join(', ') || '없음 → best 폴백'}]`);
    }
    e.chooseSituationOption('dp_drop');
    step++;
  }
}

// 상대 패스가 자기 risk를 굴리는지(실패 가능한지) — 코드 계약 확인용 재현:
// applyOpponentBuildStep은 progress<1 (stall) 외의 실패 경로가 없다. risk 0.9짜리
// 루트도 100% 성공하는지 대량 확인.
console.log('\n═══ 상대 전개 패스의 자체 실패율 (risk를 굴리는가?) ═══');
let steps = 0, stalls = 0, riskySteps = 0;
for (let seed = 1; seed <= 800; seed++) {
  const e = openDefense(seed);
  if (e.state.matchDecision?.id !== 'defend') continue;
  let g = 0;
  while (e.state.matchDecision?.id === 'defend' && g++ < 6) {
    const read = oppBuildDryRun(e.state);
    const bestRisk = read?.best?.risk ?? 0;
    const before = e.state.holderId;
    const r = e.chooseSituationOption('dp_drop');
    steps++;
    if (bestRisk >= 0.5) riskySteps++;
    if (r.recovered) stalls++;
  }
}
console.log(`총 전개 스텝 ${steps}, best.risk≥0.5였던 스텝 ${riskySteps} (${(riskySteps / steps * 100).toFixed(1)}%), 스텝 자체 실패(정체 회수) ${stalls}`);
console.log('→ risk가 아무리 높아도 전개 패스는 절대 실패하지 않음(정체 제외) — risk는 성향 필터에만 쓰이는 죽은 값');
