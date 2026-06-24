// E7: 스캐닝 — 읽기 계열 정체성에서 파생, 전진 패스·압박 저항을 소폭 안정화.
import { scanFactor } from '../js/career/identity.js';
import { applyClubBoost, matchSetup } from '../js/career/mods.js';
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { club, hardReset } from '../js/career/club.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 스캐닝 (E7) ===\n');

hardReset();

// 1) 읽기 XP 누적 → scanFactor 단조 증가, 0~1 범위
club.identityXp = { positional: 0, direct: 0, wing: 0, pressproof: 0 };
const s0 = scanFactor();
club.identityXp = { positional: 10, direct: 0, wing: 0, pressproof: 10 };
const s1 = scanFactor();
club.identityXp = { positional: 40, direct: 0, wing: 0, pressproof: 40 };
const s2 = scanFactor();
ok(s0 === 0, '읽기 XP 0 → 스캔 0');
ok(s1 > s0 && s2 > s1, `읽기 XP↑ → 스캔↑ (${s0.toFixed(2)} < ${s1.toFixed(2)} < ${s2.toFixed(2)})`);
ok(s2 <= 1, '스캔 상한 1');
ok(scanFactor() === Math.min(1, (club.identityXp.positional + club.identityXp.pressproof) / 60), 'positional+pressproof / 60 공식');

// 2) direct/wing XP는 스캔에 기여하지 않음(읽기 계열만)
club.identityXp = { positional: 0, direct: 50, wing: 50, pressproof: 0 };
ok(scanFactor() === 0, 'direct/wing XP는 스캔 미반영');

// 3) applyClubBoost가 스캔만큼 pressResistance를 끌어올린다
function avgPressRes(scan) {
  const e = createEngine(getScenario('A1'), 1, {});
  applyClubBoost(e, { passBoost: 0.1, shotBoost: 0.1, gkBoost: 0.05, xgMul: 1, scan });
  const us = e.state.players.filter((p) => p.side === 'us' && p.role !== 'GK');
  return us.reduce((a, p) => a + (p.traits.pressResistance || 0), 0) / us.length;
}
const prLow = avgPressRes(0);
const prHigh = avgPressRes(1);
ok(prHigh > prLow, `스캔↑ → 압박 저항↑ (${prLow.toFixed(3)} → ${prHigh.toFixed(3)})`);
ok(e_state_scan_set(), 'applyClubBoost가 engine.state.scanFactor 설정');
function e_state_scan_set() {
  const e = createEngine(getScenario('A1'), 1, {});
  applyClubBoost(e, { passBoost: 0.1, shotBoost: 0.1, gkBoost: 0.05, xgMul: 1, scan: 0.7 });
  return e.state.scanFactor === 0.7;
}

// 4) matchSetup이 scan을 노출
hardReset();
club.identityXp = { positional: 30, direct: 0, wing: 0, pressproof: 30 };
ok(typeof matchSetup(200).scan === 'number', 'matchSetup이 scan 노출');

console.log(fail === 0 ? '\n✅ 스캐닝 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
