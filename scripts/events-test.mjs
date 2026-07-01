// 변주 시스템 회귀 — 효과 substrate + 미션 + 이벤트 + 부상/컨디션.
// 실행: node scripts/events-test.mjs
import * as Club from '../js/career/club.js';
import { checkMission, applyEventChoice, currentMission, effectsSummary } from '../js/career/events.js';
import { loc } from '../js/career/i18n.js';

let fail = 0;
function ok(cond, msg) { console.log(`  ${cond ? '✓' : '✗ FAIL —'} ${msg}`); if (!cond) fail++; }
function finite(...xs) { return xs.every(Number.isFinite); }

console.log('=== 변주 시스템 회귀 ===\n');

// 1) effects=[] → base와 동일 (불변식)
Club.hardReset();
const baseAtk = Club.attackOVR(), baseDef = Club.defenseOVR();
console.log('[1] 효과 없음 = base 동일');
ok(Club.effectiveLevels().mf === Club.club.levels.mf, 'effectiveLevels == club.levels');
ok(baseAtk === 8 + 1 * 0 + 1 * 0.3 + 1 * 1.4 + 1 * 2.6, `attackOVR=${baseAtk.toFixed(1)} (base 공식 그대로)`);

// 2) 부상 → 실효 OVR 하락, 만료 후 복구
console.log('\n[2] 부상/만료');
Club.club.matchday = 10;
Club.addEffect({ type: 'injury', pos: 'fw', dLevel: -2, until: 13, label: '공격수 부상', tone: 'bad' });
const hurtAtk = Club.attackOVR();
ok(hurtAtk < baseAtk, `부상 시 공격 OVR 하락 ${baseAtk.toFixed(1)}→${hurtAtk.toFixed(1)}`);
Club.club.matchday = 13; Club.tickEffects();
ok(Club.attackOVR() === baseAtk && Club.club.effects.length === 0, '만료 후 base 복구 + effects 비움');

// 3) 감독 폼 → 전역 배율
console.log('\n[3] 감독 폼 배율');
Club.hardReset();
Club.club.matchday = 0;
Club.addEffect({ type: 'form', atkMul: 1.12, defMul: 0.96, until: 3, label: '공격 방침', tone: 'good' });
ok(Math.abs(Club.attackOVR() - baseAtk * 1.12) < 1e-6, '공격 폼 +12% 반영');
ok(Math.abs(Club.defenseOVR() - baseDef * 0.96) < 1e-6, '수비 폼 -4% 반영');

// 4) 디비전 미션 — 승리로 달성, 보상 지급, 1회성
console.log('\n[4] 디비전 미션');
Club.hardReset();
const cash0 = Club.club.cash;
const m1 = checkMission({ result: 'w', cleanSheet: false, ourGoals: 1, oppGoals: 0, tone: 'goal' });
ok(m1 && loc(m1.title) === '첫 승점', `5부 미션 달성: ${loc(m1?.title)}`);
ok(Club.club.cash > cash0, `보상 지급 (+${(Club.club.cash - cash0)})`);
ok(checkMission({ result: 'w' }) === null, '이미 달성한 미션은 재보상 없음');
ok(currentMission().done === true, 'currentMission.done = true');

// 5) 이벤트 선택 적용 — 폼/영입
console.log('\n[5] 이벤트 선택');
Club.hardReset(); Club.club.matchday = 5;
const mgr = { type: 'manager', title: 't', desc: 'd', choices: [
  { label: '공격 집중', desc: '', apply: () => Club.addEffect({ type: 'form', atkMul: 1.12, defMul: 0.96, until: 8, label: '공격 방침', tone: 'good' }) },
] };
applyEventChoice(mgr, 0);
ok(Club.attackOVR() > baseAtk, '감독 선택(공격 집중) → 공격 OVR 상승');
ok(effectsSummary().length === 1 && effectsSummary()[0].left === 3, `허브 효과 요약: ${effectsSummary()[0].label} (${effectsSummary()[0].left}경기)`);

const lvl0 = Club.club.levels.mf;
const scout = { type: 'scout', title: 't', desc: 'd', choices: [
  { label: '영입', desc: '', cost: () => 50, apply() { const c = this.cost(); if (Club.club.cash < c) return false; Club.club.cash -= c; Club.grantLevels('mf', 2); return true; } },
] };
Club.club.cash = 1000;
applyEventChoice(scout, 0);
ok(Club.club.levels.mf === lvl0 + 2, `영입 → 미드필더 영구 +2 (${lvl0}→${Club.club.levels.mf})`);

// 6) 전체 무결성
console.log('\n[6] 무결성');
ok(finite(Club.attackOVR(), Club.defenseOVR(), Club.teamOVR(), Club.club.cash), 'OVR·자금 모두 유한(NaN 없음)');

console.log(fail === 0 ? '\n✅ 변주 시스템 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
