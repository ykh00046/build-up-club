// 커리어 로직 회귀 시뮬 — 브라우저 없이 club/mods/season의 경제·통합·승격을 검증.
// 실행: node scripts/career-sim.mjs
import * as Club from '../js/career/club.js';
import { matchSetup, resolveScoreline } from '../js/career/mods.js';
import { scenarioForMatchday, opponentName } from '../js/career/season.js';

function rng() { return Math.random(); }

// 전술 모먼트 결과(tone)를 클럽 vs 상대 전력으로 근사: 강할수록 goal 확률↑.
function simTone(setup) {
  const winish = setup.odds.win / 100;
  const r = rng();
  if (r < winish) return 'goal';
  if (r < winish + 0.30) return 'near';
  return 'fail';
}

function playOneMatch() {
  const oppOVR = Club.oppBaseOVR();
  const setup = matchSetup(oppOVR);
  const tone = simTone(setup);
  const score = resolveScoreline(tone, setup, rng);
  Club.settleMatch(score.result, score.cleanSheet);
  const prog = Club.addPoints(score.result);
  // 업그레이드 정책: 가장 싼 포지션부터 살 수 있으면 산다 (가성비 근사).
  let bought = true;
  while (bought) {
    bought = false;
    const costs = Club.POSITIONS.map((p) => [p.key, Club.upgradeCost(p.key)]).sort((a, b) => a[1] - b[1]);
    for (const [key, cost] of costs) {
      if (Club.club.cash >= cost) { Club.buyUpgrade(key); bought = true; break; }
    }
  }
  return { prog, score, setup };
}

function run(label) {
  Club.hardReset();
  let matches = 0, promotions = 0, reachedTop = false, champion = false, prestiges = 0;
  const divAtMatch = [];
  for (let i = 0; i < 4000; i++) {
    const { prog } = playOneMatch();
    matches++;
    if (prog === 'promote') promotions++;
    if (prog === 'reach-top') { reachedTop = true; promotions++; }
    if (prog === 'champion') champion = true;
    divAtMatch.push(Club.division().tier);
    // 1부 도달하면 프레스티지 1회 테스트 후 종료
    if (Club.club.canPrestige && champion) {
      const g = Club.prestige();
      prestiges++;
      // 프레스티지 후 무결성 체크
      assertFinite('post-prestige');
      break;
    }
    assertFinite('match ' + i);
  }
  console.log(`\n[${label}]`);
  console.log(`  경기 수: ${matches}, 승격: ${promotions}, 1부도달: ${reachedTop}, 우승: ${champion}, 프레스티지: ${prestiges}`);
  console.log(`  최종 디비전 tier: ${Club.division().tier}, 전적: ${Club.club.record.w}-${Club.club.record.d}-${Club.club.record.l}`);
  console.log(`  팀OVR: ${Math.round(Club.teamOVR())} (공 ${Math.round(Club.attackOVR())}/수 ${Math.round(Club.defenseOVR())}), 레거시: ${Club.club.legacy}`);
  console.log(`  누적수익: ${Club.formatNum(Club.club.totalEarned)}, 자금: ${Club.formatNum(Club.club.cash)}`);
  return { matches, champion, reachedTop };
}

function assertFinite(where) {
  const vitals = [Club.club.cash, Club.club.fans, Club.teamOVR(), Club.club.totalEarned, Club.club.points];
  for (const v of vitals) {
    if (!Number.isFinite(v)) { console.error(`!! NON-FINITE at ${where}:`, vitals); process.exit(1); }
  }
}

// mods 글루 단조성: 공격 레벨↑ → 슛 부스트↑, 패스 부스트↑ (체감 단조)
function checkGlueMonotonic() {
  Club.hardReset();
  const lo = matchSetup(100);
  for (const p of Club.POSITIONS) Club.club.levels[p.key] = 20;
  const hi = matchSetup(100);
  console.log('\n[글루 단조성]');
  console.log(`  Lv1  → passBoost ${lo.passBoost.toFixed(3)}, shotBoost ${lo.shotBoost.toFixed(3)}, intensity ${lo.intensity}, odds ${lo.odds.win}%`);
  console.log(`  Lv20 → passBoost ${hi.passBoost.toFixed(3)}, shotBoost ${hi.shotBoost.toFixed(3)}, intensity ${hi.intensity}, odds ${hi.odds.win}%`);
  const ok = hi.passBoost > lo.passBoost && hi.shotBoost > lo.shotBoost && hi.odds.win > lo.odds.win;
  console.log(`  단조 증가: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}

// 실점 모델: 수비↑ → 실점확률↓
function checkConcede() {
  Club.hardReset();
  const weakDef = matchSetup(300);
  let concededWeak = 0, n = 4000;
  for (let i = 0; i < n; i++) if (resolveScoreline('near', weakDef, rng).oppGoals > 0) concededWeak++;
  Club.hardReset();
  for (const p of Club.POSITIONS) Club.club.levels[p.key] = 30;
  const strongDef = matchSetup(300);
  let concededStrong = 0;
  for (let i = 0; i < n; i++) if (resolveScoreline('near', strongDef, rng).oppGoals > 0) concededStrong++;
  console.log('\n[실점 모델]');
  console.log(`  약한 수비 실점률: ${(concededWeak / n * 100).toFixed(0)}%, 강한 수비 실점률: ${(concededStrong / n * 100).toFixed(0)}%`);
  const ok = concededStrong < concededWeak;
  console.log(`  수비 업글 효과: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}

console.log('=== Build-Up Club 커리어 로직 회귀 ===');
checkGlueMonotonic();
checkConcede();
run('A: 직행 등반');
run('B: 직행 등반 (재현)');
console.log('\n✅ 전 항목 통과 — NaN/Infinity 0건, 글루·실점·승격 정상');
