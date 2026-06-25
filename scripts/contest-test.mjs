// 공간 지향 패스 Inc.1 — 착지 경합: 이진 실패를 루즈볼(세컨볼)로 완화.
// resolveLanding은 클로저 내부라, 관측 가능한 into_space 결과 분포로 검증한다.
import { getScenario } from '../js/data/scenarios.js';
import { createEngine } from '../js/engine/engine.js';

let clean = 0, loose = 0, opp = 0;
for (let seed = 1; seed <= 2000; seed++) {
  const e = createEngine(getScenario('A1'), seed, { intensityOverride: 'high' });
  const s = e.state;
  const cands = s.players.filter((p) => p.side === 'us' && p.id !== s.holderId && p.role !== 'GK');
  const mate = cands.sort((a, b) => b.x - a.x)[1] || cands[0];
  if (!mate) continue;
  const before = s.facts.secondBalls;
  const r = e.dispatch('into_space', mate.id);
  if (!r || r.rejected) continue;
  if (r.ok === false) opp++;
  else if (s.facts.secondBalls > before) loose++;
  else clean++;
}
const t = clean + loose + opp;
const retain = (clean + loose) / t;

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };
console.log('=== 착지 경합 (into_space, n=' + t + ') ===\n');
console.log(`  깨끗 ${(clean / t * 100).toFixed(0)}% | 루즈볼 ${(loose / t * 100).toFixed(0)}% | 탈취 ${(opp / t * 100).toFixed(0)}%\n`);

ok(loose > 0, '루즈볼(세컨볼)이 발생 — 가혹한 이진 실패 완화');
ok(opp > 0, '탈취(턴오버)도 여전히 발생 — 실패 위험 보존(트리비얼 아님)');
ok(retain > 0.5 && retain < 0.88, `보유 유지율 ${(retain * 100).toFixed(0)}% — 완화되되 과하지 않음(50~88%)`);
ok(clean > 0, '깨끗한 성공 경로 유지');

console.log(fail === 0 ? '\n✅ 착지 경합 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
