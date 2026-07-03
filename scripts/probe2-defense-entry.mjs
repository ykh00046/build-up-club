// probe2-defense-entry.mjs — 수비 2라운드: 진입 단조(항상 상대 GK 200/200) 검증 +
// 상실 지점 기반 진입의 기대 효과 추정(카운터팩추얼) + 라인 컨트롤 레버 크기 측정.
// 게임 소스는 안 건드리고, 프로브가 진입 직후 state.holderId만 바꿔 "상실 지점에서
// 가장 가까운 상대가 첫 캐리어라면?"을 시뮬레이션한다. 두 팔 모두 첫 결정을 dp_drop으로
// 고정해(스테일 regainP/cutP 미사용) 공정 비교. (조사 전용)
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');

function openDefense(seed, loss, scen = 'A1', opts = {}) {
  const e = createEngine(getScenario(scen), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  e.chooseSituationOption('cp_retreat');
  return e;
}

console.log('=== 1) 진입 홀더 분포 — 시나리오 × 상실 지점 (seed 1..150) ===');
for (const scen of ['A1', 'B1', 'C2', 'D2']) {
  for (const loss of [{ x: 20, y: 12 }, { x: 42, y: 34 }, { x: 62, y: 55 }]) {
    const holders = {};
    let enters = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const e = openDefense(seed, loss, scen);
      if (e.state.matchDecision?.id !== 'defend') continue;
      enters++;
      const h = e.state.players.find((p) => p.id === e.state.holderId);
      const key = `${h.id}@(${h.x.toFixed(0)},${h.y.toFixed(0)})`;
      holders[key] = (holders[key] ?? 0) + 1;
    }
    console.log(`${scen} loss(${loss.x},${loss.y}) 진입 ${enters}: ${JSON.stringify(holders)}`);
  }
}

console.log('\n=== 2) 카운터팩추얼 — GK 진입(현행) vs 상실지점 최근접 진입, 첫 결정 dp_drop 고정 후 정책, n=1200 ===');
function playFrom(e, policy) {
  let guard = 0, decisions = 0;
  while (e.state.matchDecision?.id === 'defend' && guard++ < 8) {
    const choice = decisions === 0 ? 'dp_drop' : policy;
    decisions++;
    const r = e.chooseSituationOption(choice);
    if (r.recovered) return { end: 'regain', decisions };
    if (r.xg != null) return { end: r.conceded ? 'conceded' : 'saved', decisions, xg: r.xg };
  }
  return { end: 'other', decisions };
}
for (const loss of [{ x: 62, y: 34 }, { x: 42, y: 34 }, { x: 28, y: 20 }]) {
  for (const policy of ['dp_cut', 'dp_press', 'dp_drop']) {
    for (const mode of ['GK진입(현행)', '상실지점진입']) {
      let n = 0, regain = 0, conceded = 0, saved = 0, decSum = 0;
      const xgs = [];
      let entryX = [];
      for (let seed = 1; seed <= 1200; seed++) {
        const e = openDefense(seed, loss);
        if (e.state.matchDecision?.id !== 'defend') continue;
        if (mode === '상실지점진입') {
          const cands = e.state.players.filter((p) => p.side === 'opp' && p.role !== 'GK' && p.line !== 'gk');
          const tgt = cands.sort((a, b) => dist(a, loss) - dist(b, loss))[0];
          if (!tgt) continue;
          e.state.holderId = tgt.id;
          if (tgt.orientation !== undefined) tgt.orientation = 'FACING';
          if (e.state.ball) { e.state.ball.x = tgt.x; e.state.ball.y = tgt.y; }
        }
        n++;
        entryX.push(e.state.players.find((p) => p.id === e.state.holderId).x);
        const res = playFrom(e, policy);
        decSum += res.decisions;
        if (res.end === 'regain') regain++;
        else if (res.end === 'conceded') { conceded++; xgs.push(res.xg); }
        else if (res.end === 'saved') { saved++; xgs.push(res.xg); }
      }
      const axg = xgs.length ? xgs.reduce((s, v) => s + v, 0) / xgs.length : NaN;
      console.log(`loss(${loss.x},${loss.y}) ${policy.padEnd(8)} ${mode.padEnd(10)} | n ${n} | 진입x ${fmt(entryX.reduce((s, v) => s + v, 0) / entryX.length, 1)} | 회수 ${pct(regain, n)} | 실점 ${pct(conceded, n)} | 선방 ${pct(saved, n)} | 평균결정 ${(decSum / n).toFixed(2)} | avgXG ${fmt(axg)}`);
    }
    console.log('');
  }
}

console.log('=== 3) 라인 컨트롤 레버 크기 — lineIntents가 수비 국면 확률에 주는 실측 델타 ===');
// defensivePressProb: front==='pin' +0.08, mid==='between' +0.06. cutP: mid==='support' +0.08. back: 미사용.
for (const intents of [
  { name: '기본', v: null },
  { name: 'front=pin', v: { front: 'pin' } },
  { name: 'mid=between', v: { mid: 'between' } },
  { name: 'mid=support', v: { mid: 'support' } },
  { name: 'back=drop(미사용 확인)', v: { back: 'drop' } },
]) {
  const rps = [[], [], []], cps = [[], [], []];
  for (let seed = 1; seed <= 400; seed++) {
    const e = openDefense(seed, { x: 42, y: 34 });
    if (e.state.matchDecision?.id !== 'defend') continue;
    if (intents.v) Object.assign(e.state.lineIntents, intents.v);
    let k = 0;
    while (e.state.matchDecision?.id === 'defend' && k < 3) {
      // intents 적용 후 확률 재계산을 위해 한 스텝 진행 후의 값을 본다 (step0은 진입 시 계산분)
      const dl = e.state.defenseLoop;
      rps[k].push(dl.regainP); cps[k].push(dl.cutP);
      const r = e.chooseSituationOption('dp_drop');
      if (r.recovered || r.xg != null) break;
      k++;
    }
  }
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  console.log(`${intents.name.padEnd(22)} | step1 regainP ${fmt(avg(rps[1]))} cutP ${fmt(avg(cps[1]))} | step2 regainP ${fmt(avg(rps[2]))} cutP ${fmt(avg(cps[2]))}`);
}
console.log('(step0 확률은 intents 주입 전에 계산돼 비교는 step1+만 유효. back 레인은 수비 확률 어디에도 안 들어감 — engine.js:455-456,328)');
