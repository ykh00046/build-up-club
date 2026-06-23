// 수행기반 스코어 + 철학 분기 회귀.
import * as Club from '../js/career/club.js';
import { matchSetup, resolveScoreline } from '../js/career/mods.js';
import * as Ph from '../js/career/philosophy.js';

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
Ph.choosePhilosophy('gegen'); Club.club.philoPoints = 1; Ph.unlockNextPerk(); // geg1 pressRelief
const relieved = matchSetup(180);
const order = { mid: 0, high: 1, vhigh: 2 };
ok(order[relieved.intensity] <= order[base.intensity], `압박 강도 완화: ${base.intensity} → ${relieved.intensity}`);

console.log('\n[5] 승격 시 철학 포인트 지급');
Club.hardReset();
const p0 = Club.club.philoPoints;
Club.club.points = Club.division().promotePts; // 승격 임박
const prog = Club.addPoints('w');
ok((prog === 'promote' || prog === 'reach-top') && Club.club.philoPoints === p0 + 1, `승격(${prog}) → 철학 포인트 +1`);

console.log('\n[6] 무결성');
ok(Number.isFinite(withPhi.avg) && Number.isFinite(noPhi.avg), 'NaN 없음');

console.log(fail === 0 ? '\n✅ 수행 스코어·철학 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
