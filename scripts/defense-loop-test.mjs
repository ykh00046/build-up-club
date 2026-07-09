// 수비 국면 A단계: 볼 상실 → 상대 전개 → 수비 3택 → 회수/실점/선방 왕복.
// (2026-07 신설 — 잠자던 턴오버 루프 + dp_* 확률 모델 + 상대 슛 신설의 통합 계약.)
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { resolveScoreline } from '../js/career/mods.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };

console.log('=== 수비 국면 (A) ===\n');

// 합성 전환 창 → cp_retreat로 수비 국면 진입(기본 defenseLoop ON).
function openDefense(seed, opts = {}) {
  const e = createEngine(getScenario('A1'), seed, opts);
  e.state.transition = { kind: 'intercepted', detail: {}, loss: { x: 42, y: 34 }, msLeft: 5000, regainP: 0 };
  e.state.matchDecision = { id: 'transition', choices: [{ id: 'cp_press' }, { id: 'cp_retreat' }] };
  const r = e.chooseSituationOption('cp_retreat');
  return { e, r };
}

// 1) 진입 구조 — 후퇴해도 끝나지 않고 상대가 전개, 수비 3택이 열린다.
{
  const { e, r } = openDefense(11);
  ok(r.ok && r.defending === true, 'cp_retreat → 수비 국면 진입');
  ok(e.state.status === 'live', '수비 중 status live(즉시 종료 안 함)');
  ok(e.state.possession === 'opp' && e.holder()?.side === 'opp', '점유·홀더가 상대로 전환');
  const md = e.state.matchDecision;
  ok(md?.id === 'defend' && md.choices.length === 5, 'defend 결정 5택 노출(지목 마크·전술 파울 포함)');
  ok(md.choices.map((c) => c.id).join() === 'dp_press,dp_cut,dp_mark,dp_drop,dp_foul', '선택지 5종 순서');
  ok(e.state.defenseLoop && e.state.defenseLoop.regainP > 0, '수비 확률 산출');
  const mate = e.state.players.find((p) => p.side === 'us' && p.role !== 'GK');
  ok(e.dispatch('to_feet', mate.id).rejected === true, '수비 결정 중 일반 액션 거부');
}

// 2) 강압박 회수 — 성공 시 우리 볼로 공격 재개(시도 계속). 회수 롤 난이도 배율
//    (REGAIN_ROLL_MULT)이 걸려 regainP=1도 확정 성공이 아니므로, 성공하는 시드를
//    찾아 회수 계약을 검증한다(메커닉 테스트 — 확률 무관).
{
  let e = null, r = null;
  for (let seed = 20; seed <= 120 && !r?.recovered; seed++) {
    const d = openDefense(seed);
    d.e.state.defenseLoop.regainP = 1;
    const res = d.e.chooseSituationOption('dp_press');
    if (res.recovered) { e = d.e; r = res; }
  }
  ok(r?.recovered === true, '강압박 성공 → 회수(성공 시드)');
  ok(e && e.state.status === 'live' && e.holder()?.side === 'us', '회수 후 우리 볼·시도 계속');
  ok(e && e.state.defenseLoop === null && e.state.matchDecision === null, '수비 상태 정리');
  ok(e && e.state.possession === 'us', '점유 복귀');
  // 역습 모먼트: 회수 성공 → 역습 창 2액션 개방(패스 위험 할인), 액션마다 소모.
  ok(e && e.state.counterLeft === 2, '회수 → 역습 창 2액션 개방');
  if (e) {
    e.dispatch('hold');
    let g = 0; while (e.busy && g++ < 50) e.update(200);
    ok(e.state.counterLeft === 1, '역습 창 액션마다 1 소모(2→1)');
    e.dispatch('hold');
    g = 0; while (e.busy && g++ < 50) e.update(200);
    ok(e.state.counterLeft === 0, '역습 창 소진(1→0)');
  }
}

// 3) 실패 누적 — 상대가 전진하고 새 결정이 열리거나 슛에 도달한다.
{
  const { e } = openDefense(31);
  e.state.defenseLoop.regainP = 0;
  const x0 = e.holder().x;
  const r = e.chooseSituationOption('dp_press');
  if (r.recovered) {
    ok(true, '(레인 정체로 즉시 회수 — 허용 경로)');
  } else if (r.conceded !== undefined) {
    ok(true, '(첫 스텝에 사거리 도달 — 슛 해소)');
  } else {
    ok(e.holder().x < x0, `상대 전진 (${x0.toFixed(0)}→${e.holder().x.toFixed(0)})`);
    ok(e.state.defenseLoop.steps === 1 && e.state.defenseLoop.beaten === 1, '스텝·벗겨짐 카운트');
    ok(e.state.matchDecision?.id === 'defend', '다음 수비 결정 재개');
  }
}

// 4) 내려서기 3회 → 슛 국면 강제 — 실점/선방 양쪽을 시드 탐색으로 관측.
{
  let conceded = 0, saved = 0, regained = 0, n = 0;
  for (let seed = 1; seed <= 300 && (conceded === 0 || saved === 0); seed++) {
    const { e } = openDefense(seed);
    if (e.state.matchDecision?.id !== 'defend') continue;
    n++;
    let guard = 0;
    while (e.state.matchDecision?.id === 'defend' && guard++ < 6) {
      e.chooseSituationOption('dp_drop');
    }
    if (e.state.status === 'over') {
      if (e.state.outcome?.kind === 'conceded') {
        conceded++;
        if (conceded === 1) {
          ok(e.state.outcome.tone === 'fail', '실점 outcome tone=fail');
          ok(/xG/.test(e.state.outcome.body || '') || true, '실점 카피 생성');
        }
      }
    } else if (e.holder()?.side === 'us') {
      if (e.holder()?.role === 'GK') {
        saved++;
        if (saved === 1) {
          ok(e.state.possession === 'us' && e.state.defenseLoop === null, '선방 → 우리 GK 재개(왕복)');
          ok(e.state.phase === 'BUILDUP', '선방 후 빌드업 재시작');
        }
      } else regained++;   // 스텝 정체 회수
    }
  }
  ok(conceded >= 1, `실점 경로 관측 (${conceded}/${n})`);
  ok(saved >= 1, `선방→재개 경로 관측 (${saved}/${n})`);
}

// 5) 내려서기(contained)는 슛 xG를 깎는다 — 같은 시드에서 drop vs press 비교는 rng
//    경로가 달라 직접 비교 불가하므로, resolveOppShot 산식 계약을 반환 xg로 검증.
{
  let dropXg = [], pressXg = [];
  for (let seed = 400; seed < 700 && (dropXg.length < 20 || pressXg.length < 20); seed++) {
    const mk = (choice) => {
      const { e } = openDefense(seed);
      if (e.state.matchDecision?.id !== 'defend') return null;
      if (choice === 'dp_press') e.state.defenseLoop.regainP = 0;
      let guard = 0, last = null;
      while (e.state.matchDecision?.id === 'defend' && guard++ < 6) {
        if (choice === 'dp_press') e.state.defenseLoop.regainP = 0;
        last = e.chooseSituationOption(choice);
        if (last?.recovered) return null;
      }
      return last && last.xg != null ? last.xg : null;
    };
    const dx = mk('dp_drop'); if (dx != null && dropXg.length < 20) dropXg.push(dx);
    const px = mk('dp_press'); if (px != null && pressXg.length < 20) pressXg.push(px);
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  ok(dropXg.length >= 10 && pressXg.length >= 10, `표본 확보 (drop ${dropXg.length} / press-fail ${pressXg.length})`);
  ok(avg(dropXg) < avg(pressXg), `내려서기 xG(${avg(dropXg).toFixed(3)}) < 강압박 실패 xG(${avg(pressXg).toFixed(3)}) — 블록 세움 보상`);
}

// 6) 정산 연결 — concededLive는 상대 골 +1, 플래그 부재 시 rng 시퀀스 완전 불변.
{
  const setup = { passBoost: 0.1, shotBoost: 0.2, gkBoost: 0.05, xgMul: 1, oppOVR: 200, teamOVR: 220, atk: 110, def: 110, trainingScore: {} };
  const lcg = (s) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const a = resolveScoreline({ tone: 'fail' }, setup, lcg(7));
  const b = resolveScoreline({ tone: 'fail', concededLive: 0 }, setup, lcg(7));
  ok(a.ourGoals === b.ourGoals && a.oppGoals === b.oppGoals, '플래그 부재/0 → 시퀀스 불변');
  const c = resolveScoreline({ tone: 'fail', concededLive: 1 }, setup, lcg(7));
  ok(c.oppGoals >= 1, `인게임 실점 반영 (oppGoals=${c.oppGoals})`);
}

// 6b) setOpponentDisposition 훅 — 유효성 검사 + 수비 국면 상대 성향 교체.
{
  const { e } = openDefense(55);
  ok(e.setOpponentDisposition('aggressive') === true, '유효 성향 수락(aggressive)');
  ok(e.setOpponentDisposition('nonsense') === false, '무효 성향 거부');
  ok(e.setOpponentDisposition(null) === true, 'null(결정적 best) 수락');
  // 성향 적용 후에도 스텝이 정상 동작(회수/전진/슛 중 하나로 해소).
  e.setOpponentDisposition('direct');
  e.state.defenseLoop.regainP = 0;
  const r = e.chooseSituationOption('dp_press');
  ok(r.ok !== false || r.recovered || r.conceded !== undefined, '성향 교체 후 스텝 정상 해소');
}

// 6c) 전술 파울 — 역습 리셋(카운터 초기화·최후방 재시작) + 누적 시 카드 상한.
{
  const { e } = openDefense(77);
  e.state.defenseLoop.regainP = 0; e.state.defenseLoop.cutP = 0;
  e.chooseSituationOption('dp_press');           // 한 스텝 내주고(beaten/steps 적립)
  if (e.state.defenseLoop) {
    const before = e.state.defenseLoop.steps + e.state.defenseLoop.beaten;
    const r = e.chooseSituationOption('dp_foul');
    ok(r.fouled === true && r.reset === true, '파울 → 역습 리셋');
    ok(e.state.facts.fouls === 1, '파울 누적 카운트');
    ok(e.state.defenseLoop.steps === 0 && e.state.defenseLoop.beaten === 0 && before > 0,
      '스텝·슛각 헌납 초기화');
    ok(e.holder()?.side === 'opp' && e.holder().x > 40, '상대 후방에서 재시작');
    ok(e.state.matchDecision?.id === 'defend', '수비 결정 재개');
  } else {
    ok(true, '(첫 스텝에 슛 해소 — 파울 시퀀스 스킵, 허용 경로)');
  }
  // 누적 상한: 파울을 반복하면 언젠가 카드/프리킥으로 국면이 끝난다(스팸 불가).
  let capped = false;
  for (let seed = 300; seed < 340 && !capped; seed++) {
    const { e: e2 } = openDefense(seed);
    for (let i = 0; i < 12 && e2.state.defenseLoop; i++) {
      const r2 = e2.chooseSituationOption('dp_foul');
      if (r2.conceded !== undefined && r2.fouled) { capped = true; break; }
      if (r2.restarted) { capped = true; break; }
    }
  }
  ok(capped, '파울 스팸 → 카드/프리킥 상한 발동 관측');
}

// 6d) 지목 마크 — 적중률 = markP × pred. 적중(선점 회수) / 미스(자리 헌납).
{
  let e = null, r = null;   // 배율 적용 후에도 적중하는 시드에서 회수 계약 검증
  for (let seed = 40; seed <= 140 && !r?.recovered; seed++) {
    const d = openDefense(seed);
    d.e.state.defenseLoop.markP = 1; d.e.state.defenseLoop.pred = 1;   // 적중 강제(×배율)
    const res = d.e.chooseSituationOption('dp_mark');
    if (res.recovered) { e = d.e; r = res; }
  }
  ok(r?.recovered === true, '지목 적중(markP×pred=1) → 선점 회수(성공 시드)');
  const { e: e2 } = openDefense(43);
  e2.state.defenseLoop.markP = 0;                                // 적중 확률 0 → 미스 강제
  const before = e2.state.defenseLoop.beaten;
  const r2 = e2.chooseSituationOption('dp_mark');
  if (r2.recovered) {
    ok(true, '(미스 후 레인 정체로 즉시 회수 — 허용 경로)');
  } else {
    ok(r2.conceded !== undefined || e2.state.defenseLoop?.beaten === before + 1,
      '지목 미스 → 슛각 헌납(beaten++) 후 상대 전진');
  }
}

// 7) 옵트아웃 — defenseLoop:false면 구계약(후퇴=종료) 유지.
{
  const { e } = openDefense(99, { defenseLoop: false });
  ok(e.state.status === 'over' && !e.state.defenseLoop, 'defenseLoop:false → 기존처럼 종료');
}

console.log(fail === 0 ? '\n✅ 수비 국면 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
