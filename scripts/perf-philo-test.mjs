// 수행기반 스코어 + 철학 분기 회귀.
import * as Club from '../js/career/club.js';
import { matchSetup, resolveScoreline } from '../js/career/mods.js';
import * as Ph from '../js/career/philosophy.js';
import { updateIdentityStreak } from '../js/career/identity.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };
function avgGoals(perf, setup, n = 4000, pmods) {
  let s = 0, max = 0; for (let i = 0; i < n; i++) { const r = resolveScoreline(perf, setup, Math.random, pmods); s += r.ourGoals; max = Math.max(max, r.ourGoals); }
  return { avg: s / n, max };
}

console.log('=== 수행기반 스코어 + 철학 ===\n');
Club.hardReset();
// 강한 팀 셋업
for (const p of Club.POSITIONS) Club.club.levels[p.key] = 16;
const setup = matchSetup(120);

console.log('[1] 수행 품질 → 다득점 단조');
const plain = avgGoals({ tone: 'goal' }, setup);
const rich  = avgGoals({ tone: 'goal', baits: 3, linesBroken: 3, switches: 2, runs: 2, windowsUsed: 2, xg: 0.7 }, setup);
ok(rich.avg > plain.avg, `리치 빌드업 평균득점 > 단순 (${rich.avg.toFixed(2)} > ${plain.avg.toFixed(2)})`);
ok(rich.max >= 2, `리치 빌드업으로 2골+ 가능 (max=${rich.max})  ← '2골 이상' 미션 달성 가능`);
ok(plain.avg >= 1 && plain.max >= 1, `단순 골은 최소 1득점 (avg=${plain.avg.toFixed(2)})`);

console.log('\n[2] tone별 스코어 성향');
const near = avgGoals({ tone: 'near', xg: 0.3 }, setup);
const failS = resolveScoreline({ tone: 'fail' }, setup, () => 0.99); // 거의 실점 안 나게
ok(near.avg < plain.avg, `near 평균득점 < goal (${near.avg.toFixed(2)} < ${plain.avg.toFixed(2)})`);
ok(resolveScoreline({ tone: 'fail' }, setup, Math.random).ourGoals === 0, 'fail은 우리 득점 0');

console.log('\n[3] 철학 퍼크 반영');
Club.hardReset();
for (const p of Club.POSITIONS) Club.club.levels[p.key] = 16;
Ph.choosePhilosophy('positional');
Club.club.philoPoints = 3;
Ph.unlockNextPerk(); Ph.unlockNextPerk(); // pos1, pos2 (execMul·secondGoalBonus)
const pm = Ph.philoMods();
ok(pm.secondGoalBonus > 0 && pm.execMul > 1, `포지셔널 퍼크 집계: execMul=${pm.execMul.toFixed(2)}, 2nd+${pm.secondGoalBonus}`);
const setup2 = matchSetup(120);
const withPhi = avgGoals({ tone: 'goal', baits: 2, linesBroken: 2, xg: 0.5 }, setup2, 4000, pm);
const noPhi   = avgGoals({ tone: 'goal', baits: 2, linesBroken: 2, xg: 0.5 }, setup2, 4000, Ph.NEUTRAL_MODS);
ok(withPhi.avg > noPhi.avg, `철학 적용 시 다득점↑ (${withPhi.avg.toFixed(2)} > ${noPhi.avg.toFixed(2)})`);

console.log('\n[4] 게겐 pressRelief → 압박 완화');
Club.hardReset();
for (const p of Club.POSITIONS) Club.club.levels[p.key] = 10;
const base = matchSetup(180);
Ph.choosePhilosophy('pressproof'); Club.club.philoPoints = 1; Ph.unlockNextPerk(); // geg1 pressRelief
const relieved = matchSetup(180);
const order = { mid: 0, high: 1, vhigh: 2 };
ok(order[relieved.intensity] <= order[base.intensity], `압박 강도 완화: ${base.intensity} → ${relieved.intensity}`);

console.log('\n[4b] 레거시 철학 id 마이그레이션');
const migrated = Club.normalizeState({ philosophy: 'counter', perks: { cnt1: true } });
ok(migrated.philosophy === 'direct', `레거시 philosophy counter → direct`);
const migrated2 = Club.normalizeState({ philosophy: 'gegen' });
ok(migrated2.philosophy === 'pressproof', `레거시 philosophy gegen → pressproof`);
ok(migrated.perks.cnt1 === true, 'perks key(cnt1)는 마이그레이션 후에도 보존');
ok(Ph.getPhilosophy('direct') !== null && Ph.getPhilosophy('counter') === null, '새 id direct 조회 가능, 레거시 counter 는 미존재');
ok(Ph.getPhilosophy('pressproof') !== null && Ph.getPhilosophy('gegen') === null, '새 id pressproof 조회 가능, 레거시 gegen 은 미존재');
ok(['positional', 'direct', 'pressproof', 'wing'].every((id) => Ph.getPhilosophy(id) !== null), '철학 4종 id 가 identityXp key 와 일치');

console.log('\n[5] 승격 시 철학 포인트 지급');
Club.hardReset();
const p0 = Club.club.philoPoints;
Club.club.points = Club.division().promotePts; // 승격 임박
const prog = Club.addPoints('w');
ok((prog === 'promote' || prog === 'reach-top') && Club.club.philoPoints === p0 + 1, `승격(${prog}) → 철학 포인트 +1`);

console.log('\n[6] 무결성');
ok(Number.isFinite(withPhi.avg) && Number.isFinite(noPhi.avg), 'NaN 없음');

console.log('\n[7] Lv4 고유 퍽(T4) — 해금 게이트 + mod 집계');
Club.hardReset();
// 각 철학에 T4 퍽 1개씩 존재
for (const ph of Ph.PHILOSOPHIES) {
  const t4 = ph.perks.filter((p) => p.tier === 4);
  ok(t4.length === 1, `${ph.id}: T4 고유 퍽 1개 ("${t4[0]?.name}")`);
}
// 게이트: T1~T3 해금 후 T4 시도. 정체성 레벨 < 4면 해금 불가.
Club.hardReset();
Ph.choosePhilosophy('positional');
Club.club.philoPoints = 5;
Ph.unlockNextPerk(); Ph.unlockNextPerk(); Ph.unlockNextPerk(); // pos1,2,3 (T1~T3)
ok(Ph.nextPerkIndex() === 3, 'T1~T3 해금 후 다음 = T4(idx 3)');
ok(Club.club.philoPoints === 2, 'T1~T3 해금 후 포인트 5→2');
// 정체성 레벨 낮음 → T4 해금 실패
Club.club.identityXp.positional = 10; // Lv2
ok(Ph.unlockNextPerk() === false, '정체성 Lv2 → T4 해금 거부');
ok(Club.club.perks.pos4 !== true, 'T4 미해금 상태 유지');
ok(Club.club.philoPoints === 2, 'T4 거부 시 포인트 미소모(2 유지)');
// 정체성 Lv4 도달 → T4 해금 성공
Club.club.identityXp.positional = 40; // Lv4
ok(Ph.unlockNextPerk() === true, '정체성 Lv4 → T4 해금 성공');
ok(Club.club.perks.pos4 === true, 'T4 해금 기록');
ok(Club.club.philoPoints === 1, 'T4 해금 시 포인트 1 소모(2→1)');
// philoMods 가 T4 mod(execMul 1.15) 집계
const pm4 = Ph.philoMods();
ok(pm4.execMul > 1.35, `T4 포함 execMul 집계 (${pm4.execMul.toFixed(2)} > 1.35 — T1~T3+T4 곱연산)`);
// 다른 철학 T4 도 확인(direct xgMul)
Club.hardReset();
Ph.choosePhilosophy('direct');
Club.club.philoPoints = 5;
Club.club.identityXp.direct = 40;
Ph.unlockNextPerk(); Ph.unlockNextPerk(); Ph.unlockNextPerk(); Ph.unlockNextPerk();
ok(Club.club.perks.cnt4 === true, 'direct T4(cnt4) 해금');
ok(Club.club.philoPoints === 1, 'direct T1~T4 해금 후 포인트 5→1');
const pmDirect = Ph.philoMods();
ok(pmDirect.xgMul > 1.08, `direct T4 포함 xgMul 집계 (${pmDirect.xgMul.toFixed(2)} > 1.08)`);

console.log('\n[8] 정체성 전환 비용 — XP 차감 + streak 리셋');
Club.hardReset();
Ph.choosePhilosophy('positional');
Club.club.identityXp.positional = 30;
updateIdentityStreak('positional'); updateIdentityStreak('positional'); // streak count=2
ok(Club.club.identityXp.positional === 30, '전환 전 positional XP=30');
// 최초/같은 id 재선택 → 비용 없음
Ph.choosePhilosophy('positional');
ok(Club.club.identityXp.positional === 30, '같은 id 재선택 → XP 변화 없음 (30)');
// 다른 id 전환 → 이전 XP 20% 차감 (30 → 24) + streak 리셋
Ph.choosePhilosophy('direct');
ok(Club.club.identityXp.positional === 24, `전환 시 이전 positional XP 20% 차감 (30→${Club.club.identityXp.positional})`);
ok(Club.club.philosophy === 'direct', 'philosophy 가 direct 로 전환');
ok(Club.club.identityStreak.count === 0 && Club.club.identityStreak.id === null, '전환 시 identityStreak 리셋 (count=0)');
// direct XP 는 영향 없음 (전환 전 0 유지)
ok((Club.club.identityXp.direct ?? 0) === 0, '새 정체성 direct XP 는 영향 없음 (0)');
// 한 번 더 전환 (direct → wing) → direct 가 0 이라 차감 영향 없지만 streak 는 리셋
Ph.choosePhilosophy('direct'); // direct XP 올린 뒤
Club.club.identityXp.direct = 20;
updateIdentityStreak('direct');
Ph.choosePhilosophy('wing');
ok(Club.club.identityXp.direct === 16, `2차 전환 direct XP 20% 차감 (20→${Club.club.identityXp.direct})`);
ok(Club.club.philosophy === 'wing', 'philosophy 가 wing 로 전환');
// perks 보존 확인 — 기존 해금 퍼크 유지
Club.hardReset();
Ph.choosePhilosophy('positional');
Club.club.philoPoints = 1; Ph.unlockNextPerk(); // pos1 해금
Ph.choosePhilosophy('direct');
ok(Club.club.perks.pos1 === true, '전환 후에도 이전 철학 퍼크(pos1) 보존');

console.log(fail === 0 ? '\n✅ 수행 스코어·철학 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
