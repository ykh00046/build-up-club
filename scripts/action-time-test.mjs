// 시간 개념(dt): 짧은 패스 = 짧은 순간 = 양 팀이 조금만 움직임,
// 긴 패스 = 긴 순간 = 많이 움직임. 짧은 패스 연쇄로 원투·써드맨이 자연 발생.
import { getScenario } from '../js/data/scenarios.js';
import { createEngine } from '../js/engine/engine.js';

const snap = (s) => Object.fromEntries(s.players.map((p) => [p.id, { x: p.x, y: p.y }]));
const settle = (e) => { for (let i = 0; i < 120 && e.busy; i++) e.update(16); };
function oppMove(before, s) {
  let sum = 0, n = 0;
  for (const p of s.players) { if (p.side !== 'opp' || p.line === 'gk') continue; const b = before[p.id]; sum += Math.hypot(p.x - b.x, p.y - b.y); n++; }
  return sum / n;
}

let shortM = 0, longM = 0, ns = 0, nl = 0;
for (let seed = 1; seed <= 300; seed++) {
  let e = createEngine(getScenario('A1'), seed, { intensityOverride: 'high' });
  let s = e.state, h = s.players.find((p) => p.id === s.holderId);
  const near = s.players.filter((p) => p.side === 'us' && p.id !== s.holderId && p.role !== 'GK')
    .map((m) => ({ m, d: Math.hypot(m.x - h.x, m.y - h.y) })).sort((a, b) => a.d - b.d)[0];
  if (near) { const b = snap(s); const r = e.dispatch('to_feet', near.m.id); if (r && r.ok !== false) { settle(e); shortM += oppMove(b, e.state); ns++; } }
  e = createEngine(getScenario('A1'), seed, { intensityOverride: 'high' });
  s = e.state; h = s.players.find((p) => p.id === s.holderId);
  const b = snap(s); const r = e.dispatch('pass_space', null, { x: Math.min(h.x + 38, 100), y: h.y });
  if (r && r.ok !== false) { settle(e); longM += oppMove(b, e.state); nl++; }
}
const ratio = (shortM / ns) / (longM / nl);

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };
console.log('=== 행동 시간(dt) — 짧은 패스는 짧은 순간 ===\n');
console.log(`  짧은 패스 상대 이동 ${(shortM / ns).toFixed(2)}m | 긴 패스 ${(longM / nl).toFixed(2)}m | 비율 ${ratio.toFixed(2)}\n`);
ok(ratio < 0.85, `짧은 패스가 상대를 덜 움직임 (비율 ${ratio.toFixed(2)} < 0.85)`);
ok(shortM / ns > 0.5, '짧은 패스도 약간은 움직임(정지 아님)');
ok(longM / nl > shortM / ns, '긴 패스가 더 많이 움직임');

console.log(fail === 0 ? '\n✅ 행동 시간 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
