// E4: 게임스테이트 — 모멘텀(다득점)·피로(늦은 실점). 기본값 중립(career-sim 불변).
import { resolveScoreline } from '../js/career/mods.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 게임스테이트 (E4) ===\n');

const NM = { execMul: 1, xgMul: 1, concedeMul: 1, secondGoalBonus: 0, failConcedeRelief: 0 };
const setup = { atk: 130, def: 110, oppOVR: 220, trainingScore: {} };
function avg(perf, key, n = 8000) {
  let s = 0, seed = 3;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) s += resolveScoreline(perf, setup, rng, NM)[key];
  return s / n;
}

// 1) 모멘텀 → 다득점(우리 골) 단조 증가
const goalPerf = (m) => ({ tone: 'goal', xg: 0.4, baits: 1, linesBroken: 2, momentum: m, fatigue: 0 });
const gLow = avg(goalPerf(20), 'ourGoals');
const gMid = avg(goalPerf(50), 'ourGoals');
const gHigh = avg(goalPerf(85), 'ourGoals');
ok(gLow < gMid && gMid < gHigh, `모멘텀↑ → 우리 득점↑ (${gLow.toFixed(3)} < ${gMid.toFixed(3)} < ${gHigh.toFixed(3)})`);

// 2) 피로 → 늦은 실점 증가
const concPerf = (ft) => ({ tone: 'near', xg: 0.2, linesBroken: 1, momentum: 50, fatigue: ft });
const cLow = avg(concPerf(0), 'oppGoals');
const cHigh = avg(concPerf(90), 'oppGoals');
ok(cHigh > cLow, `피로↑ → 늦은 실점↑ (${cLow.toFixed(3)} → ${cHigh.toFixed(3)})`);

// 3) 모멘텀 50·피로 0 = 중립 (필드 생략과 동일) → career-sim 불변 보장
function seq(perf, n = 200) {
  const out = []; let seed = 99;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) { const r = resolveScoreline(perf, setup, rng, NM); out.push(r.ourGoals + ':' + r.oppGoals); }
  return out.join(',');
}
const neutral = seq({ tone: 'goal', xg: 0.4, baits: 1, linesBroken: 2, momentum: 50, fatigue: 0 });
const omitted = seq({ tone: 'goal', xg: 0.4, baits: 1, linesBroken: 2 });
ok(neutral === omitted, '모멘텀50·피로0은 필드 생략과 완전 동일(rng 시퀀스 불변)');

console.log(fail === 0 ? '\n✅ 게임스테이트 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
