// probe2-attack-shotparity — 백프레셔 미리보기 정합 검증.
// engine.previewShot()은 클로저 effIntensity, shots.resolveShot()은 state.pressIntensity 를
// 쓴다. 두 경로가 같은 xG 를 내는지 세 겹으로 확인:
//   (a) 결정 시점: previewShot().xg vs computeShotXg(h, zone, opp, state.pressIntensity)
//   (b) 실행 후: 슛 직전 previewShot().xg vs state.outcome.xg (endAttempt 에 실린 해소값)
//   (c) evaluator 슛 후보(safety=xg) vs previewShot().xg
// intensityOverride 있는 경우 + 없는 경우(시나리오 자체 강도) + pressIntensity 를
// 외부에서 훼손한 경우(세이브/미러 류 경로 리스크)를 모두 잰다.
//
// 실행: node scripts/probe2-attack-shotparity.mjs [셀당 경기수]

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, executePolicyAction, aiPolicy, settle } from '../js/engine/policy.js';
import { computeShotXg, detectShotZone, shotBackpressure } from '../js/engine/shots.js';

const N = Number(process.argv[2] ?? 120);
const EPS = 1e-9;

function runSuite(label, makeEngine, tamper = null) {
  const S = { decisions: 0, aMis: 0, bChecked: 0, bMis: 0, cMis: 0, maxDiffA: 0, maxDiffB: 0, samples: [] };
  for (let i = 0; i < N; i++) {
    const engine = makeEngine(i * 7 + 13);
    if (tamper) tamper(engine);
    let turns = 0, stuck = 0;
    let pendingPreview = null; // 슛 디스패치 직전 previewShot 값
    while (engine.state.status === 'live' && turns < 60) {
      settle(engine);
      if (engine.state.status !== 'live') break;
      const view = buildPolicyView(engine, 'us');
      const action = aiPolicy(view);
      if (!action || action.kind === 'noop') { if (++stuck > 4) break; continue; }

      if (action.kind === 'engine_action' && action.actionId === 'shoot') {
        const pv = engine.previewShot?.();
        if (pv) {
          S.decisions++;
          // (a) 해소 경로 재현: state.pressIntensity 기반 computeShotXg
          const h = engine.holder();
          const zone = detectShotZone(h, engine.state);
          const opp = engine.state.players.filter((p) => p.side === 'opp');
          const resolveXg = zone
            ? computeShotXg(h, zone, opp, { backpressure: shotBackpressure(engine.state.pressIntensity) }).xg
            : NaN;
          const dA = Math.abs(pv.xg - resolveXg);
          if (!(dA < EPS)) { S.aMis++; S.maxDiffA = Math.max(S.maxDiffA, dA); if (S.samples.length < 3) S.samples.push({ seed: i * 7 + 13, turn: engine.state.turn, preview: pv.xg, resolve: resolveXg, pressIntensity: engine.state.pressIntensity }); }
          // (c) evaluator 슛 후보와의 정합
          const shotCand = view.boardRead?.candidates?.find((c) => c.type === 'shot');
          if (shotCand && Math.abs(shotCand.safety - pv.xg) > EPS) S.cMis++;
          pendingPreview = pv.xg;
        }
      }
      const r = executePolicyAction(engine, action);
      settle(engine);
      // (b) 슛이 즉시 종결됐다면 outcome.xg 와 대조
      if (pendingPreview != null && engine.state.status === 'over' && engine.state.outcome?.xg != null) {
        S.bChecked++;
        const dB = Math.abs(engine.state.outcome.xg - pendingPreview);
        if (!(dB < EPS)) { S.bMis++; S.maxDiffB = Math.max(S.maxDiffB, dB); }
        pendingPreview = null;
      }
      if (!r || r.ok === false) { if (++stuck > 4) break; } else stuck = 0;
      turns++;
    }
  }
  console.log(`[${label}] 슛 결정 ${S.decisions}회 — (a)프리뷰≠해소식 ${S.aMis} (maxΔ ${S.maxDiffA.toExponential(2)})  (b)프리뷰≠outcome.xg ${S.bMis}/${S.bChecked} (maxΔ ${S.maxDiffB.toExponential(2)})  (c)evaluator≠프리뷰 ${S.cMis}`);
  for (const s of S.samples) console.log(`   예: seed ${s.seed} turn ${s.turn} preview ${s.preview.toFixed(4)} resolve ${s.resolve.toFixed(4)} pressIntensity=${s.pressIntensity}`);
}

console.log(`=== 슛 미리보기 정합 프로브 (셀당 ${N}경기) ===\n`);

// 1) 커리어 경로: intensityOverride 사용 (effIntensity === override)
runSuite('A1 + override vhigh', (seed) => createEngine(getScenario('A1'), seed, { intensityOverride: 'vhigh', defenseLoop: false }));

// 2) 전술 단판 경로: 시나리오 자체 강도 (override 없음)
runSuite('B1 (man/high, override 없음)', (seed) => createEngine(getScenario('B1'), seed, { defenseLoop: false }));
runSuite('D2 (lowblock/low, override 없음)', (seed) => createEngine(getScenario('D2'), seed, { defenseLoop: false }));

// 3) 어긋남 경로 시뮬레이션: state.pressIntensity 가 외부(세이브 복원·직렬화 등)에서
//    훼손되면 preview(클로저 effIntensity)와 resolve(state)가 실제로 갈라지는가 —
//    코드 구조상 유일한 분기 지점의 실증.
runSuite('A1 override vhigh + state.pressIntensity←"mid" 훼손', (seed) => createEngine(getScenario('A1'), seed, { intensityOverride: 'vhigh', defenseLoop: false }), (e) => { e.state.pressIntensity = 'mid'; });

console.log('\n완료.');
