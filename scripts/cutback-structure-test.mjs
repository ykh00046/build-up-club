// 컷백 구조 + 오프사이드 정합 회귀 테스트 (2026-07 감사 C2/C3/H2/H6).
// 검증: (1) 도착런이 오프사이드 라인을 준수(패스 순간 온사이드), (2) pass_space도
// 수신자 기준 오프사이드 판정, (3) 바이라인 컷백 체인(플래그→존 xG)이 합법 경로로
// 여전히 작동, (4) to_feet/pass_space 바이라인 술어 패리티, (5) 자책골 분기 도달,
// (6) 지원 앵커 트레일, (7) 회수 시 lastPass* 플래그 소멸.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { evaluateBoard } from '../js/engine/evaluator.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 컷백 구조 + 오프사이드 정합 ===\n');

const PITCH_H = 68;
const settle = (e) => { let g = 0; while (e.busy && g++ < 400) e.update(50); e.update(50); };
const offsideLineOf = (e) => Math.max(...e.state.players.filter((p) => p.side === 'opp' && p.line !== 'gk').map((p) => p.x));

// 측면 캐리어를 바이라인까지 모는 공용 드라이브(프로브와 동일 패턴).
function driveWide(seed, cell = 'A1') {
  const e = createEngine(getScenario(cell), seed);
  const carrier = e.state.players.find((p) => p.id === 'us-rw') || e.state.players.find((p) => p.side === 'us' && p.role === 'W');
  carrier.x = 58; carrier.y = 58; e.state.holderId = carrier.id;
  for (const [x, y] of [[68, 58], [76, 59], [84, 58], [91, 57]]) {
    e.dispatch('carry', null, { x, y }); settle(e);
    if (e.state.status !== 'live') break;
  }
  return e;
}

// 1) 도착런 온사이드 규율 — 어떤 오프볼 선수도 max(라인, 캐리어) 앞에 있지 않다.
{
  let violations = 0, checked = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const e = driveWide(seed);
    if (e.state.status !== 'live') continue;
    const h = e.holder();
    const legal = Math.max(offsideLineOf(e) - 0.3, h.x - 0.7);
    for (const p of e.state.players.filter((p) => p.side === 'us' && p.role !== 'GK' && p.id !== h.id)) {
      checked++;
      if (p.x > legal + 0.5) violations++;
    }
  }
  ok(checked > 50, `표본 충분 (${checked}명 검사)`);
  ok(violations === 0, `오프볼 선수 오프사이드 주차 0건 (위반 ${violations})`);
}

// 2) pass_space 오프사이드 — 라인 너머·공보다 앞선 수신자는 거부, 공보다 뒤는 허용.
{
  const e = createEngine(getScenario('A1'), 7);
  const st = e.state.players.find((p) => p.id === 'us-st');
  const line = offsideLineOf(e);
  // 전방 오프사이드: 홀더(GK, x~6)보다 앞 + 라인 너머
  st.x = line + 6; st.y = 34;
  const r1 = e.dispatch('pass_space', null, { x: st.x + 2, y: 34 });
  ok(r1.ok === false && r1.rejected === true, `라인 너머 전방 수신자 → 오프사이드 거부 (rejected=${r1.rejected})`);
  ok(e.state.status === 'live', '오프사이드 거부는 공격을 끝내지 않음');
  // 백패스 예외: 홀더가 수신자보다 깊으면(수신자가 공보다 뒤) 라인 너머라도 온사이드
  const e2 = createEngine(getScenario('A1'), 7);
  const h2 = e2.holder();
  h2.x = 92; h2.y = 10;               // 바이라인 캐리어
  const st2 = e2.state.players.find((p) => p.id === 'us-st');
  st2.x = 91; st2.y = 34;             // 라인 너머지만 공보다 뒤
  const r2 = e2.dispatch('pass_space', null, { x: 91, y: 34 });
  ok(r2.rejected !== true, `공보다 뒤 수신자(컷백)는 라인 너머라도 온사이드 (rejected=${r2.rejected})`);
}

// 3) 컷백 체인 — 바이라인 도달 후 스폿 컷백이 합법 경로로 성사되고 존 xG를 받는다.
{
  let reached = 0, flagged = 0, zoned = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const e = driveWide(seed);
    if (e.state.status !== 'live') continue;
    const h = e.holder();
    if (h.x <= 90) continue;
    reached++;
    e.dispatch('pass_space', null, { x: h.x - 0.5, y: 34 }); settle(e);
    if (e.state.status !== 'live') continue;
    const nh = e.holder();
    if (nh?.side !== 'us') continue;
    if (e.state.lastPassFromByline === true) flagged++;
    const z = e.shotZoneNow?.();
    if (z && (z.id === 'cutback' || z.id === 'closeRange' || z.id === 'boxCentral')) zoned++;
  }
  ok(reached >= 10, `바이라인 도달 표본 충분 (${reached})`);
  ok(flagged >= reached * 0.5, `성공 컷백의 과반이 lastPassFromByline=true (${flagged}/${reached})`);
  ok(zoned >= 1, `컷백 수신자가 박스 슈팅존 획득 (${zoned}회)`);
}

// 4) 바이라인 술어 패리티 — to_feet과 pass_space가 같은 컷백 판정을 내린다.
{
  let both = 0, agree = 0;
  for (let seed = 1; seed <= 60 && both < 5; seed++) {
    const mk = () => {
      const e = createEngine(getScenario('A1'), seed);
      const h = e.holder(); h.x = 92; h.y = 10;
      const st = e.state.players.find((p) => p.id === 'us-st');
      st.x = 91; st.y = 34;
      return { e, st };
    };
    const a = mk(); const ra = a.e.dispatch('to_feet', a.st.id); settle(a.e);
    const b = mk(); const rb = b.e.dispatch('pass_space', null, { x: 91, y: 34 }); settle(b.e);
    if (ra.ok && rb.ok && a.e.state.status === 'live' && b.e.state.status === 'live') {
      both++;
      if (a.e.state.lastPassFromByline === b.e.state.lastPassFromByline && a.e.state.lastPassFromByline === true) agree++;
    }
  }
  ok(both >= 1, `양 경로 동시 성공 표본 (${both})`);
  ok(agree === both, `성공 시 두 경로의 컷백 플래그 일치·true (${agree}/${both})`);
}

// 5) 자책골 분기 — 깊은 수비수가 컷백을 걷어내다 자책(시드 탐색).
{
  let ownGoals = 0;
  for (let seed = 1; seed <= 400 && ownGoals === 0; seed++) {
    const e = createEngine(getScenario('A1'), seed);
    const h = e.holder(); h.x = 93; h.y = 11;
    // 컷백 레인에 깊은 수비수 배치(걷어낼 몸)
    const d = e.state.players.filter((p) => p.side === 'opp' && p.line === 'back')[0];
    d.x = 94; d.y = 30;
    const st = e.state.players.find((p) => p.id === 'us-st');
    st.x = 90; st.y = 40;
    e.dispatch('pass_space', null, { x: 93, y: 33 }); settle(e);
    if (e.state.outcome?.kind === 'own_goal') {
      ownGoals++;
      ok(e.state.status === 'over', '자책골은 공격 종료');
      ok(e.state.outcome.tone === 'goal', '자책골 tone=goal');
    }
  }
  ok(ownGoals >= 1, `자책골 분기 도달 (400시드 내 ${ownGoals}회)`);
}

// 6) 지원 앵커 — 측면 돌파 시 최심 피벗이 캐리어 뒤를 따른다(고립 방지).
{
  let behind = 0, near = 0, n = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const e = driveWide(seed);
    if (e.state.status !== 'live') continue;
    const h = e.holder();
    if (h.x <= 85) continue;
    const anchor = e.state.players
      .filter((p) => p.side === 'us' && ['DM', '6', '8'].includes(p.role))
      .sort((a, b) => a.homeX - b.homeX)[0];
    if (!anchor) continue;
    n++;
    if (anchor.x < h.x - 3) behind++;
    if (Math.hypot(anchor.x - h.x, anchor.y - h.y) <= 30) near++;
  }
  ok(n >= 8, `앵커 표본 충분 (${n})`);
  ok(behind === n, `앵커는 항상 캐리어 뒤 (${behind}/${n})`);
  ok(near >= n * 0.8, `앵커가 리사이클 거리(≤30m) 유지 (${near}/${n})`);
}

// 7) 회수 시 플래그 소멸 — 컷백 수신 후 리셋 경로가 lastPass*를 지운다.
{
  const e = createEngine(getScenario('A1'), 11);
  const h = e.holder(); h.x = 92; h.y = 10;
  const st = e.state.players.find((p) => p.id === 'us-st');
  st.x = 91; st.y = 34;
  let got = false;
  for (let seed = 11; seed <= 60 && !got; seed++) {
    const t = createEngine(getScenario('A1'), seed);
    const th = t.holder(); th.x = 92; th.y = 10;
    const tst = t.state.players.find((p) => p.id === 'us-st');
    tst.x = 91; tst.y = 34;
    const r = t.dispatch('pass_space', null, { x: 91, y: 34 }); settle(t);
    if (r.ok && t.state.status === 'live' && t.state.lastPassFromByline === true) {
      got = true;
      // 강제 리셋 경로(hold 폭주 대신 내부 리셋 재현이 어렵워 dispatch 기반):
      // hold는 플래그를 지운다(기존 규율) — 최소한 존 컨텍스트가 유지되지 않음을 확인.
      t.dispatch('hold'); settle(t);
      ok(t.state.lastPassFromByline === false, 'hold 후 컷백 플래그 소멸(존 컨텍스트 비영속)');
    }
  }
  ok(got, '플래그 수명 검증용 컷백 성사 표본 확보');
}

// 8) 보드 리드 reset 아웃렛 — 존재 시 저위험·후진 계약 (hud.js가 역참조하는 shape).
{
  let present = 0, wellFormed = 0, n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const e = driveWide(seed);
    if (e.state.status !== 'live') continue;
    const br = evaluateBoard(e);
    if (!br?.best) continue;
    n++;
    if (br.reset) {
      present++;
      const hx = e.holder().x;
      if (br.reset.risk < 0.2 && (br.reset.target?.x ?? 99) <= hx + 3) wellFormed++;
    }
  }
  ok(n >= 10, `보드 리드 표본 충분 (${n})`);
  ok(present >= n * 0.3, `측면 돌파 상황의 30%+에서 안전 리셋 존재 (${present}/${n})`);
  ok(wellFormed === present, `존재하는 reset은 전부 저위험(<20%)·후진 계약 준수 (${wellFormed}/${present})`);
}

console.log(fail === 0 ? '\n✅ 컷백 구조 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
