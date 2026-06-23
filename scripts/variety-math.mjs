// 생산 코드의 변주 수식을 직접 검증한다. 구현을 테스트 안에 복제하지 않는다.
import * as Club from '../js/career/club.js';
import { checkMission, shouldTriggerEvent } from '../js/career/events.js';

let fail = 0;
const ok = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗ FAIL —'} ${message}`);
  if (!condition) fail += 1;
};

console.log('=== 변주 수식 불변식 ===\n');
Club.hardReset();
const baseAtk = Club.attackOVR();
const baseDef = Club.defenseOVR();

console.log('[불변식] 효과 없음 = base 동일');
ok(baseAtk === 8 + 0.3 + 1.4 + 2.6, `attackOVR=${baseAtk.toFixed(1)}`);
ok(baseDef === 8 + 1.8 + 2.0 + 1.0, `defenseOVR=${baseDef.toFixed(1)}`);

console.log('\n[부상] 실효 하락 → 만료 복구');
Club.club.matchday = 10;
Club.addEffect({ type: 'injury', pos: 'fw', dLevel: -2, until: 13, tone: 'bad' });
ok(Club.attackOVR() < baseAtk, `공격 하락 ${baseAtk.toFixed(1)}→${Club.attackOVR().toFixed(1)}`);
Club.club.matchday = 13;
Club.tickEffects();
ok(Club.attackOVR() === baseAtk && Club.club.effects.length === 0, '만료 후 원상 복구');

console.log('\n[미션] 생산 로직 1회성 보상');
Club.hardReset();
const cash = Club.club.cash;
ok(checkMission({ result: 'w' })?.reward === 70 && Club.club.cash === cash + 70, '첫 승리 보상 +70');
ok(checkMission({ result: 'w' }) === null, '재달성 보상 없음');

console.log('\n[cadence] 3~5경기 경계');
ok(!shouldTriggerEvent(2, 0), '2경기 이내 미발생');
ok(shouldTriggerEvent(5, 0.99), '5경기째 강제 발생');
ok(shouldTriggerEvent(3, 0.2) && !shouldTriggerEvent(3, 0.9), '3경기부터 확률 발생');

console.log(fail === 0 ? '\n✅ 변주 수식 전 불변식 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
