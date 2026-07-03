// 5R 신규 — 위기 에스컬레이션 사다리(foul→drop)가 실제 플레이(정책)에서 발동하나?
// 사다리 조건(policy.js:145-152): beatenDeep(beaten>=1 && steps>=1) && regainPoor(bestOdds<0.40)
// && !foulLeft(누적 fouls>=2, state.facts.fouls는 "한 경기 전체" 카운터로 엔트리 간 지속)일 때만
// dp_drop이 base 위로 승격된다. 단일 진입(policyuse)은 loss에서 평균결정 1.1-1.6이라
// steps>=1 자체가 드물다 — 그럼 한 경기에서 여러 번 뺏기는(엔트리 반복) 상황을 합성해
// fouls 예산이 실제로 소진되고 사다리가 발동하는 빈도를 잰다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, pressPolicy } from '../js/engine/policy.js';

const RUNS = Number(process.argv[2] ?? 500);
const MAX_ENTRIES = Number(process.argv[3] ?? 25);   // 한 "경기" 안에서 강제 진입 반복 상한
const LOSSES = [{ x: 24, y: 10 }, { x: 42, y: 34 }, { x: 62, y: 58 }];

function forceEntry(e, loss, entry) {
  if (e.state.status !== 'live') return false;
  if (e.state.transition || e.state.defenseLoop || e.state.defensivePress) return false;
  e.state.transitionUsed = false;   // maybeOpenTransition 1회 제한 우회(합성 반복 진입 목적)
  e.state.transition = { kind: 'intercepted', detail: {}, loss, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  const r = e.chooseSituationOption('cp_retreat');
  return !!e.state.defenseLoop;
}

// pressPolicy 의 사다리 진입 조건(policy.js:145-152)을 그대로 재현 — "발동 가능 상태"였는지 판정.
function ladderArmed(view) {
  const pr = view.pressRead;
  if (!pr) return false;
  const read = view.oppBuildRead ?? null;
  const best = read?.best ?? null, trap = read?.trap ?? null, gamble = read?.gamble ?? null;
  const bestOdds = Math.max(pr.regainP ?? 0, pr.cutP ?? 0, (pr.markP ?? 0) * (pr.pred ?? 1));
  const beatenDeep = (pr.beaten ?? 0) >= 1 && (pr.steps ?? 0) >= 1;
  const regainPoor = bestOdds < 0.40;
  const foulLeft = (pr.fouls ?? 0) < 2;
  return { beatenDeep, regainPoor, foulExhausted: !foulLeft, armed: beatenDeep && regainPoor && !foulLeft };
}

for (const entry of ['reset', 'loss']) {
  for (const disp of ['safe', 'balanced', 'aggressive', 'direct']) {
    let totalEntries = 0, totalFoulPicks = 0, totalDropPicks = 0;
    let armedCount = 0, armedDropPicked = 0, foulEscalatedToCard = 0;
    let runsReachedFoulBudget = 0, entriesToBudget = [];
    for (let run = 0; run < RUNS; run++) {
      const e = createEngine(getScenario('A1'), 30000 + run, { defenseEntry: entry, opponentBuildDisposition: disp });
      let entries = 0, budgetHit = false;
      for (; entries < MAX_ENTRIES; entries++) {
        const loss = LOSSES[entries % 3];
        if (!forceEntry(e, loss, entry)) break;
        totalEntries++;
        if ((e.state.facts.fouls ?? 0) >= 2 && !budgetHit) { budgetHit = true; entriesToBudget.push(entries); runsReachedFoulBudget++; }
        for (let s = 0; s < 8 && e.state.defenseLoop; s++) {
          const view = buildPolicyView(e, 'us');
          const act = pressPolicy(view);
          if (act.kind !== 'situation_choice') break;
          const armInfo = ladderArmed(view);
          if (armInfo.armed) {
            armedCount++;
            if (act.choiceId === 'dp_drop') armedDropPicked++;
          }
          if (act.choiceId === 'dp_foul') totalFoulPicks++;
          if (act.choiceId === 'dp_drop') totalDropPicks++;
          const r = e.chooseSituationOption(act.choiceId);
          if (r.fouled && r.conceded) { foulEscalatedToCard++; break; }
          if (r.recovered || r.conceded === true || r.conceded === false || r.restarted) break;
          if (!r.ok) break;
        }
        if (e.state.status !== 'live') break;
      }
    }
    const avgBudget = entriesToBudget.length ? (entriesToBudget.reduce((a, b) => a + b, 0) / entriesToBudget.length).toFixed(1) : 'n/a';
    console.log(`[${entry.padEnd(5)}/${disp.padEnd(10)}] 진입누계=${totalEntries.toString().padStart(5)} foul선택=${totalFoulPicks.toString().padStart(4)} drop선택=${totalDropPicks.toString().padStart(4)} | 사다리armed=${armedCount.toString().padStart(3)}회 중 drop택=${armedDropPicked} | fouls≥2도달 ${runsReachedFoulBudget}/${RUNS}런(평균 ${avgBudget}진입째) | 카드실점 ${foulEscalatedToCard}`);
  }
}
console.log('\n판정: "사다리armed" 횟수가 0에 가까우면 위기 에스컬레이션(foul→drop)은 설계상만 존재하고');
console.log('실제 정책 플레이에서는 사실상 발동하지 않는다는 뜻 — beatenDeep(steps>=1) 자체가 loss 진입 1결정');
console.log('붕괴 때문에 도달하기 어렵거나, fouls≥2 예산 소진이 한 경기 내 드물기 때문.');
