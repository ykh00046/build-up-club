// probe2-attack-deftrace — 상대 수비수 개인 좌표 트레이스 새너티.
// (1) 경계 박제: 수비수가 클램프 경계(x/y = 2 또는 상한)에 붙어 있는 턴 비율.
// (2) 프리즈: 공이 12m+ 움직이는 동안 5턴 연속 0.6m 미만 이동(박제 후보).
// (3) 커밋 복귀: full_commit(committedTurns=2) 종료 후 홈 앵커 거리로의 감쇠 —
//     복귀가 자연스러운가(커밋 후 t+1..t+4 홈 거리 평균).
// (4) GK 이동량: positionBlock 은 GK 를 homeX/homeY 에 고정한다 — 실측.
// (5) 겹침: 정착 후 수비수-우리선수 거리 < 2.0m 페어(분리 규칙 위반) 빈도.
//
// 실행: node scripts/probe2-attack-deftrace.mjs [셀당 경기수] [상세시드수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { PITCH_W, PITCH_H } from '../js/data/pitch.js';

const N = Number(process.argv[2] ?? 200);
const DETAIL_SEEDS = Number(process.argv[3] ?? 2);
const CELLS = ['A1', 'B1', 'D2'];
const B = 2.05; // 클램프 경계 여유

function playTrace(seed, cell, S, detail) {
  const engine = createEngine(getScenario(cell), seed, { defenseLoop: false });
  const prev = new Map();   // id → {x,y,still,ballX,ballY}
  const commitEnd = new Map(); // id → {endedTurn, samples:[]}
  let turns = 0, stuck = 0;
  let prevBall = null;
  while (engine.state.status === 'live' && turns < 60) {
    settle(engine);
    if (engine.state.status !== 'live') break;
    const view = buildPolicyView(engine, 'us');
    const action = aiPolicy(view);
    if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }
    const r = executePolicyAction(engine, action);
    settle(engine);

    const ball = engine.holder?.() ?? prevBall;
    for (const d of engine.state.players) {
      if (d.side !== 'opp') continue;
      S.turnSamples++;
      // (4) GK
      if (d.line === 'gk') {
        const p = prev.get(d.id);
        if (p) S.gkMove += Math.hypot(d.x - p.x, d.y - p.y);
        S.gkSamples++;
        prev.set(d.id, { x: d.x, y: d.y, still: 0 });
        continue;
      }
      // (1) 경계 박제
      if (d.x <= B || d.x >= PITCH_W - B || d.y <= B || d.y >= PITCH_H - B) {
        S.boundary++;
        S.boundaryBy[d.role ?? d.id] = (S.boundaryBy[d.role ?? d.id] || 0) + 1;
      }
      // (2) 프리즈 (공은 움직이는데 수비수는 안 움직임)
      const p = prev.get(d.id);
      if (p) {
        const mv = Math.hypot(d.x - p.x, d.y - p.y);
        const ballMv = ball && prevBall ? Math.hypot(ball.x - prevBall.x, ball.y - prevBall.y) : 0;
        const still = (mv < 0.6 && ballMv > 12) ? (p.still + 1) : 0;
        if (still >= 3) { S.freezes++; S.freezeBy[d.role ?? d.id] = (S.freezeBy[d.role ?? d.id] || 0) + 1; }
        prev.set(d.id, { x: d.x, y: d.y, still });
      } else prev.set(d.id, { x: d.x, y: d.y, still: 0 });

      // (3) 커밋 복귀 추적
      const homeD = Math.hypot(d.x - d.homeX, d.y - d.homeY);
      if (d.committedTurns === 2) commitEnd.set(d.id, { phase: 'committing', samples: [], atCommitHomeD: homeD });
      const ce = commitEnd.get(d.id);
      if (ce) {
        if (ce.phase === 'committing' && d.committedTurns <= 0) ce.phase = 'recovering';
        else if (ce.phase === 'recovering') {
          ce.samples.push(homeD);
          if (ce.samples.length >= 4) {
            S.commits++;
            for (let k = 0; k < 4; k++) { S.recHomeD[k] += ce.samples[k]; }
            S.recStartD += ce.atCommitHomeD;
            commitEnd.delete(d.id);
          }
        }
      }
      // (5) 겹침
      for (const o of engine.state.players) {
        if (o.side !== 'us') continue;
        if (Math.hypot(d.x - o.x, d.y - o.y) < 2.0) { S.overlaps++; break; }
      }
    }
    prevBall = ball ? { x: ball.x, y: ball.y } : prevBall;

    if (detail && turns < 14) {
      const line = engine.state.players.filter((q) => q.side === 'opp' && q.line !== 'gk')
        .map((q) => `${q.role ?? q.id}(${q.x.toFixed(0)},${q.y.toFixed(0)}${q.committedTurns > 0 ? '*' : ''})`).join(' ');
      console.log(`  [${cell} s${seed} t${engine.state.turn}] ball(${ball?.x.toFixed(0)},${ball?.y.toFixed(0)}) ${line}`);
    }

    if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
    turns++;
  }
}

console.log(`=== 수비수 트레이스 새너티: ${CELLS.join('/')} × ${N}경기 ===\n`);
for (const cell of CELLS) {
  const S = {
    turnSamples: 0, boundary: 0, boundaryBy: {}, freezes: 0, freezeBy: {},
    commits: 0, recHomeD: [0, 0, 0, 0], recStartD: 0,
    gkMove: 0, gkSamples: 0, overlaps: 0,
  };
  for (let i = 0; i < N; i++) playTrace(i * 7 + 13, cell, S, false);
  const pct = (x) => (x / (S.turnSamples || 1) * 100).toFixed(2);
  console.log(`[${cell}] 수비수-턴 샘플 ${S.turnSamples}`);
  console.log(`  경계 박제: ${S.boundary} (${pct(S.boundary)}%)  주범: ${JSON.stringify(S.boundaryBy)}`);
  console.log(`  프리즈(공 12m+ 이동 중 3턴+ 정지): ${S.freezes}  주범: ${JSON.stringify(S.freezeBy)}`);
  if (S.commits) {
    const rec = S.recHomeD.map((v) => (v / S.commits).toFixed(1)).join(' → ');
    console.log(`  커밋 복귀: ${S.commits}회 — 커밋 시 홈거리 평균 ${(S.recStartD / S.commits).toFixed(1)}m, 종료 후 t+1..t+4 홈거리 ${rec}`);
  }
  console.log(`  GK 평균 이동/턴: ${(S.gkMove / (S.gkSamples || 1)).toFixed(2)}m  | 겹침(<2.0m) ${S.overlaps}건 (${pct(S.overlaps)}%)\n`);
}

console.log('--- 상세 좌표 트레이스(소량) ---');
for (let s = 0; s < DETAIL_SEEDS; s++) {
  playTrace(1000 + s * 37, 'B1', { turnSamples: 0, boundary: 0, boundaryBy: {}, freezes: 0, freezeBy: {}, commits: 0, recHomeD: [0, 0, 0, 0], recStartD: 0, gkMove: 0, gkSamples: 0, overlaps: 0 }, true);
  console.log('');
}
console.log('완료.');
