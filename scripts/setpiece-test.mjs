// E5: 세트피스 — 코치 경제 + 정산 세트피스 골 채널 + 딜리버리 상성.
import { club, hardReset, normalizeState, buySetPieceCoach, setPieceCoachCost } from '../js/career/club.js';
import { resolveScoreline } from '../js/career/mods.js';
import { deliveryBonus, bestDeliveryFor, DELIVERIES } from '../js/data/setpieces.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 세트피스 (E5) ===\n');

// 1) 마이그레이션 — 구버전(필드 없음) → 0, 손상값 → 0~3 클램프
ok(normalizeState({}).setPieceCoach === 0, '구버전 세이브 → setPieceCoach 0 기본');
ok(normalizeState({ setPieceCoach: 99 }).setPieceCoach === 3, '과대값 → 3 클램프');
ok(normalizeState({ setPieceCoach: -5 }).setPieceCoach === 0, '음수 → 0 클램프');
ok(normalizeState({ setPieceCoach: 2.7 }).setPieceCoach === 2, '소수 → 정수 보정');

// 2) 코치 고용 경제
hardReset();
club.cash = 100000;
const c0 = setPieceCoachCost();
ok(typeof c0 === 'number' && c0 > 0, `Lv0 고용 비용 산출 (${Math.round(c0)})`);
ok(buySetPieceCoach() && club.setPieceCoach === 1, '고용 → 레벨 1, 자금 차감');
buySetPieceCoach(); buySetPieceCoach();
ok(club.setPieceCoach === 3, '최대 레벨 3까지 고용');
ok(setPieceCoachCost() === null && buySetPieceCoach() === false, '최대 레벨에서 추가 고용 불가');
hardReset(); club.cash = 10;
ok(buySetPieceCoach() === false, '자금 부족 시 고용 실패');

// 3) 세트피스 득점 채널 — 코치↑ / 딜리버리 상성 → 세트피스 골↑
const NM = { execMul: 1, xgMul: 1, concedeMul: 1, secondGoalBonus: 0, failConcedeRelief: 0 };
function spRate(setupExtra, n = 8000) {
  let sp = 0, seed = 13;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const setup = { atk: 110, def: 110, oppOVR: 220, trainingScore: {}, ...setupExtra };
  for (let i = 0; i < n; i++) if (resolveScoreline({ tone: 'fail' }, setup, rng, NM).setPieceGoal) sp++;
  return sp / n;
}
const noCoach = spRate({ delivery: 'inswing', deliveryBonus: 0, setPieceCoach: 0 });
const maxCoach = spRate({ delivery: 'inswing', deliveryBonus: 0, setPieceCoach: 3 });
const matched = spRate({ delivery: 'inswing', deliveryBonus: 1, setPieceCoach: 0 });
ok(maxCoach > noCoach, `코치↑ → 세트피스 골↑ (${(noCoach*100).toFixed(0)}% → ${(maxCoach*100).toFixed(0)}%)`);
ok(matched > noCoach, `마킹 상성 매칭 → 세트피스 골↑ (${(noCoach*100).toFixed(0)}% → ${(matched*100).toFixed(0)}%)`);

// 4) 딜리버리 상성 데이터
ok(deliveryBonus('inswing', 'man') === 1 && deliveryBonus('inswing', 'zonal') === 0, '인스윙: 대인 상성O / 지역 상성X');
ok(deliveryBonus('outswing', 'lowblock') === 1, '아웃스윙: 로우블록 상성O');
ok(deliveryBonus('short', 'hybrid') === 1, '숏코너: 하이브리드 상성O');
ok(bestDeliveryFor('gegen') === 'inswing' && DELIVERIES[bestDeliveryFor('midblock')], 'bestDeliveryFor 유효 키 반환');

// 5) delivery 없으면 채널 OFF — career-sim 회귀와 동일(rng 시퀀스 불변)
function seq(setupExtra) {
  const out = []; let seed = 77;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const setup = { atk: 110, def: 110, oppOVR: 220, trainingScore: {}, ...setupExtra };
  for (let i = 0; i < 300; i++) { const r = resolveScoreline({ tone: 'goal', xg: 0.3 }, setup, rng, NM); out.push(r.ourGoals + ':' + r.oppGoals); }
  return out.join(',');
}
ok(seq({}) === seq({ setPieceCoach: 3 }), 'delivery 없으면(=career-sim) 세트피스 채널 OFF, 시퀀스 불변');

console.log(fail === 0 ? '\n✅ 세트피스 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
