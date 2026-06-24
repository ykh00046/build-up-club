// E8: 선수 롤 — 같은 포지션의 트레이드오프 변조. 기본 'none'은 중립(career-sim 불변).
import { club, hardReset, normalizeState, setRole } from '../js/career/club.js';
import { matchSetup, resolveScoreline } from '../js/career/mods.js';
import { roleMods, validRole, ROLES } from '../js/data/roles.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 선수 롤 (E8) ===\n');

// 1) 마이그레이션 — 구버전(필드 없음) → none, 부분/손상 보정
ok(normalizeState({}).roles.mf === 'none' && normalizeState({}).roles.fw === 'none', '구버전 → roles {mf:none, fw:none}');
ok(normalizeState({ roles: { mf: 'regista' } }).roles.mf === 'regista' && normalizeState({ roles: { mf: 'regista' } }).roles.fw === 'none', '부분 → mf 보존, fw 기본');
ok(normalizeState({ roles: 'broken' }).roles.fw === 'none', '손상 roles → 기본 보정');

// 2) 데이터 무결성
ok(validRole('mf', 'regista') && validRole('fw', 'target') && !validRole('mf', 'nope'), 'validRole 판정');
ok(roleMods('mf', 'none') && Object.keys(roleMods('mf', 'none')).length === 0, 'none 롤은 빈 mods');

// 3) matchSetup이 롤 트레이드오프를 반영
hardReset(); club.levels = { gk: 6, df: 6, mf: 6, fw: 6 };
const baseSetup = matchSetup(200);
setRole('mf', 'regista'); setRole('fw', 'inside');
const roleSetup = matchSetup(200);
ok(roleSetup.shotBoost > baseSetup.shotBoost, '인사이드 포워드 → shotBoost↑');
ok(roleSetup.xgMul > baseSetup.xgMul, '인사이드 포워드 → xgMul↑');
ok(roleSetup.roleConcedeMul > 1, '레지스타 → roleConcedeMul>1(역습 노출)');
ok(roleSetup.passBoost > baseSetup.passBoost, '레지스타 → passBoost↑');

hardReset(); club.levels = { gk: 6, df: 6, mf: 6, fw: 6 };
setRole('mf', 'mezzala'); setRole('fw', 'target');
const mt = matchSetup(200);
ok(mt.roleSecondGoalAdd > 0, '메짤라 → roleSecondGoalAdd>0(다득점)');
ok(mt.roleSetPieceAdd > 0, '타깃맨 → roleSetPieceAdd>0(세트피스)');

// 4) resolveScoreline이 롤 필드에 반응
const NM = { execMul: 1, xgMul: 1, concedeMul: 1, secondGoalBonus: 0, failConcedeRelief: 0 };
function avg(setupExtra, key, n = 8000) {
  let s = 0, seed = 9;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const setup = { atk: 120, def: 110, oppOVR: 220, trainingScore: {}, ...setupExtra };
  for (let i = 0; i < n; i++) s += resolveScoreline({ tone: 'goal', xg: 0.3 }, setup, rng, NM)[key];
  return s / n;
}
ok(avg({ roleConcedeMul: 1.06 }, 'oppGoals') > avg({ roleConcedeMul: 1 }, 'oppGoals'), '레지스타 concedeMul → 실점↑');
ok(avg({ roleSecondGoalAdd: 0.1 }, 'ourGoals') > avg({ roleSecondGoalAdd: 0 }, 'ourGoals'), '메짤라 secondGoalAdd → 득점↑');
const spOn = (() => { let s=0,seed=3; const rng=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}; for(let i=0;i<8000;i++) if(resolveScoreline({tone:'fail'},{atk:110,def:110,oppOVR:220,trainingScore:{},delivery:'inswing',deliveryBonus:0,setPieceCoach:0,roleSetPieceAdd:0.06},rng,NM).setPieceGoal) s++; return s/8000; })();
const spOff = (() => { let s=0,seed=3; const rng=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}; for(let i=0;i<8000;i++) if(resolveScoreline({tone:'fail'},{atk:110,def:110,oppOVR:220,trainingScore:{},delivery:'inswing',deliveryBonus:0,setPieceCoach:0,roleSetPieceAdd:0},rng,NM).setPieceGoal) s++; return s/8000; })();
ok(spOn > spOff, `타깃맨 roleSetPieceAdd → 세트피스 골↑ (${(spOff*100).toFixed(0)}%→${(spOn*100).toFixed(0)}%)`);

// 5) 롤 미설정(none)·필드 없음 = career-sim과 동일(시퀀스 불변)
function seq(setupExtra) {
  const out = []; let seed = 55;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const setup = { atk: 120, def: 110, oppOVR: 220, trainingScore: {}, ...setupExtra };
  for (let i = 0; i < 300; i++) { const r = resolveScoreline({ tone: 'goal', xg: 0.3 }, setup, rng, NM); out.push(r.ourGoals + ':' + r.oppGoals); }
  return out.join(',');
}
ok(seq({}) === seq({ roleConcedeMul: 1, roleSecondGoalAdd: 0, roleSetPieceAdd: 0 }), '롤 중립값 = 필드 없음, 시퀀스 불변(career-sim 안전)');

console.log(fail === 0 ? '\n✅ 선수 롤 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
