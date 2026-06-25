// 공 보유 시 느림(물리): carryRange — 페이스·볼 컨트롤 비례, 오프볼보다 짧음.
import { carryRange } from '../js/data/pitch.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 운반 물리 (carryRange) ===\n');

const slow = carryRange({ pace: 0.4, carry: 0.5 });
const mid = carryRange({ pace: 0.6, pressResistance: 0.7 });
const fast = carryRange({ pace: 0.85, carry: 0.7 });
const winger = carryRange({ pace: 0.95 });

ok(slow < mid && mid < fast, `페이스↑ → 운반 거리↑ (${slow.toFixed(1)} < ${mid.toFixed(1)} < ${fast.toFixed(1)})`);
ok(slow >= 5 && winger <= 10, `운반 거리 5~10m 범위 (느림 ${slow.toFixed(1)} ~ 빠름 ${winger.toFixed(1)})`);
// 공 보유자는 오프볼 런(~12-14m)·구조 이동(10m)보다 느려야 한다.
ok(fast <= 10, `최고 운반(${fast.toFixed(1)}m) ≤ 구조 이동 캡(10m) — 공 보유자가 가장 느림`);
ok(carryRange({}) >= 5 && carryRange({}) <= 10, '트레잇 없음 → 기본값 안전(5~10m)');
// carry 우선, 없으면 pressResistance 폴백
ok(carryRange({ pace: 0.6, carry: 0.9 }) > carryRange({ pace: 0.6, carry: 0.3 }), '볼 컨트롤(carry)↑ → 운반 거리↑');

console.log(fail === 0 ? '\n✅ 운반 물리 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
