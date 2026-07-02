// E6: 포메이션 트레이드오프(FORMATION_MODS) + 교체 안전성 + 설정 정합성.
// (구 3-셰이프 BUILD_SHAPES/applyShape 시스템 → 라이브 FORMATION_* 로 이관, 2026 감사.)
import { FORMATION_BUILDERS, FORMATION_MODS, FORMATION_ARCHETYPE, FORMATION_UNLOCKS, isFormationUnlocked } from '../js/data/formations.js';
import { applyFormationMods, resolveScoreline } from '../js/career/mods.js';
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 포메이션 트레이드오프 (E6) ===\n');

const base = () => ({ passBoost: 0.10, shotBoost: 0.20, gkBoost: 0.05, xgMul: 1, oppOVR: 200, teamOVR: 220, atk: 110, def: 110, trainingScore: {} });
const apply = (key) => applyFormationMods(base(), FORMATION_MODS[key]);

// 1) 설정 정합성 — 8개 포메이션이 세 맵(빌더/모드/아키타입)에 모두 존재해야
//    (포메이션을 한 맵에만 추가하고 다른 맵에 빠뜨리는 "미반영"을 잡는다).
const keys = Object.keys(FORMATION_BUILDERS);
ok(keys.length === 8, `포메이션 8개 (${keys.length})`);
ok(keys.every((k) => FORMATION_MODS[k] && FORMATION_ARCHETYPE[k]), '모든 포메이션이 MODS·ARCHETYPE에 정의됨');
ok(keys.every((k) => ['balanced', 'control', 'attack'].includes(FORMATION_ARCHETYPE[k])), '아키타입은 balanced/control/attack 중 하나');

// 1b) 해금 정합성 — 모든 포메이션이 UNLOCKS에 정의, 신규 세이브에 기본 2개 이상 열림,
//     조건(wins/matches)이 실제로 게이트하며 진행 시 열린다.
ok(keys.every((k) => k in FORMATION_UNLOCKS), '모든 포메이션이 FORMATION_UNLOCKS에 정의됨');
const freshClub = { record: { w: 0, d: 0, l: 0 }, matchday: 0 };
const defaults = keys.filter((k) => isFormationUnlocked(k, freshClub));
ok(defaults.length >= 2 && defaults.includes('f433'), `신규 세이브 기본 해금 ${defaults.length}개 (f433 포함)`);
ok(!isFormationUnlocked('f532', freshClub), '조건부 포메이션은 신규 세이브에서 잠김');
ok(isFormationUnlocked('f532', { record: { w: 8 }, matchday: 30 }), '조건 충족 시 해금(8승→5-3-2)');
ok(isFormationUnlocked('f451', { record: { w: 0 }, matchday: 22 }), '경기수 조건 해금(22경기→4-5-1)');
ok(keys.every((k) => isFormationUnlocked(k, { record: { w: 99 }, matchday: 99 })), '충분한 진행이면 전부 해금');
ok(isFormationUnlocked('f433', undefined), '클럽 상태 부재(자유 플레이) 시 기본 포메이션 안전');

// 2) mods 트레이드오프 방향성
const def = apply('f532');   // 최수비 concedeMul 0.78
const bal = apply('f433');   // 균형 concedeMul 1.00
const atk = apply('f343');   // 최공격 concedeMul 1.12 + xgMul
ok(def.shapeConcedeMul < 1, `수비형(5-3-2): 실점↓ (${def.shapeConcedeMul})`);
ok(bal.shapeConcedeMul === 1, `균형(4-3-3): 중립 (${bal.shapeConcedeMul})`);
ok(atk.shapeConcedeMul > 1 && atk.xgMul > 1, `공격형(3-4-3): 실점↑·xG↑ (${atk.shapeConcedeMul}, xg ${atk.xgMul})`);
ok(applyFormationMods(base(), undefined).shapeConcedeMul === undefined, '빈 mods는 무시(안전)');

// 3) 실점 단조성 (시드 RNG) — 수비형 < 균형 < 공격형
function concede(key, n = 6000) {
  let goals = 0, seed = 7;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) goals += resolveScoreline({ tone: 'near', xg: 0.2, linesBroken: 1 }, apply(key), rng).oppGoals;
  return goals / n;
}
const cD = concede('f532'), cB = concede('f433'), cA = concede('f343');
ok(cD < cB && cB < cA, `실점 단조: 5-3-2(${cD.toFixed(3)}) < 4-3-3(${cB.toFixed(3)}) < 3-4-3(${cA.toFixed(3)})`);

// 4) 포메이션 교체 안전성 — 각 빌더로 엔진 생성 시 us=11·holder 정상·크래시 0
for (const key of keys) {
  const scn = { ...getScenario('A1'), buildOurs: FORMATION_BUILDERS[key] };
  const e = createEngine(scn, 99, { intensityOverride: 'high' });
  const us = e.state.players.filter((p) => p.side === 'us').length;
  for (let i = 0; i < 20; i++) e.update(16);
  ok(us === 11 && !!e.holder(), `${key}: 포메이션 교체 후 us=11·holder 정상 (us=${us})`);
}

console.log(fail === 0 ? '\n✅ 포메이션 트레이드오프 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
