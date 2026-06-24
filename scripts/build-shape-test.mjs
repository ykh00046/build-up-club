// E6: 빌드업 셰이프 트레이드오프 + 포메이션 교체 안전성.
import { BUILD_SHAPES, applyShape, resolveScoreline } from '../js/career/mods.js';
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 빌드업 셰이프 (E6) ===\n');

// 1) 보정값
const base = () => ({ passBoost: 0.10, shotBoost: 0.20, gkBoost: 0.05, xgMul: 1, oppOVR: 200, teamOVR: 220, atk: 110, def: 110, trainingScore: {} });
const bal = applyShape(base(), 'balanced');
const con = applyShape(base(), 'control');
const atk = applyShape(base(), 'attack');
ok(bal.shapeConcedeMul === 1 && bal.passBoost === 0.10, '균형: 보정 중립');
ok(con.shapeConcedeMul < 1 && con.passBoost > bal.passBoost && con.shotBoost < bal.shotBoost, '통제: 실점↓·중앙통제(pass↑)·마무리↓');
ok(atk.shapeConcedeMul > 1 && atk.shotBoost > bal.shotBoost && atk.xgMul > 1, '공격: 실점↑·마무리↑·xG↑');
ok(applyShape(base(), 'unknown').shape === undefined || applyShape(base(), 'nope').shapeConcedeMul === undefined, '알 수 없는 셰이프는 무시(안전)');

// 2) 실점 단조성 (시드 RNG)
function concede(shapeKey, n = 6000) {
  let goals = 0, seed = 7;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) goals += resolveScoreline({ tone: 'near', xg: 0.2, linesBroken: 1 }, applyShape(base(), shapeKey), rng).oppGoals;
  return goals / n;
}
const cC = concede('control'), cB = concede('balanced'), cA = concede('attack');
ok(cC < cB && cB < cA, `실점 단조: control(${cC.toFixed(3)}) < balanced(${cB.toFixed(3)}) < attack(${cA.toFixed(3)})`);

// 3) 포메이션 교체 안전성 — 각 셰이프 빌더로 엔진 생성 시 us=11, holder 정상, 크래시 0
for (const key of Object.keys(BUILD_SHAPES)) {
  const b = BUILD_SHAPES[key].builder;
  const scn = b ? { ...getScenario('A1'), buildOurs: b } : getScenario('A1');
  const e = createEngine(scn, 99, { intensityOverride: 'high' });
  const us = e.state.players.filter((p) => p.side === 'us').length;
  for (let i = 0; i < 20; i++) e.update(16);
  ok(us === 11 && !!e.holder(), `${key}: 포메이션 교체 후 us=11·holder 정상 (us=${us})`);
}

console.log(fail === 0 ? '\n✅ 빌드업 셰이프 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
