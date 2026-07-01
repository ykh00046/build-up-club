// 상대 빌드업 다양성 정책 회귀 — docs/symmetric-duel-design.md.
// import 없는 순수 모듈만 쓰므로 샌드박스 실행 가능. 성향별로 best/gamble/trap 선택이
// 달라지는지(다양성), riskCap 이 지켜지는지, 시드 고정 시 결정적인지 고정한다.

import { chooseOppBuild, OPP_DISPOSITIONS, isDisposition } from '../js/engine/opp-build-policy.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };

// 결정적 시드 rng (LCG) — 분포를 재현 가능하게.
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function makeRead() {
  const best = { target: { id: 'b' }, risk: 0.18, safety: 0.82, reward: 0.50, net: 0.40, progress: 8 };
  const gamble = { target: { id: 'g' }, risk: 0.45, safety: 0.55, reward: 0.62, net: 0.30, progress: 16 };
  const trap = { target: { id: 't' }, risk: 0.70, safety: 0.30, reward: 0.50, net: 0.10, progress: 20 };
  return { possession: 'opp', best, gamble, trap, candidates: [best, gamble, trap] };
}

function bestRate(disp, seed, n = 600) {
  const rng = lcg(seed); let b = 0;
  for (let i = 0; i < n; i++) if (chooseOppBuild(makeRead(), disp, rng).target.id === 'b') b++;
  return b / n;
}

console.log('=== 상대 빌드업 다양성 정책 테스트 ===\n');

// [1] 기본(성향 미지정) = 결정적 best — 플레이 경로 안전
ok(chooseOppBuild(makeRead()).target.id === 'b', '성향 미지정 → 결정적 best');
ok(chooseOppBuild(makeRead(), null).target.id === 'b', 'null 성향 → best');
ok(chooseOppBuild(makeRead(), 'typo').target.id === 'b', '알 수 없는 성향 → 안전하게 best');
ok(isDisposition('aggressive') && !isDisposition('nope'), 'isDisposition 유효성');

// [2] 시드 고정 → 결정적
const a1 = chooseOppBuild(makeRead(), 'aggressive', lcg(42));
const a2 = chooseOppBuild(makeRead(), 'aggressive', lcg(42));
ok(a1.target.id === a2.target.id, '같은 시드 → 같은 선택(결정적)');

// [3] riskCap — safe(0.5)는 trap(risk 0.7)을 절대 안 고름
const safeSeen = new Set(); const rs = lcg(7);
for (let i = 0; i < 400; i++) safeSeen.add(chooseOppBuild(makeRead(), 'safe', rs).target.id);
ok(!safeSeen.has('t'), 'safe 성향은 riskCap 초과(trap) 제외');

// [4] 다양성 — aggressive 는 safe 보다 best 비중이 낮고, 여러 루트를 쓴다
const safeBest = bestRate('safe', 1);
const aggBest = bestRate('aggressive', 1);
ok(safeBest > aggBest, `aggressive(${aggBest.toFixed(2)}) < safe(${safeBest.toFixed(2)}) — 다양성↑`);
ok(safeBest > 0.8, 'safe 는 대부분 best');
const aggSeen = new Set(); const ra = lcg(9);
for (let i = 0; i < 200; i++) aggSeen.add(chooseOppBuild(makeRead(), 'aggressive', ra).target.id);
ok(aggSeen.size >= 2, `aggressive 는 여러 루트 사용 (${[...aggSeen].join(',')})`);

// [5] aggressive 는 trap(고위험)도 가끔 사용 (riskCap 1.0)
ok(aggSeen.has('g'), 'aggressive 는 gamble 사용');

// [6] 가드
ok(chooseOppBuild(null) === null, 'null read → null');
ok(chooseOppBuild({ candidates: [] }, 'safe') === null, '후보 없음 → null');

// [7] 모든 정의된 성향이 유효 후보를 반환
for (const disp of Object.keys(OPP_DISPOSITIONS)) {
  const c = chooseOppBuild(makeRead(), disp, lcg(3));
  ok(c && ['b', 'g', 't'].includes(c.target.id), `성향 '${disp}' → 유효 후보`);
}

console.log(fail === 0 ? '\n상대 빌드업 다양성 정책 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
