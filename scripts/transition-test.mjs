// E1(완성): 카운터프레스 5초 전환 창 (엔진). 오픈 플레이 상실 시 되찾기 기회.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 카운터프레스 전환 창 (E1) ===\n');

// 턴오버를 유발해 전환 창이 열린 엔진을 반환(시드부터 브루트포스).
function openTransition(startSeed) {
  for (let seed = startSeed; seed < startSeed + 600; seed++) {
    const e = createEngine(getScenario('A1'), seed, { intensityOverride: 'vhigh' });
    for (let step = 0; step < 8; step++) {
      if (e.state.transition) return e;
      if (e.state.status !== 'live') break;
      const mate = e.state.players.filter((p) => p.side === 'us' && p.id !== e.state.holderId && p.role !== 'GK').sort((a, b) => b.x - a.x)[0];
      if (mate) e.dispatch('pass_space', null, { x: Math.min(mate.x + 8, 100), y: mate.y });
      for (let i = 0; i < 70 && e.busy; i++) e.update(16);
      if (e.state.transition) return e;
    }
  }
  return null;
}

// 1) 구조: 상실 시 즉시 종료하지 않고 결정 창을 띄운다
const e1 = openTransition(1);
ok(!!e1, '턴오버 시 전환 창이 열린다');
if (e1) {
  const t = e1.state.transition, md = e1.state.matchDecision;
  ok(e1.state.status === 'live', '전환 중 status는 live(즉시 종료 안 함)');
  ok(md && md.id === 'transition' && md.choices.length === 2, 'matchDecision으로 카운터프레스/후퇴 노출');
  ok(md.choices.some((c) => c.id === 'cp_press') && md.choices.some((c) => c.id === 'cp_retreat'), '선택지 cp_press/cp_retreat');
  ok(t.regainP >= 0.1 && t.regainP <= 0.7, `회복 확률 0.1~0.7 범위 (${(t.regainP * 100) | 0}%)`);
  ok(e1.state.transitionUsed === true, 'transitionUsed 설정(공격당 1회)');
  const other = e1.state.players.find((p) => p.side === 'us' && p.id !== e1.state.holderId);
  ok(e1.dispatch('to_feet', other?.id).rejected, '전환 중 일반 액션은 거부');
}

// 2) 후퇴 → 종료
const e2 = openTransition(50);
if (e2) { const r = e2.chooseSituationOption('cp_retreat'); ok(r.ok && e2.state.status === 'over' && !e2.state.transition, '후퇴 → 공격 종료'); }

// 3) 결정 창은 턴제 — 시간이 흘러도 자동 소멸하지 않고 입력을 기다린다.
//    (구 5초 자동 후퇴는 백그라운드 탭 dtMs 한 방에 창이 증발 + 숙고형 플레이어가
//     자동 결정을 반복 경험하는 문제로 제거, 2026-07.)
const e3 = openTransition(120);
if (e3) {
  e3.update(60000);   // 1분 방치
  ok(e3.state.status === 'live' && !!e3.state.transition, '결정 창은 시간 경과에도 유지(턴제)');
  const r3 = e3.chooseSituationOption('cp_retreat');
  ok(r3.ok && e3.state.status === 'over', '유지된 창도 명시적 선택으로 정상 해소');
}

// 4) 카운터프레스 — 성공/실패 양쪽 관측 + 상태 정합 (시드 다양화)
let rec = 0, failp = 0, stateOk = true;
for (let s = 1; s <= 120; s++) {
  const e = openTransition(s * 7);
  if (!e) continue;
  const before = e.state.facts.counterpressWins;
  const r = e.chooseSituationOption('cp_press');
  if (r.recovered) { rec++; if (!(e.state.status === 'live' && e.state.facts.counterpressWins === before + 1)) stateOk = false; }
  else { failp++; if (e.state.status !== 'over') stateOk = false; }
}
ok(rec > 0, `카운터프레스 성공 관측 (${rec}건)`);
ok(failp > 0, `카운터프레스 실패 관측 (${failp}건)`);
ok(stateOk, '성공→공격 계속·counterpressWins++ / 실패→종료, 상태 정합');

console.log(fail === 0 ? '\n✅ 카운터프레스 전환 창 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
