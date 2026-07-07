// Turn engine. One dispatch = one tactical decision: resolve the action with
// the same lane math the preview showed, let the press react (probabilistic
// commit), update pressure/phase, and animate both teams' movement.
//
// Phases: BUILDUP → PROGRESSION → FINAL_THIRD → SHOT(goal). The goal — not
// "zone reached" — is the success signal. There are no grades anywhere.

import { PHASE_LINES, PITCH_W, PITCH_H, clamp, dist, lerp, carryRange } from '../data/pitch.js';
import { josa } from '../util/josa.js';
import {
  evaluateLane, evaluateLanding, linesBroken, offsideLine, sweeperRisk,
  nearestDefender, TACKLE_RADIUS, computeOrientation, receiverPressure,
} from './space.js';
import { createPress } from './press.js';
import { findSuperiorityZones, superiorityAt } from './superiority.js';
import { detectShotZone, resolveShot, computeShotXg, shotBackpressure } from './shots.js';
import { buildOutcome } from './outcome.js';
import { applyOpponentBuildStep, applyPossessionEvent } from './possession-adapter.js';
import { oppBuildDryRun } from './dry-run.js';
import { isDisposition } from './opp-build-policy.js';
import { createRng } from './rng.js';
import {
  applyMatchDecision, createTacticalState, prepareSituations, resolveCounterRisk,
  tacticalFactors, tacticalRiskMultiplier, updateTacticalState,
} from './tactics.js';
import { t, getLang } from '../career/i18n.js';

const LONG_PASS_GATE = 0.5;

// Localized label for a log line: Korean gets the josa-attached form (correct
// particle), English gets the bare label — the English templates read naturally
// without particles. Keeps the ko output byte-identical to the original josa().
function jl(label, withB, withoutB) {
  return getLang() === 'en' ? String(label ?? '') : josa(label, withB, withoutB);
}

export function createEngine(scenario, seed = Date.now() % 2147483647, options = {}) {
  const rng = createRng(seed);
  // defenseLoop(기본 ON, 2026-07 A단계): 볼 상실 후 공격이 그냥 끝나는 대신 상대가
  // 실제로 전개해 오고(잠자던 턴오버 루프 활성화) 매 스텝 수비 3택으로 저지한다 —
  // 실패가 쌓이면 상대 슛(실점 위험), 회수하면 공격 재개. 한 판 안의 공수 왕복.
  const { intensityOverride, possessionTurnoverLoop = false, opponentBuildDisposition = null, defenseLoop: defenseLoopEnabled = true, defenseEntry = 'reset', baitCombo = false } = options;
  // 수비 국면의 상대 전개 성향 — setOpponentDisposition으로 경기 중 교체 가능
  // (에이전트 듀얼/추후 B단계: 상대 지휘를 외부에 개방). null = 결정적 best 루트.
  let liveOppDisposition = opponentBuildDisposition;
  const press = createPress({ ...scenario, ...(intensityOverride ? { intensityOverride } : {}) });
  // 유효 강도 — 수비 국면에도 같은 램프를 건다. 기존엔 createPress(공격 국면)에만
  // 들어가 커리어 "상대 OVR → 강도" 램프가 수비 국면에서 끊겨 있었다(자기대국
  // 감사: 강도 4종 결과가 바이트 단위 동일). 강한 상대일수록 우리 압박에 침착하고
  // (regainP↓) 마지막 슛 질이 좋다(xG base↑).
  const effIntensity = intensityOverride ?? scenario?.intensity ?? 'mid';
  const INT_DEF = { low: -0.02, mid: 0, high: 0.04, vhigh: 0.07 };
  const intDef = INT_DEF[effIntensity] ?? 0;

  const players = [...scenario.buildOurs(), ...scenario.buildOpp()].map((p) => ({
    ...p,
    side: p.id.startsWith('us-') ? 'us' : 'opp',
    fx: p.x, fy: p.y, tx: p.x, ty: p.y,
    committedTurns: 0, beatenTurns: 0,
    orientation: 'FACING', // posture grammar (P1): FACING / HALF / BACK
  }));

  const state = {
    scenario, seed,
    players,
    pressIntensity: effIntensity,  // 슛 백프레셔·리포트용 유효 강도 (자기대국 감사)
    possession: 'us',
    holderId: 'us-gk',
    phase: 'BUILDUP',
    pressure: 22,
    consecutiveHolds: 0,
    turn: 0,
    rewardWindow: null,
    facts: {
      baits: 0, linesBroken: 0, switches: 0, windowsUsed: 0, runs: 0,
      situationsTriggered: 0, situationsResolved: 0, decisionsMade: 0,
      counterpressWins: 0, defensivePressWins: 0, secondBalls: 0,
    },
    log: [],
    status: 'live',          // live | over
    outcome: null,
    transition: null,        // 카운터프레스 5초 창 (E1): { kind, detail, loss, msLeft, regainP }
    defensivePress: null,    // 상대 소유 압박 창: { carrierId, msLeft, regainP, cutP }
    defenseLoop: null,       // 수비 국면(A): { steps, beaten, contained, regainP, cutP }
    baited: null,            // 유인–3자 콤비(Phase 0): { markerId, receiverId, carrierId, vacated }
    transitionUsed: false,
    lastPassFromByline: false,
    lastPassLofted: false,
    lastPassCross: false,   // 측면발 → 박스 중앙 공중볼만 헤더 컨텍스트 (Major 3)
    cue: scenario.hint,
    cueTone: 'info',
    lineIntents: { front: 'pin', mid: 'between', back: 'hold', ...(scenario.defaultIntents || {}) },
    // ── 전술 깊이(모멘텀·피로·상대 적응) ──
    ...createTacticalState(),
  };

  // Kickoff shape: the press starts ON its marks/shift, not at raw formation
  // anchors, so turn-0 previews are honest (ISSUE-001).
  press.init(state);

  // Kickoff legality: our forwards line up level with the opponent's last
  // line (no one starts offside); depth opens as their line retreats.
  {
    const line = offsideLine(players.filter((p) => p.side === 'opp'));
    for (const p of players) {
      if (p.side !== 'us' || p.role === 'GK') continue;
      if (p.x > line - 1) { p.x = line - 1; p.tx = p.x; p.fx = p.x; }
    }
  }

  // ─── animation ────────────────────────────────────────────────────────────
  let anim = null; // { t, duration, ball: {from, to, lofted, landAt}, onDone }

  function byId(id) { return players.find((p) => p.id === id); }
  function ours() { return players.filter((p) => p.side === 'us'); }
  function opps() { return players.filter((p) => p.side === 'opp'); }
  function holder() { return byId(state.holderId); }

  // fx/fy (animation start) are snapshotted in dispatch() BEFORE any action
  // mutates logical positions, so movement always animates from where the
  // player was rendered last.
  function startAnim(ball, duration, onDone) {
    anim = { t: 0, duration, ball, onDone, startedAt: performance.now() };
  }

  function logLine(text, tone = 'info') {
    state.log.push({ text, tone, turn: state.turn });
    if (state.log.length > 30) state.log.shift();
    state.cue = text;
    state.cueTone = tone;
  }

  // 상대 압박 공격성 0..1 — 전방·중원 압박수의 jumpiness 평균(게겐 높음, 로우블록 낮음).
  function pressAggression() {
    const pressers = opps().filter((d) => d.line === 'front' || d.line === 'mid');
    if (!pressers.length) return 0;
    const avg = pressers.reduce((a, p) => a + (p.jumpiness ?? 0.5), 0) / pressers.length;
    return clamp((avg - 0.4) / 0.5, 0, 1);
  }
  function addPressure(delta) {
    // 지침-압박 상호작용: 높은 압박에 build-up 지침(중원 support / 전방 drop)으로 대응하면
    // 유인·수적우위로 압박이 완화된다. 압박이 셀수록 효과 크고, 낮은 블록엔 거의 무효
    // (블록 상대엔 드롭이 오히려 무의미 — 밀어붙여야 함). "압박 깨는 원리"를 게임화.
    if (delta > 0 && (state.lineIntents.mid === 'support' || state.lineIntents.front === 'drop')) {
      delta *= (1 - pressAggression() * 0.38);
    }
    state.pressure = clamp(state.pressure + delta, 0, 100);
  }

  function tacRiskMul(actionId) { return tacticalRiskMultiplier(state, actionId); }

  function logSituationEvents(events) {
    for (const event of events) {
      if (event.type === 'activated') {
        state.facts.situationsTriggered++;
        logLine(`${t(`sit.${event.situation.id}.title`)} — ${t(`sit.${event.situation.id}.detail`)}`, 'warn');
      } else if (event.type === 'resolved') {
        state.facts.situationsResolved++;
        logLine(t('sit.resolvedLog').replace('{x}', t(`sit.${event.situation.id}.title`)), 'success');
      } else if (event.type === 'decision') {
        logLine(`${event.decision.title} — ${event.decision.detail}`, 'warn');
      }
    }
  }

  // Risk → actual failure probability. Piecewise so the LABEL is honest (P1a):
  // '안전'(≤0.28) really is safe — 2~5% — playtesters called the old 11%
  // ceiling a lie ("잘 읽었는데 뺏겼다"). Difficulty lives in the gamble
  // bands instead: risky climbs to 45%, cut up to 95%.
  function rollFail(risk) {
    let p;
    if (risk <= 0.28) p = 0.02 + (risk / 0.28) * 0.03;            // safe: 2~5%
    else if (risk <= 0.58) p = 0.05 + ((risk - 0.28) / 0.30) * 0.40; // risky: 5~45%
    else p = 0.45 + ((risk - 0.58) / 0.39) * 0.50;                // cut: 45~95%
    return rng.next() < clamp(p, 0.02, 0.95);
  }

  function activeWindow() {
    const w = state.rewardWindow;
    if (!w) return null;
    if (state.turn > w.expiresTurn) { state.rewardWindow = null; return null; }
    return w;
  }

  // P3: using the edge. A pass that arrives where WE hold superiority is
  // genuinely safer — the receiver has time and an extra man. This is what
  // makes a switch into a weak-side overload worth playing (and what was
  // missing while switch sat at 0% use). Up to ~30% relief at a strong edge.
  // Applied identically in preview and resolution so the read stays honest.
  function edgeRelief(risk, point) {
    const v = superiorityAt(point, players).value;
    return v > 0 ? clamp(risk * (1 - Math.min(v, 3) * 0.09), 0.02, 0.97) : risk;
  }

  function finishAttempt(kind, detail) {
    state.status = 'over';
    state.outcome = buildOutcome(kind, state, detail);
    logLine(state.outcome.headline, state.outcome.tone === 'goal' ? 'success' : 'error');
  }

  // ─── 카운터프레스 5초 전환 창 (E1, research §3.1) ──────────────────────────────
  // 오픈 플레이에서 볼을 잃으면 즉시 끝내지 않고 한 번의 되찾기 기회를 준다.
  // 회복 확률은 레스트 디펜스(상실 지점 주변의 우리 인원 = 컴팩트)에 달렸다.
  // 성공하면 높은 곳에서 되찾아 공격을 잇고, 실패/후퇴하면 원래 상실로 종료된다.
  function counterpressProb(loss, near) {
    const control = clamp((state.facts.linesBroken || 0) * 0.03 + (state.facts.situationsResolved || 0) * 0.05, 0, 0.2);
    return clamp(0.12 + near.length * 0.11 + control, 0.1, 0.7);
  }

  function maybeOpenTransition(kind, detail) {
    if (state.transitionUsed) return false;                       // 공격당 1회
    if (kind !== 'intercepted' && kind !== 'tackled') return false; // collapsed/슛은 제외
    if (state.phase === 'SHOT') return false;
    const h = holder();
    const loss = detail?.interceptor
      ? { x: detail.interceptor.x, y: detail.interceptor.y }
      : (h ? { x: h.x, y: h.y } : null);
    if (!loss) return false;
    const near = ours().filter((p) => p.role !== 'GK' && dist(p, loss) < 18);
    if (near.length === 0) return false;                          // 되찾을 인원 없음 → 종료
    const regainP = counterpressProb(loss, near);
    state.transitionUsed = true;
    state.transition = { kind, detail, loss, msLeft: 5000, regainP };
    state.matchDecision = {
      id: 'transition',
      title: t('dec.transition.title'),
      detail: t('dec.transition.detail').replace('{n}', String(Math.round(regainP * 100))),
      choices: [
        { id: 'cp_press', label: t('dec.transition.cp_press.label'), desc: t('dec.transition.cp_press.desc') },
        { id: 'cp_retreat', label: t('dec.transition.cp_retreat.label'), desc: t('dec.transition.cp_retreat.desc') },
      ],
    };
    logLine(t('log.transition.open'), 'warn');
    return true;
  }

  // 마지막 패스 컨텍스트(컷백/로프트/크로스 플래그) 초기화 — 볼 회수/리셋 경로에서
  // 반드시 호출. 이전엔 실패·회수 경로가 안 지워서 직전 성공 패스의 플래그가 살아남아
  // 스크램블 회수 후 슛이 컷백 xG(0.65)를 받거나 헤더(0.18)로 손해 봤다(감사 H2).
  function clearPassContext() {
    state.lastPassLofted = false;
    state.lastPassFromByline = false;
    state.lastPassCross = false;
  }

  function resolveTransition(choiceId) {
    const tr = state.transition;
    if (!tr) return { ok: false, rejected: true };
    state.transition = null;
    state.matchDecision = null;
    state.facts.decisionsMade++;
    if (choiceId === 'cp_press' && rng.next() < tr.regainP) {
      const rec = ours().filter((p) => p.role !== 'GK')
        .sort((a, b) => dist(a, tr.loss) - dist(b, tr.loss))[0];
      if (rec) { state.holderId = rec.id; rec.orientation = 'FACING'; }
      clearPassContext();
      state.facts.counterpressWins++;
      state.consecutiveHolds = 0;
      addPressure(-8);
      logLine(t('log.transition.cpWin'), 'success');
      return { ok: true, recovered: true };
    }
    logLine(choiceId === 'cp_press' ? t('log.transition.cpFail') : t('log.transition.retreat'),
      choiceId === 'cp_press' ? 'error' : 'info');
    if (possessionTurnoverLoop) {
      const turnover = applyPossessionEvent({ state }, 'turnover');
      if (turnover) {
        logLine(t('log.transition.turnover'), 'warn');
        return { ok: true, recovered: false, turnover };
      }
    }
    // 수비 국면(A): 공격이 끝나는 대신 상대가 전개해 온다 — 우리가 막을 차례.
    // 상실 지점은 위에서 transition을 지우기 전에 잡아 인자로 넘긴다(A-2 진입).
    if (defenseLoopEnabled && openDefenseLoop(tr.loss)) {
      return { ok: true, recovered: false, defending: true };
    }
    finishAttempt(tr.kind, tr.detail);
    return { ok: true, recovered: false };
  }

  // ─── 수비 국면(A단계): 상대 전개 저지 ──────────────────────────────────────
  // 상대가 자기 후방에서 한 스텝씩 전개(opp-build-policy가 경로 선택)하고, 매 스텝
  // 우리가 강압박/패스길 차단/내려서기 중 선택한다. 회수하면 공격 재개, 스텝이
  // 쌓이거나 우리 진영 깊숙이 들어오면 상대가 실제로 슛한다(실점 위험).
  const DEFENSE_MAX_STEPS = 3;      // 이 스텝을 버티면(또는 침투 당하면) 슛 국면
  // 32→24 (자기대국 2R 감사): 32는 상대 MF 기본 위치(x≈31)와 겹쳐 전 시나리오에서
  // 국면이 2결정 만에 슛으로 끝났다(3번째 결정 관측 0건) — 지휘자·내려서기 축적·
  // 성향 교체가 영향 줄 시간 자체가 없었다. 24면 한 패스 더 들어와야 사거리.
  // 24→22 (4R 플랜 A): 상대 MF 라인이 x=24-25라 MF 수신=즉시 슛이었다 — 특히
  // 상실지점 진입+direct burst 조합이 1결정 슛으로 붕괴. 22면 MF 수신 후에도
  // 결정이 하나 더 남는다(전방 x≈19가 진짜 사거리).
  const DEFENSE_SHOT_X = 22;        // 상대 캐리어가 이 x 아래로 오면 사거리(우리 골 x=0)
  // 회수 난이도(8R concede-band): 각 수비 결정의 회수 성공률(regainP/cutP/markP)이
  // ~0.5라 다결정 국면 누적 회수가 ~95%로 치솟아 볼 상실이 거의 처벌 안 됐다(수비
  // 실점 밴드 8~18% 대비 ~3%). 이 배율은 '실제 회수 롤'에만 걸어 성공률만 낮춘다 —
  // 정책값(dl.regainP 등)은 안 건드려 5택 상대균형·press 존재감을 보존하고, 상대가
  // 전개를 이어갈 여지(슛 도달률↑)를 준다. (정책값까지 낮추면 회수 3택이 파울 밸브에
  // 밀려 press 0%·foul 폭증 — 실패한 접근.)
  const REGAIN_ROLL_MULT = 0.63;

  // 수비 국면의 재배치 — 22명 전원이 공격 대형 그대로 박제된 채 볼만 순간이동
  // 하던 문제(자기대국 감사: 국면 전체 이동량 0.00, 상대 GK의 최근접 '헌터'가
  // 우리 ST). 최근접 2인은 캐리어를 사냥하고, 나머지는 볼-골 사이로 물러나며
  // 중앙을 좁힌다. 상대 비캐리어도 전진 지원. 결정적(rng 미사용) — 시퀀스 불변.
  function advanceDefenseShape(carrier) {
    const STEP = 6;
    const usField = ours().filter((p) => p.role !== 'GK');
    const byDist = [...usField].sort((a, b) => dist(a, carrier) - dist(b, carrier));
    const hunterIds = new Set(byDist.slice(0, 2).map((p) => p.id));
    for (const p of usField) {
      // 사냥조는 캐리어로, 블록조는 캐리어보다 골 쪽 라인으로 + 중앙 압축.
      const txp = hunterIds.has(p.id) ? carrier.x : Math.min(p.x, carrier.x - 6);
      const typ = hunterIds.has(p.id) ? carrier.y : p.y + (PITCH_H / 2 - p.y) * 0.15;
      const dx = txp - p.x, dy = typ - p.y;
      const dd = Math.hypot(dx, dy);
      if (dd > 0.01) {
        const mv = Math.min(dd, STEP);
        p.x = clamp(p.x + (dx / dd) * mv, 2, PITCH_W - 2);
        p.y = clamp(p.y + (dy / dd) * mv, 2, PITCH_H - 2);
      }
      p.fx = p.x; p.fy = p.y; p.tx = p.x; p.ty = p.y; p.rx = p.x; p.ry = p.y;
    }
    for (const p of opps()) {
      if (p.id === carrier.id || p.line === 'gk') continue;
      // 볼보다 뒤(후방)의 선수만 따라 올라온다 — 이미 깊은 전방은 라인 유지.
      // 전원 전진시키면 ST가 스텝마다 박스로 파고들어 근거리 슛이 양산된다(측정:
      // 실점 10.7→25.8% 폭등) — 지원은 캐리어 라인까지만.
      if (p.x <= carrier.x) continue;
      p.x = clamp(Math.max(p.x - 2, carrier.x), 2, PITCH_W - 2);   // 전진 지원(-x)
      p.fx = p.x; p.tx = p.x; p.rx = p.x;
    }
  }

  function defendDecisionFor(carrier) {
    advanceDefenseShape(carrier);
    const hunters = pressureHunters(carrier);
    const regainP = defensivePressProb(carrier, hunters);
    // 패스길 차단은 상대의 실제 다음 루트(dry-run best)를 읽는다 — 위험한 루트로
    // 나올수록 끊기 쉽다. 기존 regainP-0.08 파생은 "할인된 강압박"일 뿐 상대 선택과
    // 무접점이라 읽기 게임이 없었다(자기대국 감사). 상대 위험 루트가 공짜였던 것도
    // 이 항으로 비용이 생긴다: 위험하게 나오면 cut이 press를 역전한다.
    const route = oppBuildDryRun({ state })?.best ?? null;
    const PREDICTABILITY = { safe: 0.95, balanced: 0.85, aggressive: 0.7, direct: 0.6 };
    const pred = liveOppDisposition ? (PREDICTABILITY[liveOppDisposition] ?? 0.85) : 1;
    // 차단(cut)은 존 커버 — 성향 독립(flat). cut/mark 니치의 핵심: cut은 어느
    // 상대든 채널을 덮는 신뢰형, mark(markP×pred)은 예측 가능 상대 대인 도박.
    // 예측 불가(aggressive/direct) 상대에선 mark이 약해 cut이 이기고, 예측 가능
    // (safe/balanced)에선 mark이 이긴다 — 이 분리는 cut이 flat일 때만 성립한다.
    // 7R 감사: cutP를 pred 기반으로 바꿨더니(e72de93) cut이 예측 불가 상대에서
    // 오히려 낮아져 loss 진입 cut 0% 소멸·reset balanced 니치 역전 → flat 복귀.
    // (성향은 이미 "예측가능→mark, 불가→cut" 선택 자체로 반영됨.)
    const cutP = clamp(0.12 + (route?.risk ?? 0.4) * 0.32 + (state.lineIntents.mid === 'support' ? 0.08 : 0), 0.1, 0.56);
    state.defenseLoop.route = route?.targetReal ? { x: route.targetReal.x, y: route.targetReal.y } : null;
    state.defenseLoop.regainP = regainP;
    state.defenseLoop.cutP = cutP;
    // 지목 마크(dp_mark) — 적중 시 회수 확률과 성향 신뢰도. 테스트가 강제할 수
    // 있도록 dl에 저장(regainP/cutP와 같은 규약). 사용할수록 상대도 읽어 감쇄
    // (0.6 → -0.15/회, 바닥 0.3): 감쇄 없인 safe 상대가 원버튼 회수 93%였다.
    state.defenseLoop.markP = Math.max(0.3, 0.6 - 0.15 * (state.defenseLoop.markUses ?? 0));
    state.defenseLoop.pred = pred;
    // 예상 루트 인텔(2R 기능 2순위) — dry-run이 이미 계산한 best 루트를 노출하되,
    // 성향 신뢰도로 가른다: best 표시를 무조건 주면 direct 상대에겐 4번 중 3번
    // 오정보(이탈률 77%)라, 예측 가능한 상대만 구체 루트를 말한다. 허브 성향 필
    // ("직선 역습")이 경기 중 수비 판단과 여기서 연결된다.
    const intel = route?.target?.label
      ? (pred >= 0.8 ? t('dec.defend.intel').replace('{label}', route.target.label) : t('dec.defend.intelFuzzy'))
      : '';
    state.matchDecision = {
      id: 'defend',
      title: t('dec.defend.title'),
      detail: t('dec.defend.detail').replace('{label}', carrier.label).replace('{n}', String(DEFENSE_MAX_STEPS - state.defenseLoop.steps))
        + (intel ? ' ' + intel : ''),
      choices: [
        { id: 'dp_press', label: t('dec.defensive_press.dp_press.label'), desc: t('dec.defensive_press.dp_press.desc').replace('{n}', String(Math.round(regainP * 100))) },
        { id: 'dp_cut', label: t('dec.defensive_press.dp_cut.label'), desc: t('dec.defensive_press.dp_cut.desc').replace('{n}', String(Math.round(cutP * 100))) },
        // 지목 마크 — 인텔의 예상 수신자를 선점하는 읽기 도박: 적중하면 최고의
        // 회수, 빗나가면 마커가 자리를 비워 슛각 헌납. 성향 신뢰도가 곧 EV.
        { id: 'dp_mark', label: t('dec.defend.mark.label'), desc: t('dec.defend.mark.desc').replace('{n}', String(Math.round(state.defenseLoop.markP * pred * 100))) },
        { id: 'dp_drop', label: t('dec.defend.drop.label'), desc: t('dec.defend.drop.desc') },
        // 전술 파울 — 역습 강제 리셋 밸브(2R 감사 기능 1순위). 첫 파울은 싸지만
        // 누적되면 카드/프리킥 위험: 자원 관리 판단이 네 번째 축.
        { id: 'dp_foul', label: t('dec.defend.foul.label'), desc: t('dec.defend.foul.desc').replace('{n}', String((state.facts.fouls ?? 0) + 1)) },
      ],
    };
  }

  function openDefenseLoop(lossAt = state.transition?.loss ?? null) {
    const turnover = applyPossessionEvent({ state }, 'turnover');
    if (!turnover) return false;
    let carrier = holder();
    if (!carrier || carrier.side !== 'opp') return false;
    // 진입 다양화(4R 플랜 A-2, defenseEntry:'loss') — 상실 지점 최근접 상대가
    // 이어받는다: 깊은 곳에서 뺏길수록 위험한 진입. 기본값 'reset'(GK 재시작)은
    // 기존 계약 불변. 하드 가드 1개: 사거리+한 스텝(26m) 안이면 한 티어 뒤로
    // 승격 — "0~1결정 즉사"는 결정 게임의 부정(카운터팩추얼: 회수 48.8→12.3%).
    if (defenseEntry === 'loss' && lossAt) {
      const MIN_ENTRY_X = DEFENSE_SHOT_X + 26;
      const entry = opps().filter((p) => p.line !== 'gk')
        .sort((a, b) => dist(a, lossAt) - dist(b, lossAt))
        .find((p) => p.x > MIN_ENTRY_X) ?? carrier;
      if (entry.id !== carrier.id) {
        state.holderId = entry.id;
        if (state.ball) { state.ball.x = entry.x; state.ball.y = entry.y; }
        carrier = entry;
      }
    }
    clearPassContext();
    // beaten = 슛각 헌납(press/mark 실패, xG 가중). strained = 위기 사다리 게이트용
    // '뚫림' 카운터(press/cut/mark 실패 모두) — cut 실패는 슛각을 안 내주므로 beaten엔
    // 안 세지만 사다리 판정엔 세야 cut 지배 성향(aggressive/direct)도 파울/드롭이 열린다.
    state.defenseLoop = { steps: 0, beaten: 0, strained: 0, contained: 0, regainP: 0, cutP: 0 };
    logLine(t('log.defense.open'), 'warn');
    defendDecisionFor(carrier);
    return true;
  }

  function defenseRegain(at, { viaPress = false } = {}) {
    const regain = applyPossessionEvent({ state }, 'press_regain', { at, regainSide: 'us' });
    state.defenseLoop = null;
    state.matchDecision = null;
    clearPassContext();
    // phase 정합 — 공격측 압박 회수와 같은 규약. 안 맞추면 회수 후 홀더 x>40인데
    // phase=BUILDUP인 스테일이 100%로 남아 국면선 통과 보너스가 공짜로 지급됐다
    // (자기대국 2R 감사).
    const h = holder();
    state.phase = h && h.x > PHASE_LINES.PROGRESSION ? 'PROGRESSION' : 'BUILDUP';
    // 강압박 회수의 정체성 = 즉시 역공의 기세. 회수 지점 프리미엄은 최근접 매칭
    // 기하학상 무의미로 측정됨(2R: 골전환 press 16.5% vs cut 18.0%) — 위치 대신
    // 모멘텀으로 보상해 press/cut 트레이드오프를 실체화.
    if (viaPress) state.momentum = clamp((state.momentum ?? 50) + 10, 0, 100);
    state.facts.defensivePressWins++;
    state.consecutiveHolds = 0;
    addPressure(-10);
    logLine(t('log.defense.regain'), 'success');
    return { ok: true, recovered: true, regain };
  }

  function resolveDefendStep(choiceId) {
    const dl = state.defenseLoop;
    if (!dl) return { ok: false, rejected: true };
    const carrier = holder();
    state.matchDecision = null;
    state.facts.decisionsMade++;
    if (choiceId === 'dp_foul') {
      // 전술 파울 — 이 역습을 강제 종료하고 상대 최후방부터 다시. 프로페셔널
      // 파울의 게임화: 스텝·슛각 헌납이 리셋되는 대신 파울이 누적되고, 3번째부터
      // 카드/위험 지역 프리킥 확률이 계단식으로 오른다(무한 리셋 스팸의 상한).
      state.facts.fouls = (state.facts.fouls ?? 0) + 1;
      const n = state.facts.fouls;
      addPressure(8 + n * 4);
      if (n >= 3 && rng.next() < 0.10 + (n - 3) * 0.06) {
        const fkXg = clamp(0.12 + (n - 3) * 0.05, 0.12, 0.4);
        state.defenseLoop = null;
        logLine(t('log.defense.foulCard'), 'error');
        if (rng.next() < fkXg) {
          endAttempt('conceded', { shooter: carrier, xg: fkXg });
          return { ok: true, conceded: true, fouled: true };
        }
        logLine(t('log.defense.saved'), 'success');
        state.possession = 'us';
        resetToKeeper(t('log.defense.restart'), 'info');
        return { ok: true, conceded: false, fouled: true, restarted: true };
      }
      logLine(t('log.defense.foul'), 'warn');
      const deep = opps().filter((p) => p.line !== 'gk').sort((a, b) => b.x - a.x)[0] ?? carrier;
      state.turn++;
      state.holderId = deep.id;
      if (state.ball) { state.ball.x = deep.x; state.ball.y = deep.y; }
      dl.steps = 0; dl.beaten = 0; dl.strained = 0; dl.contained = 0; dl.markUses = 0;
      defendDecisionFor(deep);
      return { ok: true, fouled: true, reset: true };
    }
    if (choiceId === 'dp_press' || choiceId === 'dp_cut') {
      const p = (choiceId === 'dp_press' ? dl.regainP : dl.cutP) * REGAIN_ROLL_MULT;
      if (rng.next() < p) {
        // 회수 위치가 두 선택의 보상을 가른다: 강압박=캐리어 지점(높은 회수 —
        // 그대로 역공), 차단=패스길 중간(더 깊음 — 안전하지만 재시작이 낮다).
        // 확률·실점 모두 cut 우위면 press가 지배당한다(EV 감사) — 위치로 분리.
        const at = choiceId === 'dp_cut' && dl.route
          ? { x: (carrier.x + dl.route.x) / 2, y: (carrier.y + dl.route.y) / 2 }
          : { x: carrier.x, y: carrier.y };
        return defenseRegain(at, { viaPress: choiceId === 'dp_press' });
      }
      // 점프했다 벗겨짐 — 상대에게 전진을 내준다. 강압박 실패는 슛 각까지 헌납
      // (beaten, xG↑). cut 실패는 슛각은 안 내주지만 '뚫림'이므로 위기 사다리엔 센다.
      dl.strained = (dl.strained ?? 0) + 1;
      if (choiceId === 'dp_press') dl.beaten++;
      logLine(choiceId === 'dp_press' ? t('log.defPress.pressFail') : t('log.defPress.cutFail'), 'error');
    } else if (choiceId === 'dp_mark') {
      // 지목 마크 — 예상 수신자에 대인으로 붙는 읽기 도박. 적중률은 성향 예측
      // 가능성(pred)에서 직접 유도한다(markP × pred). 루트 매칭으로 판정하던 구식은
      // 스텝 캡으로 전진 레인이 ~1개가 되면 성향과 무관하게 적중해 direct(79%)가
      // safe(73%)보다 회수가 높은 역설을 낳았다(니치 중복 정리). pred는 성향에서
      // 곧장 나오므로 robust: safe 0.95 → 잘 읽힘, direct 0.6 → 도박.
      dl.markUses = (dl.markUses ?? 0) + 1;
      const markHitP = clamp(dl.markP * (dl.pred ?? 1) * REGAIN_ROLL_MULT, 0.08, 0.9);
      if (rng.next() < markHitP) {
        // 클린 인터셉트 — 수신자 앞에서 끊어 그대로 역공(모멘텀).
        logLine(t('log.defense.markWin'), 'success');
        return defenseRegain({ x: carrier.x, y: carrier.y }, { viaPress: true });
      }
      // 빗나감 — 마커가 자리를 비워 슛각 헌납(press 실패와 같은 통화).
      dl.beaten++;
      dl.strained = (dl.strained ?? 0) + 1;
      logLine(t('log.defense.markMiss'), 'error');
    } else {
      // 내려서기 — 회수 시도는 없지만 블록을 세워 마지막 슛 질을 깎는다.
      dl.contained++;
      logLine(t('log.defense.drop'), 'info');
      // 세운 블록 앞에서 상대 전개가 죽을 수 있다 — 내려서기의 회수 경로.
      // 회수 0%였을 때 drop은 cut에 준열등했다(EV 감사: cut이 실점률까지 같거나
      // 낮으면서 회수 48%를 공짜로 얹음). 블록이 쌓일수록 정체 확률이 오른다.
      if (rng.next() < Math.min(0.12 * dl.contained, 0.36)) {
        logLine(t('log.defense.blockStall'), 'success');
        return defenseRegain({ x: carrier.x, y: carrier.y });
      }
    }
    // 상대의 전진 스텝. 레인이 없으면(정체) 우리 회수.
    const step = applyOpponentBuildStep({ state }, {
      disposition: liveOppDisposition,
      rng: liveOppDisposition ? rng.next : undefined,
    });
    if (!step || step.stalled) {
      return defenseRegain(step?.at ?? { x: carrier.x, y: carrier.y });
    }
    dl.steps++;
    const nu = holder();
    logLine(t('log.defense.step').replace('{label}', nu.label), 'warn');
    addPressure(5);
    // 첫 스텝은 슛으로 직결되지 않는다(≥2결정 보장) — 볼을 막 되찾은 팀도 킬패스
    // 전에 한 번은 정리한다. 이게 없으면 미드밴드 선수가 없는 포메이션(게겐)의 loss
    // 진입이 100% 1결정 즉사가 된다(8R D2): 진입 후보가 백4(x≈51)뿐인데 direct의
    // burst 스텝(STEP_CAP×1.5=48)이 그대로 사거리를 넘겨서다. 첫 스텝이 사거리를
    // 넘기면 사거리 밖으로 세우고 수비 결정을 한 번 더 준다. (reset 진입은 GK 시작이
    // 깊어 첫 스텝이 애초에 사거리에 못 닿으므로 실질 영향은 loss 진입 한정.)
    if (nu.x <= DEFENSE_SHOT_X && dl.steps < 2) {
      nu.x = DEFENSE_SHOT_X + 8; nu.tx = nu.x;
      if (state.ball) state.ball.x = nu.x;
    }
    if (nu.x <= DEFENSE_SHOT_X || dl.steps >= DEFENSE_MAX_STEPS) return resolveOppShot(nu);
    // A3(비대칭 정체성): 상대 전진 스텝을 텔레포트 대신 볼 비행으로 — "얼어붙은
    // 판독" 사이의 전개가 눈에 보인다. dispatch와 같은 스냅샷(fx=rx) 후 애니를 걸어
    // 우리 블록 재배치(아래 defendDecisionFor→advanceDefenseShape의 tx/ty)도 함께
    // 부드럽게 미끄러진다. (클램프·슛 분기 뒤라 착지점=논리 위치 일치.)
    for (const p of players) { p.fx = p.rx ?? p.x; p.fy = p.ry ?? p.y; p.tx = p.x; p.ty = p.y; }
    const _stepFrom = { x: carrier.x, y: carrier.y };
    const _stepLen = dist(_stepFrom, nu);
    startAnim({ from: _stepFrom, to: { x: nu.x, y: nu.y }, lofted: _stepLen >= 26 }, flightMs(_stepLen, _stepLen >= 26), null);
    defendDecisionFor(nu);
    return { ok: true, recovered: false, step };
  }

  // 상대 슛 — 거리·수비 세움(contained)·벗겨짐(beaten)·GK 키핑으로 xG 산출.
  // 골이면 실점으로 공격 종료, 아니면 우리 GK부터 재개(공수 왕복).
  function resolveOppShot(shooter) {
    const dl = state.defenseLoop;
    const d = dist(shooter, { x: 0, y: PITCH_H / 2 });
    const gk = ours().find((p) => p.role === 'GK');
    const keeping = gk?.traits?.keeping ?? 0.72;
    // 티어 0.30/0.18/0.10 → 0.42/0.34/0.26 (8R concede-band): 회수 난이도↑로 슛
    // 도달이 늘자 저-xG 원거리 슛이 전환율을 희석(P(goal|shot) 11%)해 실점이 여전히
    // 밴드(8~18%) 미달이었다. 슛이 실제로 위협이 되도록 xG 바닥을 올려 도달한 슛의
    // 전환을 높인다(회수↓와 쌍 레버). 슈터가 사거리(x≤22)에 들면 d는 대개 22~30이라
    // 중·원거리 티어(0.34/0.26)를 크게 올려야 효과가 난다.
    // + back 오버랩이면 뒷문 노출(+0.04) — defensivePressProb의 +0.05와 쌍.
    const base = (d < 16 ? 0.42 : d < 26 ? 0.34 : 0.26) + intDef
      + (state.lineIntents.back === 'overlap' ? 0.04 : 0);
    // 바닥 0.05: 내려서기만 반복해도 '완전 무료'는 아니게 — 안전하되 긴장은 남긴다.
    const xg = clamp(base + dl.beaten * 0.06 - dl.contained * 0.04 - (keeping - 0.7) * 0.4, 0.05, 0.55);
    state.defenseLoop = null;
    state.matchDecision = null;
    logLine(t('log.defense.shot').replace('{label}', shooter.label), 'warn');
    if (rng.next() < xg) {
      endAttempt('conceded', { shooter, xg });
      return { ok: true, conceded: true, xg };
    }
    logLine(t('log.defense.saved'), 'success');
    state.possession = 'us';
    resetToKeeper(t('log.defense.restart'), 'info');
    return { ok: true, conceded: false, xg, restarted: true };
  }

  function pressureHunters(point) {
    return ours()
      .filter((p) => p.role !== 'GK')
      .map((p) => ({ p, d: dist(p, point) }))
      .filter((x) => x.d < 24)
      .sort((a, b) => a.d - b.d);
  }

  function defensivePressProb(carrier, hunters) {
    // 거리 연속 가중 — 이진 컷(14m 미만 머릿수)은 15m와 23m를 동일 취급했고,
    // 아무도 닿지 못하는 상대 후방 GK(헌터 0명)에도 base 0.22를 줬다(자기대국
    // 감사). 0m=1.0 ~ 24m=0으로 감쇄해 "닿을 수 있어야 뺏는다"를 확률에 새긴다.
    const reach = hunters.reduce((s, x) => s + Math.max(0, 1 - x.d / 24), 0);
    const front = state.lineIntents.front === 'pin' ? 0.08 : 0;
    const mid = state.lineIntents.mid === 'between' ? 0.06 : 0;
    const momentum = ((state.momentum ?? 50) - 50) / 100 * 0.12;
    const fatigue = ((state.fatigue ?? 0) / 100) * 0.16;
    const carrierCalm = (carrier.traits?.pressResistance ?? carrier.traits?.pass ?? 0.65) * 0.18;
    // back 라인 컨트롤(2R): 오버랩(풀백 전진)은 공격 보너스만 있고 수비 국면
    // 비용이 없었다 — 이미 올라가 있으니 즉시 압박 가담(+0.05), 대신 뒷문이
    // 열려 상대 슛 질↑(resolveOppShot +0.04). 공수 트레이드가 한 겹 생긴다.
    const back = state.lineIntents.back === 'overlap' ? 0.05 : 0;
    return clamp(0.10 + Math.min(reach, 3) * 0.15 + front + mid + back + momentum - fatigue - carrierCalm - intDef, 0.06, 0.74);
  }

  function openPressingMode() {
    if (state.status !== 'live' || anim || state.matchDecision || state.defensivePress) return { ok: false, rejected: true };
    const current = holder();
    const anchor = current ?? { x: 52, y: PITCH_H / 2 };
    const carrier = opps()
      .filter((p) => p.line !== 'gk')
      .sort((a, b) => dist(a, anchor) - dist(b, anchor))[0];
    if (!carrier) return { ok: false, rejected: true };
    for (const p of players) {
      p.fx = p.rx ?? p.x; p.fy = p.ry ?? p.y;
      p.tx = p.x; p.ty = p.y;
    }
    state.turn++;
    state.holderId = carrier.id;
    state.phase = 'PRESSING';
    state.currentAction = 'press_mode';
    const hunters = pressureHunters(carrier);
    const regainP = defensivePressProb(carrier, hunters);
    const cutP = clamp(regainP - 0.08 + (state.lineIntents.mid === 'support' ? 0.08 : 0), 0.1, 0.68);
    state.defensivePress = { carrierId: carrier.id, msLeft: 6000, regainP, cutP };
    state.matchDecision = {
      id: 'defensive_press',
      title: t('dec.defensive_press.title'),
      detail: t('dec.defensive_press.detail').replace('{x}', carrier.label),
      choices: [
        { id: 'dp_press', label: t('dec.defensive_press.dp_press.label'), desc: t('dec.defensive_press.dp_press.desc').replace('{n}', String(Math.round(regainP * 100))) },
        { id: 'dp_cut', label: t('dec.defensive_press.dp_cut.label'), desc: t('dec.defensive_press.dp_cut.desc').replace('{n}', String(Math.round(cutP * 100))) },
        { id: 'dp_drop', label: t('dec.defensive_press.dp_drop.label'), desc: t('dec.defensive_press.dp_drop.desc') },
      ],
    };
    addPressure(6);
    logLine(t('log.defPress.open').replace('{label}', carrier.label), 'warn');
    return { ok: true, pressing: state.defensivePress };
  }

  function resetToKeeper(message, tone = 'info') {
    const gk = ours().find((p) => p.role === 'GK') ?? ours()[0];
    if (gk) {
      state.holderId = gk.id;
      gk.orientation = 'FACING';
    }
    state.phase = 'BUILDUP';
    state.consecutiveHolds = 0;
    state.defensivePress = null;
    state.defenseLoop = null;
    state.matchDecision = null;
    state.possession = 'us';
    clearPassContext();
    addPressure(-12);
    logLine(message, tone);
  }

  function resolveDefensivePress(choiceId) {
    const pressState = state.defensivePress;
    if (!pressState) return { ok: false, rejected: true };
    const carrier = byId(pressState.carrierId) ?? holder();
    state.defensivePress = null;
    state.matchDecision = null;
    state.facts.decisionsMade++;
    if (choiceId === 'dp_drop') {
      resetToKeeper(t('log.defPress.drop'), 'info');
      return { ok: true, recovered: false };
    }
    const chance = choiceId === 'dp_cut' ? pressState.cutP : pressState.regainP;
    if (rng.next() < chance) {
      const rec = pressureHunters(carrier)[0]?.p ?? ours().find((p) => p.role !== 'GK') ?? ours()[0];
      if (rec) {
        state.holderId = rec.id;
        rec.orientation = 'FACING';
      }
      clearPassContext();
      state.phase = rec && rec.x > PHASE_LINES.PROGRESSION ? 'PROGRESSION' : 'BUILDUP';
      state.facts.defensivePressWins++;
      state.facts.situationsResolved++;
      state.consecutiveHolds = 0;
      addPressure(-14);
      logLine(choiceId === 'dp_cut'
        ? t('log.defPress.cutWin')
        : t('log.defPress.pressWin'),
      'success');
      return { ok: true, recovered: true };
    }
    logLine(choiceId === 'dp_cut'
      ? t('log.defPress.cutFail')
      : t('log.defPress.pressFail'),
    'error');
    finishAttempt('press_broken', { carrier, choiceId });
    return { ok: true, recovered: false };
  }

  function endAttempt(kind, detail) {
    state.deferredDecision = null;   // 유예된 국면 결정은 시도가 끝나면 무효(맥락 소멸 — F1)
    if (maybeOpenTransition(kind, detail)) return;
    finishAttempt(kind, detail);
  }

  // ─── line intents (§3.6/§7.6 MVP) ─────────────────────────────────────────
  // Our strategy: a per-line intent the player can switch at any time. Each
  // intent shifts where that line WANTS to be — movement happens through the
  // structure drift below, and the press reads the change with its usual
  // recognition delay (§6.4), so switching strategy mid-match opens a window.
  // off = shift of the formation home; gap = how far BELOW the offside line
  // the line sits. pin lives ON the line; drop lives between the lines.
  const INTENT_OFFSET = {
    front: { pin: { off: 0, gap: 0.5 }, drop: { off: -11, gap: 9 } },
    mid: { between: { off: 0, gap: 0.5 }, support: { off: -8, gap: 0.5 } },
    back: { overlap: { off: 14, gap: 0.5 }, hold: { off: 0, gap: 0.5 } },
  };

  function lineGroupOf(p) {
    if (p.role === 'ST' || p.role === 'W') return 'front';
    // DM belongs to 중원: without this the double pivot (6A/6B are DMs)
    // ignored the mid intent entirely — the UI promised a strategy switch
    // that moved nobody. (QA Major 4)
    if (p.role === '8' || p.role === '10' || p.role === 'DM') return 'mid';
    if (p.role === 'FB' || p.role === 'IFB') return 'back';
    return null;
  }

  // Off-ball structure (§3.1): our players drift toward where their line
  // intent wants them — capped by the offside line. The formation is desire,
  // the intent bends it, the line constrains it. Max 8m per turn.
  //
  // Team push (team_shape_advance): the whole team advances WITH the ball —
  // back line to halfway when we attack the final third, never the GK. The
  // attack must not arrive alone (measured: 0.0 support within 15m before).
  // 팀 전진 — 우리 구조가 공과 함께 올라오는 정도. 상대 압박이 커밋 시 10m/턴으로
  // 좁혀오는 데 비해 우리 전진이 느리다는 체감(측정: 0.96 vs 1.40m/턴)을 보정 —
  // k 상향 + 임계 25→18로 빌드업 초반부터 더 일찍·빠르게 따라 올라온다.
  const TEAM_PUSH = {
    front: { k: 0.32, cap: 22 },
    mid: { k: 0.55, cap: 32 },
    back: { k: 0.62, cap: 36 },
  };
  function pushGroupOf(p) {
    if (p.role === 'CB') return 'back';
    if (p.role === 'DM') return 'mid';
    return lineGroupOf(p); // ST/W → front, 8/10 → mid, FB/IFB → back
  }
  // 행동에 걸리는 시간(턴 비율) — 짧은 패스는 짧은 순간이라 양 팀이 조금만,
  // 긴 패스·운반·기다리기는 긴 순간이라 많이 움직인다. 이 dt가 원투·써드맨 같은
  // 빠른 콤비네이션을 짧은 패스 연쇄로 자연 발생시킨다(전용 버튼 불필요).
  function actionTime(type, distance) {
    if (type === 'hold') return 1.0;          // 한 박자 — 압박이 수렴
    if (type === 'run') return 0.85;
    if (type === 'carry') return clamp(0.3 + (distance ?? 7) / 22, 0.3, 0.8);
    if (distance == null) return 0.7;         // 거리 미제공 패스 → 중간
    return clamp(0.22 + distance / 34, 0.25, 1.15); // 짧을수록 짧은 시간
  }

  function ourStructureShift(dt = 1) {
    const line = offsideLine(opps());
    const h = holder();
    const ballX = h?.x ?? 20;
    const ballY = h?.y ?? PITCH_H / 2;
    // 바이라인 돌파: 홀더가 깊고(x>88) 측면(y 바깥)이면 컷백 국면 — ST가 페널티 스폿으로
    // 파고들어 풀백(뒤로 빼는 패스)을 받는다. 바이라인 패스는 오프사이드가 아니다.
    const carrierWide = !!h && (h.y < 20 || h.y > PITCH_H - 20);
    const carrierByline = carrierWide && h.x > 88;
    // 컷백 전개(도착 타이밍): 측면 캐리어가 x>66(파이널서드 위치)로 깊어지면 러너가
    // 바이라인(x>88) 도달을 기다리지 않고 미리 도착런을 시작한다. 이전엔 x>88에서야
    // 트리거돼 러너가 오프사이드 라인에 묶여 있다가 늘 늦었고 — 컷백 대상이 박스에
    // 없었다(실플레이 확인). 위치 기반이라 phase 갱신 지연(maybeAdvancePhase가
    // pressReact 뒤)에도 즉시 켜진다. 측면 전진에만 반응하므로 중앙 빌드업엔 무영향.
    const cutbackDeveloping = carrierByline || (carrierWide && h.x > 66);
    const carrierSide = h ? (h.y < PITCH_H / 2 ? 'low' : 'high') : null;
    // 지원 앵커: 컷백 전개 시 가장 깊은 중앙 미드(DM/6/8) 한 명을 골라 캐리어 뒤에
    // 남겨 짧은 안전 리사이클 아웃렛을 만든다. 포메이션마다 role 문자열이 달라
    // (DM/8/6) 문자열이 아닌 homeX 최소값으로 선정. 없으면 앵커 없음.
    let anchorId = null;
    if (cutbackDeveloping) {
      const pivots = ours().filter((p) => ['DM', '6', '8'].includes(p.role));
      pivots.sort((a, b) => a.homeX - b.homeX);
      anchorId = pivots[0]?.id ?? null;
    }

    // Y-pull strengths per line — mids track the ball side most aggressively,
    // backs shift with the block, forwards keep formation width to stretch the
    // defensive line and only compress late into the box.
    const Y_PULL = { front: 0.14, mid: 0.28, back: 0.20 };

    for (const p of ours()) {
      if (p.role === 'GK' || p.id === state.holderId) continue;
      const grp = lineGroupOf(p);
      const cfg = grp ? (INTENT_OFFSET[grp][state.lineIntents[grp]] ?? { off: 0, gap: 0.5 }) : { off: 0, gap: 0.5 };
      const pushCfg = TEAM_PUSH[pushGroupOf(p)] ?? { k: 0, cap: 0 };
      const push = clamp((ballX - 18) * pushCfg.k, 0, pushCfg.cap);
      // 90 cap: off-ball players hold the box edge — camping the goalmouth
      // ratchets the opp line backward via separation. (P1a)
      // 오프볼 침투런: 전방 선수(ST/W)는 빌드업을 벗어나면 오프사이드 라인 끝까지
      // 적극 전진해 공보다 앞서고(전진 패스 옵션), 라인이 물러나면 배후를 노린다.
      // 온사이드를 유지하므로 공짜 오프사이드가 아니라 "라인을 끌어내려" 공간을 연다.
      const isRunner = (p.role === 'ST' || p.role === 'W');
      const isLateRunner = (p.role === '8' || p.role === '10') && state.phase === 'FINAL_THIRD';
      const advancing = state.phase === 'PROGRESSION' || state.phase === 'FINAL_THIRD' || ballX > 42;
      // 반대쪽 윙(캐리어 반대편)은 백포스트로 침투 — 컷백/크로스의 제2 도착 옵션.
      const farSideW = p.role === 'W' && carrierSide
        && ((carrierSide === 'low' && p.homeY > PITCH_H / 2) || (carrierSide === 'high' && p.homeY < PITCH_H / 2));
      // 지원 앵커: 측면 높이 커밋 시 피벗('6')은 박스로 쇄도하지 않고 캐리어 ~13m
      // 뒤·안쪽에 남아 짧은 안전 리사이클(백패스) 아웃렛을 제공한다. 이게 없으면
      // 가장 가까운 후방 동료도 25~35m라 리사이클이 롱볼 리스크가 커 — 캐리어가
      // 고립돼 "읽히면 그냥 잃던" 문제의 짝. 전방은 쇄도, 한 명은 탈출구로 트레일.
      const isSupportAnchor = cutbackDeveloping && p.id === anchorId;
      // 도착런의 합법 깊이 — 오프사이드 준수(패스 순간 위치 기준). 라인까지, 또는
      // 캐리어가 더 깊으면(바이라인 돌파) 캐리어 뒤까지 허용(백패스 예외로 온사이드).
      // 이전엔 페널티 스폿(93)/백포스트(98) 무조건 목표라 라인(~88.5) 위 4~9m 주차 —
      // pass_space의 오프사이드 미검사 버그를 통해서만 서빙 가능했다(2026-07 감사 C3).
      const legalDepth = Math.max(line - 0.6, (h?.x ?? 0) - 1);
      let want;
      if (cutbackDeveloping && (p.role === 'ST' || p.role === '10')) {
        // 컷백 도착: 페널티 스폿 방향으로 최대 합법 깊이까지 — 캐리어가 바이라인이면
        // 그 뒤(x≈캐리어-1)까지 들어가 컷백 존(x>90.5)에서 풀백을 받는다.
        want = clamp(Math.min(PITCH_W - 12, legalDepth), 4, PITCH_W - 3);
      } else if (cutbackDeveloping && farSideW) {
        // 백포스트 도착 — 합법 깊이 안에서 반대쪽 포스트 라인으로.
        want = clamp(Math.min(PITCH_W - 7, legalDepth), 4, PITCH_W - 3);
      } else if (isSupportAnchor) {
        want = clamp((h?.x ?? ballX) - 13, 4, PITCH_W - 3);   // 캐리어 뒤 지원
      } else if (isRunner && advancing) {
        const depthCap = state.phase === 'FINAL_THIRD' ? 97 : 95;   // 파이널서드선 박스 가장자리까지 침투
        want = clamp(Math.min(line - 0.6, depthCap), 4, PITCH_W - 3);
      } else if (isLateRunner) {
        // 서드맨 런: 8/10이 파이널서드에 박스 가장자리로 늦게 침투 — 중앙 마무리 옵션(다양성).
        want = clamp(Math.min(line - 3.5, 93), 4, PITCH_W - 3);
      } else {
        want = clamp(Math.min(p.homeX + push + cfg.off, line - cfg.gap, 95), 4, PITCH_W - 3);
      }
      const dx = want - p.x;
      const isArrivalRunner = cutbackDeveloping && (p.role === 'ST' || p.role === '10' || farSideW);
      if (isArrivalRunner) {
        // 컷백 도착런: 액션당 이동이 dt(≈0.3 고정)로 작아 고정거리로는 3~4액션짜리
        // 돌파에서 러너가 박스에 못 닿았다(컷백 대상 부재의 근본 원인). 한 액션은
        // ≈수 초를 압축하므로 스프린트로 갭의 큰 비율을 좁힌다 — 캐리어의 바이라인
        // 도달에 맞춰 페널티 스폿/백포스트에 실제로 도착.
        p.x = clamp(p.x + dx * 0.6, 2, PITCH_W - 2);
        p.tx = p.x;
      } else if (isSupportAnchor) {
        // 앵커도 캐리어(액션당 크게 전진)를 따라붙어 리사이클 거리(~13m)를 유지하도록
        // 비율 close로 페이스를 맞춘다. 고정거리(16·dt)로는 캐리어에 뒤처졌다.
        p.x = clamp(p.x + dx * 0.5, 2, PITCH_W - 2);
        p.tx = p.x;
      } else if (Math.abs(dx) > 0.3) {
        p.x = clamp(p.x + Math.sign(dx) * Math.min(10 * dt, Math.abs(dx)), 2, PITCH_W - 2);
        p.tx = p.x;
      }

      // ── Y-axis drift (formation-live shape) ────────────────────────────
      // Each player tracks their homeY PLUS a ball-side pull. This makes
      // mids naturally compress toward the ball-side half, back line shifts
      // with the block, and forwards maintain width (low pull factor) to keep
      // the defensive line stretched. In FINAL_THIRD, wide players compress
      // inward toward the box so they arrive at realistic scoring positions.
      const yPull = Y_PULL[grp] ?? 0.10;
      let wantY = p.homeY + (ballY - p.homeY) * yPull;

      if (cutbackDeveloping && (p.role === 'ST' || p.role === '10')) {
        // 컷백 도착 — 페널티 스폿 중앙(컷백 존)으로 강하게 좁힘.
        wantY = lerp(wantY, PITCH_H / 2, 0.65);
      } else if (cutbackDeveloping && farSideW) {
        // 백포스트 — 캐리어 반대쪽 포스트 라인으로.
        const backPost = carrierSide === 'low' ? PITCH_H / 2 + 8 : PITCH_H / 2 - 8;
        wantY = lerp(wantY, backPost, 0.6);
      } else if (isSupportAnchor) {
        // 지원 앵커는 캐리어와 중앙 사이 안쪽으로 — 짧고 안전한 리사이클 각도.
        wantY = lerp(ballY, PITCH_H / 2, 0.5);
      } else if (state.phase === 'FINAL_THIRD') {
        if (p.role === 'W') {
          // Wingers tuck in toward their near-post angle — not the centre,
          // so they arrive on the edge of the box rather than crowding the 6yd.
          const nearPost = p.homeY < PITCH_H / 2 ? PITCH_H / 2 - 9 : PITCH_H / 2 + 9;
          wantY = lerp(wantY, nearPost, 0.45);
        } else if (p.role === 'ST') {
          // Striker gravitates to penalty-spot Y — slight pull from ball side
          // so a cross from either flank finds them near the centre.
          wantY = lerp(wantY, PITCH_H / 2, 0.35);
        } else if (p.role === '8' || p.role === '10') {
          // 서드맨 늦은 침투 — 중앙 박스로 살짝 좁혀 마무리 지점에 도착.
          wantY = lerp(wantY, PITCH_H / 2, 0.3);
        }
      }

      const dy = clamp(wantY, 2, PITCH_H - 2) - p.y;
      if (isArrivalRunner || isSupportAnchor) {
        // 도착런/지원 앵커는 x와 함께 y도 같은 비율로 좁혀 제자리(컷백 존/안쪽 지원)에 도달.
        p.y = clamp(p.y + dy * 0.6, 2, PITCH_H - 2);
        p.ty = p.y;
      } else if (Math.abs(dy) > 0.3) {
        p.y = clamp(p.y + Math.sign(dy) * Math.min(6 * dt, Math.abs(dy)), 2, PITCH_H - 2);
        p.ty = p.y;
      }
    }
  }

  // ─── press reaction + post-receive bookkeeping ───────────────────────────
  let shapePendingLogged = false;
  function pressReact(event) {
    const dt = actionTime(event.type, event.dist);
    event.dt = dt;                 // press.js가 같은 시간으로 수비 이동을 스케일
    ourStructureShift(dt);
    // 자연 상승 +2/액션 — 시간이 갈수록 상대 블록이 자리 잡는다. 감소 항만 있던
    // 게이지 경제(중앙값 0, 베이트 0회/경기 — 자기대국 감사)에 유입원을 만들어
    // "압박 유인" 루프(hold 후보·커밋 유도)가 경제에 복귀할 토대.
    addPressure(2);
    const reaction = press.react(state, event, rng);
    // §6.4 shape reading: surface the recognition delay so the player can
    // feel (and exploit) the window before the press adjusts.
    if (reaction.shapeAdapted) {
      logLine(t('log.shapeAdapted').replace('{x}', reaction.shapeAdapted), 'warn');
      shapePendingLogged = false;
    } else if (reaction.shapePending && !shapePendingLogged) {
      logLine(t('log.shapePending'), 'info');
      shapePendingLogged = true;
    } else if (!reaction.shapePending) {
      shapePendingLogged = false;
    }
    if (reaction.rewardWindow) {
      state.rewardWindow = reaction.rewardWindow;
      if (reaction.rewardWindow.kind === 'real') {
        logLine(t('log.committerJump').replace('{label}', byId(reaction.committerId)?.label ?? t('log.presser')), 'success');
      }
    }
    // Counter-drop fork log: when a marker chooses to HOLD rather than follow
    // the drop, the dropped player is open. Surface this immediately so the
    // player knows to exploit it before the situation closes.
    if (reaction.forkHeld?.length > 0) {
      const mark = byId(reaction.forkHeld[0].markId);
      if (mark) logLine(t('log.forkHeld').replace('{label}', jl(mark.label, '이', '가')), 'success');
    }
    // Beaten defenders are frozen inside positionBlock (separation-aware);
    // here we only tick the freeze down.
    for (const d of opps()) {
      if (d.beatenTurns > 0) d.beatenTurns--;
    }
    return reaction;
  }

  // After the ball arrives and the block shifts: did the receiver survive?
  // Trapped = SURROUNDED (2+ defenders converging within 4.5m) with no
  // escape lane — not mere marker proximity, since tokens never overlap.
  function receiverTrapCheck(receiver) {
    const defsAtTargets = opps().map((d) => ({ ...d, x: d.tx, y: d.ty }));
    const surrounders = defsAtTargets
      .filter((d) => d.line !== 'gk' && dist(receiver, d) < 4.5).length;
    if (surrounders < 2) return false;
    const escapes = ours().filter((m) => m.id !== receiver.id)
      .map((m) => evaluateLane(receiver, m, defsAtTargets, { rewardWindow: activeWindow() }))
      .filter((e) => e.risk < 0.5).length;
    if (escapes > 0) return false;
    const trapProb = clamp(0.3 * (surrounders - 1), 0, 0.75) * (1.15 - (receiver.traits?.pressResistance ?? 0.6));
    return rng.next() < trapProb;
  }

  // 공간 지향 패스 — 실패 시 착지 경합(spatial-pass-redesign Inc.1).
  // 패스가 깨끗이 안 닿았을 때(rollFail), 그게 즉시 턴오버인지 루즈볼인지를
  // 근접으로 판정: 러너(receiver)가 최근접 수비수와 비등하게 가까우면 세컨볼 경합
  // (50% us 되찾기, 압박 속에) — "한 턴 뒤면 따낼 수 있는데 실패" 문제 해결.
  // 수비수가 확실히 장악하면 탈취(→전환 창). us는 깨끗 성공 경로에서 처리.
  function resolveLanding(landing, receiver) {
    let no = null, do_ = Infinity;
    for (const d of opps()) {
      if (d.line === 'gk') continue;
      const dd = dist(d, landing);
      if (dd < do_) { do_ = dd; no = d; }
    }
    const du = receiver ? dist(receiver, landing) : Infinity;
    // 착지 경합 — 도착 우위를 반영(기존 단조로운 50/50 제거). 러너가 착지점에
    // 명백히 가까울수록(margin↑) 확실히 이기고, 수비수가 더 가까우면 뺏긴다.
    // "우리가 먼저 잡을 공간"이면 실제로 대체로 잡는다.
    const margin = do_ - du;                              // 양수면 우리가 앞섬(m)
    // dead-heat(margin 0)는 수비수 약간 우세(0.42) — 진짜 50/50 볼은 깔끔히 잡기 어렵다.
    // 러너가 명백히 앞설수록 급격히 우리 쪽(최대 0.88). 우위가 결과를 가른다.
    const usWinP = clamp(0.42 + margin * 0.1, 0.06, 0.88);
    if (rng.next() < usWinP) return { result: 'loose', receiver, winner: receiver };
    return { result: 'opp', winner: no };
  }

  // 수신 자세 예측 — "이 지점에서 받으면 어떤 몸으로 받나"(결정적). 최근접 수비수가
  // 골 사이드(전방 차단)·근접이면 갇힘(등짐), 멀면 자유 전진. viz가 조준 시 표시.
  function predictReception(point) {
    let dno = Infinity, ndef = null;
    for (const d of opps()) {
      if (d.line === 'gk') continue;
      const od = dist(d, point);
      if (od < dno) { dno = od; ndef = d; }
    }
    const goalSide = ndef && ndef.x > point.x - 1.5;
    return (dno <= 3.5 && goalSide) ? 'trapped' : dno <= 6 ? 'pressured' : 'free';
  }

  // Preview-side trap read (QA Major 1): the same surrounded/no-exit test the
  // resolver rolls AFTER arrival, evaluated on current positions so the
  // preview can warn BEFORE the pass. A lane the engine may kill on arrival
  // must never read '안전'.
  function previewTrapRisk(point, excludeId, traits) {
    const defs = opps();
    const surrounders = defs.filter((d) => d.line !== 'gk' && dist(point, d) < 4.5).length;
    if (surrounders < 2) return 0;
    const escapes = ours().filter((m) => m.id !== excludeId)
      .map((m) => evaluateLane(point, m, defs, {}))
      .filter((e) => e.risk < 0.5).length;
    if (escapes > 0) return 0;
    return clamp(0.3 * (surrounders - 1), 0, 0.75) * (1.15 - (traits?.pressResistance ?? 0.6));
  }

  // Fold trap risk into a preview evaluation: combined probability, status
  // rethresholded, `trap` exposed for the UI's '고립 주의' tag.
  function withTrap(ev, point, excludeId, traits, kind = 'lane') {
    const trap = previewTrapRisk(point, excludeId, traits);
    if (trap <= 0.02) return { ...ev, trap: 0 };
    const risk = clamp(1 - (1 - ev.risk) * (1 - trap), 0.02, 0.97);
    const status = kind === 'landing'
      ? (risk < 0.3 ? 'open' : risk < 0.6 ? 'contested' : 'dead')
      : (risk < 0.28 ? 'safe' : risk < 0.58 ? 'risky' : 'cut');
    return { ...ev, risk, status, trap };
  }

  // One phase per action: even a great ball forward earns one step of
  // progression, never a build-up→final-third skip.
  function maybeAdvancePhase() {
    const h = holder();
    if (state.phase === 'BUILDUP' && h.x > PHASE_LINES.PROGRESSION) {
      state.phase = 'PROGRESSION';
      addPressure(-10);
      // Surface a free intermediate receiver so the player knows WHO to find.
      const midFree = ours()
        .filter((p) => p.id !== h.id && (p.role === '8' || p.role === '10' || p.role === 'DM'))
        .map((p) => ({ p, ev: evaluateLane(h, p, opps(), {}) }))
        .filter((o) => o.ev.risk < 0.45)
        .sort((a, b) => b.p.x - a.p.x)[0];
      const tip = midFree
        ? t('log.tip.midFree').replace('{label}', jl(midFree.p.label, '이', '가'))
        : t('log.tip.midGeneric');
      logLine(t('log.phase.progression').replace('{tip}', tip), 'success');
    } else if (state.phase === 'PROGRESSION' && h.x > PHASE_LINES.FINAL_THIRD) {
      state.phase = 'FINAL_THIRD';
      addPressure(-6);
      // Suggest the scenario target shot or the most open finishing runner.
      const targetTip = state.scenario?.targetShot
        ? t('log.tip.target').replace('{x}', state.scenario.targetShot)
        : '';
      const boxRunner = ours()
        .filter((p) => p.id !== h.id && (p.role === 'W' || p.role === 'ST'))
        .map((p) => ({ p, ev: evaluateLane(h, p, opps(), {}) }))
        .filter((o) => o.ev.risk < 0.50)
        .sort((a, b) => a.ev.risk - b.ev.risk)[0];
      const runTip = boxRunner ? t('log.tip.runner').replace('{label}', boxRunner.p.label) : '';
      logLine(t('log.phase.finalThird').replace('{target}', targetTip).replace('{run}', runTip), 'success');
    }
  }

  function windowUseCheck(point) {
    const w = activeWindow();
    if (w && w.kind === 'real' && dist(point, w) < w.r) {
      state.facts.windowsUsed++;
      addPressure(-8);
      state.rewardWindow = null;
      return true;
    }
    return false;
  }

  function passTriggerFor(from, to, target) {
    if (target.role === 'GK') return 'gkpass';
    if (to.x < from.x - 3) return 'backpass';
    if (to.y < 8.5 || to.y > PITCH_H - 8.5) return 'wideReceive';
    if (target.role === 'DM' && state.phase === 'BUILDUP') return 'pivotPass';
    return 'pass';
  }

  function isOffside(point) {
    // 오프사이드는 "공보다 앞선" 선수에게만 적용된다. 공보다 뒤(골에서 먼 쪽)로
    // 빼주는 패스(바이라인 풀백=컷백, 백패스)의 수신자는 라인 너머라도 온사이드.
    if (point.x <= (holder()?.x ?? 0)) return false;
    return point.x > offsideLine(opps()) + 0.2;
  }

  // 볼 물리(2026-07 실시간 v2): 비행시간 = 거리 비례(지상 ~30m/s대, 로빙은 느리고
  // 최소 체공 보장). 고정 650/900ms는 5m 리턴패스와 40m 대각을 같은 속도로 그려
  // 물리감이 없었다.
  function flightMs(len, lofted) {
    return lofted ? clamp(420 + len * 38, 650, 1700) : clamp(200 + len * 30, 340, 1300);
  }

  // ─── shared pass resolution ───────────────────────────────────────────────
  function resolvePassTo(target, { lofted = false, viaLabel = null, extraRisk = 0, autoLob = false } = {}) {
    const from = holder();
    if (isOffside(target)) {
      return fail(t('log.offside').replace('{label}', jl(target.label, '은', '는')));
    }
    // Lob option — a RESCUE, not an optimizer (review Major 4): only when the
    // ground lane is genuinely cut (≥0.45) and the chip is clearly better.
    // Range and accuracy obey the kicker's longPass (Major 2): a striker
    // can't ping 70m diagonals just because the ground lane is blocked.
    let useLofted = lofted;
    let ev = evaluateLane(from, target, opps(), { lofted: useLofted, rewardWindow: activeWindow() });
    if (autoLob && !lofted && ev.risk >= 0.45) {
      const lp = from.traits?.longPass ?? 0.4;
      const len = dist(from, target);
      const maxLob = 24 + lp * 46; // longPass .3 ≈ 38m, .8 ≈ 61m
      if (len >= 14 && len <= maxLob) {
        const lob = evaluateLane(from, target, opps(), { lofted: true, rewardWindow: activeWindow() });
        const lobRisk = clamp(lob.risk + (1 - lp) * 0.15, 0.02, 0.97);
        if (lobRisk + 0.08 < ev.risk) { ev = { ...lob, risk: lobRisk }; useLofted = true; }
      }
    }
    const skill = (from.traits?.pass ?? 0.7);
    // Orientation risk modifier (P1 posture grammar): a BACK-oriented holder
    // trying to pass forward is essentially attempting a blind spin — steep
    // penalty. HALF adds a small difficulty for forward balls. Backward passes
    // (GK, recycle) are unaffected regardless of orientation.
    const isForwardPass = target.x > from.x + 2;
    const orientMod = from.orientation === 'BACK' && isForwardPass ? 0.35
      : from.orientation === 'HALF' && isForwardPass ? 0.12
      : 0;
    const baseRisk = edgeRelief(clamp(ev.risk * (1.15 - skill * 0.3) + extraRisk + orientMod, 0.02, 0.97), target);
    const risk = clamp(baseRisk * tacRiskMul(state.currentAction), 0.02, 0.97);

    if (rollFail(risk)) {
      // Intercepted mid-flight.
      const interceptor = ev.interceptor ?? nearestDefender(target, opps()).defender;
      const cutPoint = interceptor
        ? { x: (from.x + target.x) / 2 * 0.4 + interceptor.x * 0.6, y: (from.y + target.y) / 2 * 0.4 + interceptor.y * 0.6 }
        : { x: target.x, y: target.y };
      pressReact({ type: 'pass', trigger: 'pass' });
      startAnim({ from: { x: from.x, y: from.y }, to: cutPoint, lofted: useLofted }, flightMs(dist(from, cutPoint), useLofted), () => {
        endAttempt('intercepted', { interceptor, reason: ev.reason, risk });
      });
      return { ok: false };
    }

    const fromPos = { x: from.x, y: from.y };
    // 런과 패스의 연결(2026-07 실시간 v2) — 수신 지점 결정:
    //  · 리시버가 런 중(실시간 속도 벡터 >0.6m/s — 오버랩·어깨런 등)이면 진행 방향
    //    '앞'으로 리드해 발 앞에 꽂는다. 패스 순간 온사이드였으므로(위 isOffside)
    //    착지가 라인 뒤라도 적법 — 런 온투 더 볼, 축구 규칙 그대로.
    //  · 정지 수신이면 볼을 마중 나와 터치(패서 쪽으로 한 발) — 서서 기다리지 않는다.
    // 위험(risk)은 패스 순간 지오메트리로 이미 롤됨 — 리드는 ≤4.5m 소폭이라 근사 유지.
    const lenRaw = dist(from, target);
    const durMs = flightMs(lenRaw, useLofted);
    {
      const vx = target._vx ?? 0, vy = target._vy ?? 0, spd = Math.hypot(vx, vy);
      let rx = target.x, ry = target.y;
      if (spd > 0.6) {
        const lead = Math.min(4.5, spd * (durMs / 1000) * 0.9);
        rx += vx / spd * lead; ry += vy / spd * lead;
      } else if (!useLofted && lenRaw > 8) {
        const meet = Math.min(1.6, lenRaw * 0.1);
        rx += (from.x - target.x) / (lenRaw || 1) * meet;
        ry += (from.y - target.y) / (lenRaw || 1) * meet;
      }
      rx = clamp(rx, 1.5, PITCH_W - 1.5); ry = clamp(ry, 1.5, PITCH_H - 1.5);
      target.x = rx; target.y = ry; target.tx = rx; target.ty = ry;
    }
    const broken = linesBroken(fromPos, target, opps());
    state.facts.linesBroken += broken;
    // 바이라인 컷백 판정은 pass_space 경로(아래)와 술어를 일치시킨다 — 수신 지점이
    // 박스 안(x>88)일 때만. (shots.js가 슈터 x도 재검사하므로 동작 불변, 정합성만 확보.)
    state.lastPassFromByline = fromPos.x > 90 && (fromPos.y < 16 || fromPos.y > PITCH_H - 16)
      && Math.abs(target.y - PITCH_H / 2) < 14 && target.x > 88;
    state.lastPassLofted = useLofted;
    // A header chance needs a CROSS — wide origin, central box arrival. A
    // central chip is not a cross (Major 3).
    state.lastPassCross = useLofted
      && Math.abs(fromPos.y - PITCH_H / 2) > 16
      && Math.abs(target.y - PITCH_H / 2) < 12
      && target.x > 78;
    state.holderId = target.id;
    state.consecutiveHolds = 0;
    // Posture grammar (P1): set receiver orientation at arrival. Lofted
    // reception = moving → FACING; ground pass = check defender proximity.
    target.orientation = computeOrientation(target, opps(), { moving: useLofted });

    // -6→-3/개 (4R 플랜 B): 라인 브레이크는 경기당 ~4회로 최다 빈도 유출이라
    // 게이지가 상시 0에 붙어(중앙값 2) 압박 유인 루프가 경제에서 퇴출돼 있었다.
    // 큰 마일스톤 보상(페이즈 전환 -10/-6, 창사용 -8)은 유지 — 잦은 것만 절반.
    if (broken > 0) addPressure(-3 * broken);
    const usedWindow = windowUseCheck(target);

    const trigger = passTriggerFor(fromPos, target, target);
    if (trigger === 'gkpass') addPressure(8);
    else if (trigger === 'backpass') addPressure(4);

    pressReact({ type: 'pass', trigger, dist: dist(from, target) });
    maybeAdvancePhase();

    const trapped = receiverTrapCheck(target);
    startAnim({ from: fromPos, to: { x: target.x, y: target.y }, lofted: useLofted }, durMs, () => {
      if (trapped) {
        endAttempt('trapped', { holder: target });
      }
    });

    let msg = viaLabel ? `${viaLabel} → ${target.label}` : t('log.pass.toTarget').replace('{label}', target.label);
    if (useLofted && !lofted) msg += t('log.pass.lofted');
    if (broken > 0) msg += t('log.pass.linesBroken').replace('{x}', String(broken));
    if (usedWindow) msg += t('log.pass.window');
    const _hint = _quickHint(target);
    if (_hint) msg += ` ${_hint}`;
    logLine(msg, broken > 0 || usedWindow ? 'success' : 'info');
    return { ok: true };
  }

  // ─── actions ──────────────────────────────────────────────────────────────
  const actions = {
    to_feet(targetId) {
      const target = byId(targetId);
      if (!target || target.side !== 'us' || target.id === state.holderId) return fail(t('log.fail.toFeet'));
      return resolvePassTo(target, { autoLob: true });
    },

    // 공간 지향 패스(Inc.2): 임의 지점으로 패스 → 정확도만큼 산포된 착지점에서
    // 가장 가까운 us가 받음(또는 실패 시 착지 경합). 전환(롱·측면)도 이 하나로
    // 흡수 — 멀면 자동 로빙. 발밑(to_feet)은 선수 선택으로 별도 유지.
    pass_space(_t, point) {
      const from = holder();
      if (!point) return fail(t('log.fail.passPoint'));
      const aim = { x: clamp(point.x, 2, PITCH_W - 2), y: clamp(point.y, 2, PITCH_H - 2) };
      const d = dist(from, aim);
      if (d < 4) return fail(t('log.fail.tooClose'));
      const lofted = d > 28;
      if (lofted && (from.traits?.longPass ?? 0) < LONG_PASS_GATE) {
        return fail(t('log.fail.longRange').replace('{label}', from.label));
      }
      // 정확도 산포 — 거리·패스 능력치·몸 방향(등질수록 부정확). 능력치가 해결.
      const pass = from.traits?.pass ?? 0.7;
      // 몸 방향 — 향한 쪽 패스는 정확, 등 뒤(특히 BACK 자세의 전방)는 부정확.
      // viz 로브와 동일한 모델: 정렬되면 페널티 0, 정반대면 최대.
      const facing = from.orientation === 'BACK' ? Math.PI : 0;
      const baseFrac = from.orientation === 'BACK' ? 0.32 : from.orientation === 'HALF' ? 0.45 : 0.6;
      const passAngle = Math.atan2(aim.y - from.y, aim.x - from.x);
      const lobe = baseFrac + (1 - baseFrac) * (1 + Math.cos(passAngle - facing)) / 2;
      const orient = 1 + (1 - lobe) * 1.3;   // 정렬 1.0 ~ 정반대 ~1.9
      const spread = clamp((d / 30) * (1.25 - pass) * orient, 0, 1) * 6; // 최대 ~6m
      const ang = rng.next() * Math.PI * 2;
      const mag = spread * rng.next();
      const landing = {
        x: clamp(aim.x + Math.cos(ang) * mag, 2, PITCH_W - 2),
        y: clamp(aim.y + Math.sin(ang) * mag, 2, PITCH_H - 2),
      };
      // 누가 받나 — 착지점 최근접 us(GK·홀더 제외)가 AI로 받는다.
      let nu = null, du = Infinity;
      for (const p of ours()) {
        if (p.role === 'GK' || p.id === state.holderId) continue;
        const dd = dist(p, landing);
        if (dd < du) { du = dd; nu = p; }
      }
      if (!nu) return fail(t('log.fail.noReceiver'));
      // 오프사이드 — 공간 패스도 수신자 "패스 순간" 위치로 판정한다(to_feet과 동일 규칙).
      // 착지점이 라인 뒤인 것은 합법(그게 스루볼) — 수신자가 라인보다 앞서 있으면 반칙.
      // 백패스/컷백 예외(수신자가 공보다 뒤)는 isOffside가 처리. (2026-07 감사 C2)
      if (isOffside(nu)) {
        return fail(t('log.offside').replace('{label}', jl(nu.label, '은', '는')));
      }
      const ev = evaluateLane(from, landing, opps(), { lofted, rewardWindow: activeWindow() });
      const reachPenalty = clamp((du - 6) / 16, 0, 0.4); // 동료가 착지점에서 멀면 위험↑
      // 깊이 방향 스루볼은 스위퍼 키퍼의 공간 — GK 레이스로 가격 책정(evaluateLanding과
      // 동일 모델). 컷백/스퀘어(전진 성분 ≤2m)는 낮은 되돌림이라 GK 소유가 아니므로 제외.
      const gkRace = landing.x > from.x + 2 ? sweeperRisk(landing, nu, opps()) : 0;
      const risk = clamp((Math.max(ev.risk, gkRace) + reachPenalty) * (1.1 - pass * 0.25) * tacRiskMul(state.currentAction), 0.02, 0.97);

      const fromPos = { x: from.x, y: from.y };
      let loose = false;
      if (rollFail(risk)) {
        const c = resolveLanding(landing, nu);
        if (c.result !== 'loose') {
          const interceptor = c.winner ?? ev.interceptor ?? nearestDefender(landing, opps()).defender;
          // 컷백 자책골(실제 자책골 1위 유형): 바이라인에서 박스로 낮게 깔린 공간 패스를
          // 깊은 수비수가 걷어내려다 자기 골문으로. 공간볼이 박스를 가로지를 때 "터진다".
          const isCutback = fromPos.x > 90 && (fromPos.y < 16 || fromPos.y > PITCH_H - 16)
            && Math.abs(landing.y - PITCH_H / 2) < 14 && landing.x > 88;
          if (isCutback && interceptor && interceptor.x > 92 && rng.next() < 0.16) {
            pressReact({ type: 'pass', trigger: 'pass' });
            startAnim({ from: fromPos, to: { x: interceptor.x, y: interceptor.y }, lofted }, 620, () => {
              endAttempt('own_goal', { interceptor });
            });
            return { ok: false };
          }
          pressReact({ type: 'pass', trigger: 'pass' });
          startAnim({ from: fromPos, to: landing, lofted }, lofted ? 950 : 700, () => {
            endAttempt('intercepted', { interceptor, reason: 'contest', risk });
          });
          return { ok: false };
        }
        loose = true;
      }
      state.facts.linesBroken += linesBroken(fromPos, landing, opps());
      const isSwitch = Math.abs(fromPos.y - landing.y) > 16;
      if (isSwitch) state.facts.switches++;   // 측면 전환(16m+ 대각) → 측면 정체성
      state.lastWasSwitch = isSwitch;          // 연속 스위치 쿨다운용(탁구질 억제)
      nu.tx = landing.x; nu.ty = landing.y; nu.x = landing.x; nu.y = landing.y;
      state.holderId = nu.id;
      state.consecutiveHolds = 0;
      nu.orientation = computeOrientation(nu, opps(), { moving: true });
      state.lastPassLofted = lofted;
      // 컷백 = 공간 패스: 바이라인(from x>90·측면)에서 박스 중앙 공간으로 빼주면 컷백.
      // 받은 선수가 컷백 존이면 높은 xG. (발밑이 아닌 공간으로 — 뛰어드는 것)
      state.lastPassFromByline = fromPos.x > 90 && (fromPos.y < 16 || fromPos.y > PITCH_H - 16)
        && Math.abs(landing.y - PITCH_H / 2) < 14 && landing.x > 88;
      state.lastPassCross = lofted && Math.abs(fromPos.y - PITCH_H / 2) > 16 && Math.abs(landing.y - PITCH_H / 2) < 12 && landing.x > 78;
      windowUseCheck(landing);
      if (loose) { addPressure(10); state.facts.secondBalls = (state.facts.secondBalls || 0) + 1; }
      // -5→-2→0 (4R 플랜 B 확정): 지배 액션(pass_space)의 게이지 유출은 전액 제거.
      // 전진 보상은 페이즈 전환(-10/-6)과 창사용(-8)에 이미 있다 — 잦은 액션이
      // 자원을 공짜로 깎으면 게이지 중앙값이 0-8에 붙어 유인 루프가 죽는다.
      else { addPressure(0); }
      const trigger = passTriggerFor(fromPos, landing, nu);
      pressReact({ type: 'pass', trigger, dist: dist(fromPos, landing) });
      maybeAdvancePhase();
      const trapped = receiverTrapCheck(nu);
      startAnim({ from: fromPos, to: landing, lofted }, lofted ? 950 : 700, () => {
        if (trapped) endAttempt('trapped', { holder: nu });
      });
      logLine(loose
        ? t('log.pass.secondBall').replace('{label}', jl(nu.label, '이', '가'))
        : t('log.pass.received').replace('{label}', jl(nu.label, '이', '가')),
        loose ? 'warn' : 'success');
      return { ok: true };
    },

    hold() {
      state.consecutiveHolds++;
      state.facts.baits++;
      // Shot context describes HOW the holder received — after standing on
      // the ball it no longer applies (QA Major 2: stale header/cutback zones).
      state.lastPassLofted = false;
      state.lastPassFromByline = false;
      state.lastPassCross = false;
      addPressure(10 + state.consecutiveHolds * 3);
      // Orientation may degrade as defenders close in during a hold.
      const h = holder();
      if (h) {
        const prevOrient = h.orientation;
        h.orientation = computeOrientation(h, opps());
        if (prevOrient !== 'BACK' && h.orientation === 'BACK') {
          logLine(t('log.holdBlocked').replace('{label}', jl(h.label, '이', '가')), 'warn');
        } else if (h.orientation === 'BACK') {
          const _escHint = _quickHint(h);
          if (_escHint) logLine(t('log.holdBackPersist').replace('{x}', _escHint.replace('→ ', '')), 'warn');
        }
      }
      const reaction = pressReact({ type: 'hold', trigger: 'hold' });
      if (state.pressure >= 100) {
        startAnim(null, 400, () => endAttempt('collapsed', {}));
        return { ok: true };
      }
      if (reaction.decision === 'full_commit') {
        // window log already emitted in pressReact
      } else if (reaction.decision === 'drop_off') {
        logLine(t('log.hold.dropOff'), 'info');
      } else {
        logLine(t('log.hold.squeeze'), 'warn');
      }
      startAnim(null, 450, null);
      return { ok: true };
    },

    carry(_targetId, point) {
      const h = holder();
      if (!point) return fail(t('log.fail.carryPoint'));
      const { to, risk, tackler } = planCarry(h, point);

      if (rollFail(risk)) {
        pressReact({ type: 'carry', trigger: 'carry', dist: dist(h, to) });
        startAnim({ from: { x: h.x, y: h.y }, to, lofted: false, withHolder: true }, 650, () => {
          endAttempt('tackled', { interceptor: tackler, risk });
        });
        return { ok: false };
      }

      const fromPos = { x: h.x, y: h.y };
      state.facts.linesBroken += linesBroken(fromPos, to, opps());
      h.x = to.x; h.y = to.y; h.tx = to.x; h.ty = to.y;
      state.lastPassLofted = false;   // dribbled — any aerial context is gone
      state.lastPassFromByline = false;
      state.lastPassCross = false;
      addPressure(4);
      state.facts.baits++; // a carry at the block is an invitation
      pressReact({ type: 'carry', trigger: 'carry', dist: dist(h, to) });
      const bait = baitCombo ? tryBait(h) : null;   // 유인–3자 콤비 Phase 0
      maybeAdvancePhase();
      startAnim({ from: fromPos, to, lofted: false, withHolder: true }, 650, null);
      logLine(t('log.carry.probe').replace('{label}', jl(h.label, '이', '가')), 'info');
      // F2(온보딩): 도발 밴드까지 들이댔는데 마커가 안 물었으면(커밋 롤 실패 —
      // commitP 존재가 그 증거) 말해준다. 침묵하면 "유인이 고장났나"로 읽힌다.
      if (bait && !bait.baited && bait.commitP != null) logLine(t('log.bait.missed'), 'warn');
      return { ok: true, bait };
    },

    shoot() {
      const h = holder();
      if (state.phase !== 'FINAL_THIRD') return fail(t('log.fail.notFinalThird'));
      const zone = detectShotZone(h, state);
      if (!zone) return fail(t('log.fail.noShotZone'));
      const res = resolveShot(h, zone, state, rng);
      state.phase = 'SHOT';
      const goalMouth = { x: PITCH_W - 0.5, y: PITCH_H / 2 + rng.range(-3, 3) };
      startAnim({ from: { x: h.x, y: h.y }, to: goalMouth, lofted: false }, 700, () => {
        endAttempt(res.result, { shooter: h, zone, xg: res.xg });
      });
      logLine(t('log.shot').replace('{label}', h.label).replace('{zone}', getLang() === 'en' ? (zone.en ?? zone.ko) : zone.ko), 'info');
      return { ok: true };
    },

    // 유인–3자 릴리스(Phase 1) — 유인 성공(state.baited)이 arm된 상태에서만.
    // 리시버가 마커가 비운 뒷공간으로 내려오고, 3자(자동 선정 릴리서)를 거쳐
    // 연결한다. 직접 패스는 끌려온 마커가 막으므로(고위험) 이 경로로만 뒷공간이
    // 열린다. 리시버가 내려오며 받아 FACING(전진) → 라인 브레이크(전진 가치).
    release() {
      const b = state.baited;
      if (!b) return fail(t('log.fail.noBait'));
      const h = holder();
      const receiver = byId(b.receiverId);
      if (!receiver || receiver.side !== 'us') { state.baited = null; return fail(t('log.fail.noBait')); }
      // 리시버 드롭 지점 — 마커가 비운 자리(vacated)에서 전진 방향(상대 골 x=105)
      // 으로 한 발. 내려오며 받아 앞을 본다.
      const drop = { x: clamp(b.vacated.x + 4, 2, PITCH_W - 2), y: clamp(b.vacated.y, 2, PITCH_H - 2) };
      // 오프사이드 정직성 — 마커가 비운 뒷공간이 곧 최종라인 뒤라 드롭이 라인을
      // 넘으면 반칙(7R 감사: 릴리스 86%가 오프사이드였는데 release 경로가 isOffside를
      // 안 탐). 드롭을 최종라인 살짝 앞으로 당긴다: 끌려나간 마커의 공간에서 전진
      // 방향으로 받되 라인은 넘지 않는다(온사이드 라인 브레이크).
      // 온사이드 상한 = max(볼 x, 최종라인-0.5). 캐리어가 이미 라인 뒤로 들어갔으면
      // (h.x가 라인보다 깊음) 리시버는 볼과 나란히(볼 뒤=항상 온사이드)로 당기고,
      // 아니면 최종라인 살짝 앞으로. 어느 경우든 offside 없이 전진 방향으로 받는다.
      const offLine = offsideLine(opps());
      drop.x = Math.min(drop.x, Math.max(h.x, offLine - 0.5));
      // 릴리서 — 유인 시 릴레이 런으로 이동한 3자(releaserId), 없으면 가장 깨끗한
      // 각의 동료. 끌려온 마커가 막은 직접 레인 대신 옆각을 제공한다.
      let releaser = b.releaserId ? byId(b.releaserId) : null;
      let bestRisk = releaser ? (evaluateLane(releaser, drop, opps(), {}).risk ?? 1) : 1;
      if (!releaser) {
        for (const p of ours()) {
          if (p.role === 'GK' || p.id === h.id || p.id === receiver.id) continue;
          const ev = evaluateLane(p, drop, opps(), {});
          if ((ev.risk ?? 1) < bestRisk) { bestRisk = ev.risk ?? 1; releaser = p; }
        }
      }
      if (!releaser) { state.baited = null; return fail(t('log.fail.noBait')); }
      const fromPos = { x: releaser.x, y: releaser.y };
      // 릴리스 위험 = 릴리서→리시버 레인(3자 옆각, 마커 밖). 캐리어→리시버 직접
      // 레인보다 낮다(마커가 직접 레인을 막았으므로).
      const risk = clamp(bestRisk * (1.1 - (releaser.traits?.pass ?? 0.7) * 0.25), 0.02, 0.95);
      state.baited = null;
      if (rollFail(risk)) {
        pressReact({ type: 'pass', trigger: 'third_man' });
        startAnim({ from: fromPos, to: drop, lofted: false }, flightMs(dist(fromPos, drop), false), () => {
          endAttempt('intercepted', { interceptor: nearestDefender(drop, opps()).defender, reason: 'contest', risk });
        });
        return { ok: false };
      }
      // 성공 — 리시버가 뒷공간에서 전진 방향으로 받는다.
      const carrierPos = { x: h.x, y: h.y };
      receiver.x = drop.x; receiver.y = drop.y; receiver.tx = drop.x; receiver.ty = drop.y;
      receiver.orientation = 'FACING';   // 내려오며 받아 앞을 본다(핵심 가치)
      state.holderId = receiver.id;
      state.consecutiveHolds = 0;
      // 라인 브레이크 = 볼의 실제 전진(캐리어→드롭). 커밋한 마커 라인을 넘어
      // 뒷공간으로 들어갔으므로 전진 가치. (릴리서는 옆 릴레이라 무관.)
      state.facts.linesBroken += linesBroken(carrierPos, drop, opps());
      state.facts.thirdMan = (state.facts.thirdMan || 0) + 1;
      clearPassContext();
      addPressure(-8);
      pressReact({ type: 'pass', trigger: 'third_man' });
      maybeAdvancePhase();
      startAnim({ from: fromPos, to: drop, lofted: false }, flightMs(dist(fromPos, drop), false), null);
      logLine(t('log.bait.release').replace('{label}', receiver.label), 'success');
      return { ok: true };
    },
  };

  function fail(message) {
    logLine(message, 'warn');
    return { ok: false, rejected: true, message };
  }

  // 운반 계획 — 목적지·경로 태클 위험을 순수 계산. dispatch carry()와 previewCarry
  // (evaluator carry 후보)가 같은 식을 쓴다: 미리보기=실제 위험 보장(정직한 프리뷰).
  function planCarry(h, point) {
    const maxCarry = carryRange(h.traits);   // 공을 달면 느리다 — pace·볼 컨트롤로 5~10m
    const d = dist(h, point);
    const to = d > maxCarry
      ? { x: h.x + (point.x - h.x) / d * maxCarry, y: h.y + (point.y - h.y) / d * maxCarry }
      : { x: point.x, y: point.y };
    to.x = clamp(to.x, 2, PITCH_W - 2); to.y = clamp(to.y, 2, PITCH_H - 2);

    // Tackle risk along the carry path.
    let risk = 0.04;
    let tackler = null;
    for (const def of opps()) {
      if (def.line === 'gk') continue;
      const seg = distToSegmentLocal(def, h, to);
      const reach = TACKLE_RADIUS + (def.traits?.pace ?? 0.7);
      if (seg < reach) {
        const c = clamp(1 - seg / reach, 0, 0.95) * 0.8;
        if (c > risk) { risk = c; tackler = def; }
      }
    }
    risk *= (1.15 - (h.traits?.carry ?? h.traits?.pressResistance ?? 0.6) * 0.45);
    // Carrying INTO the central box converges the back line (P1a: ends the free
    // six-yard walk-in) — but only when an outfield defender can actually collapse
    // onto the destination. 진짜 비워낸 박스는 유령 태클로 처벌하지 않는다(거리 비례).
    // 운반은 유인 도구다.
    if (to.x > 85 && Math.abs(to.y - PITCH_H / 2) < 14) {
      const { defender: conv, d: convD } = nearestDefender(to, opps());
      if (conv && convD < 14) {
        const floor = 0.45 * clamp(1 - (convD - 5) / 9, 0, 1);   // 5m≤ 풀 처벌 → 14m 소멸
        if (floor > risk) { risk = floor; tackler = conv; }
      }
    }
    risk = clamp(risk * tacRiskMul(state.currentAction), 0.02, 0.97);
    return { to, risk, tackler };
  }

  // 유인–3자 콤비 Phase 0 (docs/bait-third-man-design.md) — 마커를 향한 캐리가
  // 임계 거리(닿기 직전)에서 그 마커를 끌어낸다. 캐리 착지 후 캐리어에 가장 가까운
  // 대인 마커(markId 있음)를 보고, 도발 밴드(2~5m) 안이면 커밋 롤. 가까울수록
  // 커밋 확률↑(단 <2m은 planCarry 태클 위험이 이미 처벌). 성공 시 state.baited로
  // Phase 1(리시버 드롭 + 3자 릴리스)을 arm하고, 마커를 캐리어 쪽으로 당긴다.
  // 리시버 = 대인이면 markId 담당 선수, 지역이면 vacated 공간 최근접(결정 #1).
  const BAIT_NEAR = 2, BAIT_FAR = 5;
  function tryBait(h) {
    const scheme = scenario.scheme;
    const manLike = scheme === 'man' || scheme === 'hybrid';
    // markId 필수는 순수 'man'만 — 하이브리드 포메이션(build433Hybrid 등)은 어떤
    // 수비수에도 markId를 안 줘서, hybrid까지 markId를 요구하면 마커를 영영 못 찾아
    // 유인 콤비가 hybrid 셀 전체에서 죽는다(8R 감사). hybrid는 zonal처럼 최근접
    // 수비수를 마커로 쓰고, 리시버는 아래에서 markId 있으면 그걸·없으면 공간최근접.
    const strictMan = scheme === 'man';
    // 가장 가까운 마커 후보(순수 대인만 markId 필수, 그 외 아무 필드 수비수).
    let marker = null, md = Infinity;
    for (const def of opps()) {
      if (def.line === 'gk') continue;
      if (strictMan && !def.markId) continue;
      const dd = dist(def, h);
      if (dd < md) { md = dd; marker = def; }
    }
    if (!marker || md < BAIT_NEAR || md > BAIT_FAR) { state.baited = null; return { baited: false, d: md }; }
    // 커밋 확률 — 밴드 안에서 가까울수록↑ (5m 0.35 ~ 2m 0.85). 마커 jumpiness 가미.
    const commitP = clamp((BAIT_FAR - md) / (BAIT_FAR - BAIT_NEAR) * 0.5 + 0.35 + (marker.jumpiness ?? 0.5) * 0.1 - 0.05, 0.2, 0.9);
    if (rng.next() >= commitP) { state.baited = null; return { baited: false, d: md, commitP, markerId: marker.id }; }
    // 유인 성공 — 리시버를 정하고 마커를 커밋시킨다(캐리어 쪽으로 시각적 당김).
    // vacated는 마커의 '원자리'라 리시버가 그리로 내려오면 뒷공간을 쓴다.
    // 리시버 = 끌려나온 마커의 담당(대인). 단 그 담당이 홀더 자신이면(내 1v1 마커를
    // 당긴 경우) 리시버가 나 자신이 돼 "자기에게 릴리스"로 퇴화한다(7R 감사: 97.3%).
    // 그때는 비워진 공간 최근접의 '다른' 팀원이 3자로 내려온다(nearestReceiverToVacated
    // 는 홀더 제외). 이러면 어느 경우든 리시버 ≠ 홀더가 보장된다.
    const receiverId = (manLike && marker.markId && marker.markId !== h.id)
      ? marker.markId : nearestReceiverToVacated(marker);
    if (!receiverId) { state.baited = null; return { baited: false, d: md, commitP, markerId: marker.id }; }
    const vacated = { x: marker.x, y: marker.y };
    marker.committedTurns = 2;
    marker.tx = (marker.x + h.x) / 2; marker.ty = (marker.y + h.y) / 2;   // 시각 당김
    // 3자의 릴레이 런(사용자 모델 "3자 움직임이 같이 있어야") — 유인과 동시에
    // 지원 선수가 뒷공간으로 가는 깨끗한 릴레이 각으로 이동한다. 이게 없으면
    // 자기대국 AI는 3자 위치를 안 잡아 콤비가 완성 안 됐다(Phase 3 발견).
    const drop = { x: clamp(vacated.x + 4, 2, PITCH_W - 2), y: vacated.y };
    let releaser = null, bd = Infinity;
    for (const p of ours()) {
      if (p.role === 'GK' || p.id === h.id || p.id === receiverId) continue;
      const dd = dist(p, drop);
      if (dd < bd) { bd = dd; releaser = p; }
    }
    if (releaser) {
      // 릴레이 지점 — 캐리어와 드롭 사이, 측면으로 벌려(마커 밖 깨끗한 각).
      const side = releaser.y >= vacated.y ? 1 : -1;
      const relay = { x: clamp((h.x + drop.x) / 2, 2, PITCH_W - 2), y: clamp(vacated.y + side * 10, 2, PITCH_H - 2) };
      releaser.x = relay.x; releaser.y = relay.y; releaser.tx = relay.x; releaser.ty = relay.y;
      state.baited = { markerId: marker.id, receiverId, releaserId: releaser.id, carrierId: h.id, vacated };
    } else {
      state.baited = { markerId: marker.id, receiverId, carrierId: h.id, vacated };
    }
    logLine(t('log.bait.pulled').replace('{label}', marker.label), 'success');
    return { baited: true, d: md, commitP, markerId: marker.id, receiverId };
  }

  // 지역 방어용 리시버 — 마커가 비운 자리(vacated) 최근접 우리 필드 선수.
  function nearestReceiverToVacated(marker) {
    let best = null, bd = Infinity;
    for (const p of ours()) {
      if (p.role === 'GK' || p.id === state.holderId) continue;
      const dd = dist(p, marker);
      if (dd < bd) { bd = dd; best = p; }
    }
    return best?.id ?? null;
  }

  // 유인 콤비 미리보기(Phase 3) — evaluator가 유인 캐리를 추천할지 판단하는 재료.
  // 홀더가 캐리 사거리 안에서 도발 밴드로 닿을 수 있는 대인 마커가 있고, 뒷공간
  // 드롭을 받아줄 3자(깨끗한 각의 릴리서)가 있으면 { point, commitP, value } 반환.
  // point = 마커에서 3m 남긴 도발 지점. baitCombo off면 null(안 켜지면 추천 무의미).
  function previewBait() {
    if (!baitCombo) return null;
    const h = holder();
    if (!h || h.side !== 'us') return null;
    const scheme = scenario.scheme;
    const manLike = scheme === 'man' || scheme === 'hybrid';
    const strictMan = scheme === 'man';   // tryBait과 동일: hybrid는 markId 불필요
    const maxCarry = carryRange(h.traits);
    // 캐리로 도발 밴드(≤~BAIT_FAR)에 닿을 수 있는 마커 — 홀더에서 (밴드+사거리) 안.
    let marker = null, md = Infinity;
    for (const def of opps()) {
      if (def.line === 'gk') continue;
      if (strictMan && !def.markId) continue;
      const dd = dist(def, h);
      if (dd < md && dd <= maxCarry + BAIT_FAR && dd > BAIT_NEAR) { md = dd; marker = def; }
    }
    if (!marker) return null;
    // 도발 지점 — 마커를 향해 3m 남기고(스위트스폿). 홀더→마커 방향.
    const dx = marker.x - h.x, dy = marker.y - h.y, dd = Math.hypot(dx, dy) || 1;
    const gap = 3;
    const point = { x: marker.x - dx / dd * gap, y: marker.y - dy / dd * gap };
    // 릴레이 런이 3자 각을 만들어주므로(tryBait), 사전 깨끗한 레인은 요구하지
    // 않는다. 다만 릴레이·리시버가 될 지원 선수(홀더 아닌 필드 팀원)가 없으면 불가.
    const support = ours().some((p) => p.role !== 'GK' && p.id !== h.id);
    if (!support) return null;
    // 가치 = 커밋 확률 × 드롭 전진도. 깊은 마커(수비수, x큰쪽)를 깨면 파이널서드로
    // 진입 = 고가치(마지막 라인 돌파). 미드필더를 깨면 미드필드에 그쳐 저가치 —
    // 직접 전진 패스를 밀어내면 오히려 손해라 이때는 추천 안 되게(drop.x 비례).
    // 값은 보수적으로 — 콤비는 순EV 최적이 아니라 플레이어의 전술 도구(2턴 маневر라
    // 직접 전진 패스가 있으면 그게 낫다). 직접 플레이가 약할 때만 이 후보가 이기게
    // 낮게 둔다(자기대국 goal% 중립 유지). 깊은 마커(파이널 진입)일수록만 소폭↑.
    const commitP = clamp((BAIT_FAR - gap) / (BAIT_FAR - BAIT_NEAR) * 0.5 + 0.35, 0.2, 0.9);
    // 전진도는 실제 드롭(release와 동일한 온사이드 클램프 적용)으로 계산 — 깊은
    // 마커는 드롭이 최종라인 앞으로 당겨지므로 가치를 부풀리지 않는다.
    const offLine = offsideLine(opps());
    const dropX = Math.min(marker.x + 4, Math.max(h.x, offLine - 0.5));   // release와 동일 온사이드
    const advance = clamp((dropX - 42) / 38, 0, 1);   // 드롭 x42 미드 0 → x80 파이널 1
    const value = commitP * advance * 0.22;
    return { point, commitP, value, markerId: marker.id };
  }

  function distToSegmentLocal(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return dist(p, a);
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  // Quick tactical hint for the current holder — used internally to append
  // a forward-looking suggestion to post-action cues. Lightweight: only
  // scans 2 action types per mate (to_feet + best combo) to keep dispatch fast.
  function _quickHint(newHolder) {
    const w = activeWindow();
    const mates = ours().filter((p) => p.id !== newHolder.id && p.role !== 'GK');
    let best = null;
    let bestScore = -Infinity;

    for (const mate of mates) {
      for (const actionId of ['to_feet', 'pass_space']) {
        let risk = 1, targetX = mate.x;
        if (actionId === 'to_feet') {
          const ev = evaluateLane(newHolder, mate, opps(), { rewardWindow: w });
          risk = clamp(ev.risk * (1.15 - (newHolder.traits?.pass ?? 0.7) * 0.3), 0.02, 0.97);
          targetX = mate.x;
        } else { // pass_space — 동료 앞 공간
          const aim = { x: mate.x + 10, y: mate.y };
          if (dist(newHolder, aim) > 28 && (newHolder.traits?.longPass ?? 0) < LONG_PASS_GATE) continue;
          const ev = evaluateLane(newHolder, aim, opps(), { lofted: dist(newHolder, aim) > 28, rewardWindow: w });
          risk = clamp(ev.risk * (1.1 - (newHolder.traits?.pass ?? 0.7) * 0.25), 0.02, 0.97);
          targetX = aim.x;
        }
        if (risk >= 0.88) continue;
        const safety = (1 - risk) * 0.50;
        const fwd = clamp((targetX - newHolder.x) / 55, -0.3, 1) * 0.22;
        let winBonus = 0;
        if (w?.kind === 'real') {
          const wd = Math.hypot(targetX - w.x, mate.y - w.y);
          winBonus = wd < w.r ? 0.55 : wd < w.r * 2 ? 0.20 : 0;
        }
        const phaseBonus = (state.phase === 'BUILDUP' && targetX > PHASE_LINES.PROGRESSION) ? 0.28
          : (state.phase === 'PROGRESSION' && targetX > PHASE_LINES.FINAL_THIRD) ? 0.28 : 0;
        const comboBonus = actionId === 'pass_space' ? 0.10 : 0;
        const score = safety + fwd + winBonus + phaseBonus + comboBonus * 0.8;
        if (score > bestScore) { bestScore = score; best = { actionId, mate, score, risk, winBonus }; }
      }
    }
    if (!best) return null;
    const { actionId, mate, winBonus } = best;
    if (winBonus > 0.3) return t('log.hint.windowFinish').replace('{label}', mate.label);
    if (actionId === 'pass_space' && bestScore > 0.7) return t('log.hint.spaceAhead').replace('{label}', mate.label);
    return null;
  }

  // ─── public API ───────────────────────────────────────────────────────────
  return {
    get state() { return state; },
    get busy() { return anim !== null; },
    holder,

    dispatch(actionId, targetId, point) {
      // If rAF was throttled (background tab), an animation can linger past
      // its wall-clock duration — force-finish it instead of eating input.
      if (anim && performance.now() - anim.startedAt > anim.duration + 250) {
        this.update(anim.duration + 1000);
      }
      if (state.status !== 'live' || anim) return { ok: false, rejected: true };
      // 전환 국면 동안은 일반 액션을 막는다 — 카운터프레스/후퇴만 가능(E1).
      if (state.transition) return { ok: false, rejected: true, message: t('log.reject.transition') };
      if (state.matchDecision) return { ok: false, rejected: true, message: t('log.reject.decision') };
      const fn = actions[actionId];
      if (!fn) return { ok: false, rejected: true };
      // Snapshot render positions as animation start, and default every
      // target to "stay put" before the action/press mutate them.
      for (const p of players) {
        p.fx = p.rx ?? p.x; p.fy = p.ry ?? p.y;
        p.tx = p.x; p.ty = p.y;
      }
      state.turn++;
      state.currentAction = actionId;
      if (actionId !== 'pass_space') state.lastWasSwitch = false;   // 비-전환 액션은 쿨다운 리셋
      if (actionId !== 'release') state.baited = null;   // 유인 창은 다음 한 수뿐(carry가 재설정)
      logSituationEvents(prepareSituations(state, actionId));
      state.lastTacticalFactors = tacticalFactors(state, actionId);
      // Buildup clock: dawdling lets the press settle — with fair warning.
      if (state.turn === 12) logLine(t('log.clock.dawdle'), 'warn');
      if (state.turn > 14) addPressure(5);
      const result = fn(targetId, point);
      if (result.rejected) state.turn--;
      else logSituationEvents(updateTacticalState(state, actionId, result.ok));
      // F1(플레이테스트 발견): 유인 캐리가 같은 dispatch에서 국면 결정(tempo/flank)을
      // 열면 — prepareSituations는 캐리 '전'에 돌고 유인은 캐리 '중'에 arm — 릴리스가
      // 결정 가드에 막혀 "릴리스 ▸ E" 안내와 모순된다(이중 모달). 유인 창이 살아 있는
      // 동안 결정을 유예했다가, 유인이 해소된(릴리스 완료 또는 다른 액션으로 창 소멸)
      // 액션 뒤에 복원한다. seen 플래그는 이미 소비돼 중복 발화 없음.
      if (state.baited && state.matchDecision) {
        state.deferredDecision = state.matchDecision;
        state.matchDecision = null;
      } else if (!state.baited && state.deferredDecision && !state.matchDecision && state.status === 'live') {
        state.matchDecision = state.deferredDecision;
        state.deferredDecision = null;
      }
      // A full gauge ends the attempt no matter what the last action was (S8) —
      // previously only `hold` checked, so you could live at 100% forever.
      if (result.ok && state.status === 'live' && state.pressure >= 100) {
        if (anim) {
          const prev = anim.onDone;
          anim.onDone = () => {
            if (prev) prev();
            if (state.status === 'live') endAttempt('collapsed', {});
          };
        } else {
          endAttempt('collapsed', {});
        }
      }
      return result;
    },

    // Lane/landing previews for the UI. Uses the same evaluators — and the
    // same validity rules — as dispatch, so a previewable move is a legal move.
    preview(actionId, targetId) {
      const h = holder();
      const target = byId(targetId);
      if (!h || !target) return null;
      const _applyTac = (evaluation, kind = 'lane') => {
        const risk = clamp(evaluation.risk * tacRiskMul(actionId), 0.02, 0.97);
        const status = kind === 'landing'
          ? (risk < 0.3 ? 'open' : risk < 0.6 ? 'contested' : 'dead')
          : (risk < 0.28 ? 'safe' : risk < 0.58 ? 'risky' : 'cut');
        return { ...evaluation, risk, status, tacticalFactors: tacticalFactors(state, actionId) };
      };
      // Apply the same orientation risk modifier that resolvePassTo uses, so
      // the player sees the true resolution risk in the preview (P1).
      const _applyOrient = (lane, to) => {
        const isForward = to.x > h.x + 2;
        const om = h.orientation === 'BACK' && isForward ? 0.35
          : h.orientation === 'HALF' && isForward ? 0.12
          : 0;
        // P3: fold in edge relief (same as resolution) so a pass into our
        // superiority previews as the safer move it actually is.
        // + 전술 깊이: 적응·피로·모멘텀·라인의도 배율을 미리보기에도 반영 →
        //   같은 액션을 반복하면 레인 색(green→yellow→red)이 실제로 나빠진다(체감).
        const oriented = edgeRelief(clamp(lane.risk + om, 0.02, 0.97), to);
        return { ..._applyTac({ ...lane, risk: oriented }), orientPenalty: om || undefined };
      };
      // Offside receivers: previewable, but as a rule violation — not a lane.
      if (actionId === 'to_feet' && isOffside(target)) {
        return { kind: 'lane', target, lane: { risk: 1, status: 'offside', interceptor: null, reason: 'offside' } };
      }
      const w = activeWindow();
      // to_feet: same rescue-only ground-vs-lob pick the resolver makes
      // (ground cut ≥0.45, longPass range/accuracy respected).
      let feetLane = evaluateLane(h, target, opps(), { rewardWindow: w });
      if (feetLane.risk >= 0.45) {
        const lp = h.traits?.longPass ?? 0.4;
        const len = dist(h, target);
        if (len >= 14 && len <= 24 + lp * 46) {
          const lob = evaluateLane(h, target, opps(), { lofted: true, rewardWindow: w });
          const lobRisk = clamp(lob.risk + (1 - lp) * 0.15, 0.02, 0.97);
          if (lobRisk + 0.08 < feetLane.risk) {
            const status = lobRisk < 0.28 ? 'safe' : lobRisk < 0.58 ? 'risky' : 'cut';
            feetLane = { ...lob, risk: lobRisk, status, lofted: true };
          }
        }
      }
      return { kind: 'lane', target, lane: _applyOrient(withTrap(feetLane, target, target.id, target.traits), target), reception: predictReception(target) };
    },

    shotZoneNow() {
      return state.phase === 'FINAL_THIRD' ? detectShotZone(holder(), state) : null;
    },

    // Preview the shot probability for the current holder without rolling.
    // resolveShot과 같은 computeShotXg 단일 소스 — 미리보기=실제 xG 보장.
    // (이전엔 상수 3개가 어긋나 미리보기가 ~20-25% 과소 표시, 2026-07 감사 C1.)
    // 운반 미리보기 — planCarry(dispatch와 동일식)를 상태 변경 없이 노출.
    // evaluator가 carry를 보드 후보로 세우는 데 쓴다(자기대국 2R: 후보 부재로
    // 보드 추천의 92%가 pass_space 단조 — carry 주입만으로 goal +1%p 실증).
    previewCarry(point) {
      const h = holder();
      if (!h || h.side !== 'us' || !point) return null;
      const { to, risk } = planCarry(h, point);
      return { to, risk };
    },

    previewBait,   // 유인 콤비 후보 재료(Phase 3) — evaluator가 유인 캐리 추천에 사용.

    previewShot() {
      if (state.phase !== 'FINAL_THIRD') return null;
      const h = holder();
      const zone = detectShotZone(h, state);
      if (!zone) return null;
      // resolveShot과 같은 소스(state.pressIntensity) — 클로저 값과 갈라지면
      // 프리뷰≠해소 xG(maxΔ 0.115 실증, 2R 감사)가 되는 유일한 분기점이었다.
      const { xg } = computeShotXg(h, zone, opps(), { backpressure: shotBackpressure(state.pressIntensity) });
      return { zone, xg };
    },

    // Advance animations. Returns true while animating.
    update(dtMs) {
      // 결정 창(카운터프레스/수비압박)은 턴제 — 플레이어 입력으로만 해소된다.
      // 이전의 실시간 5초 자동 만료는 (a) 턴제 게임의 유일한 실시간 요소라 숙고형
      // 플레이어가 "자동 후퇴"를 반복 경험했고, (b) 백그라운드 탭 rAF 공백의 큰
      // dtMs 한 방에 창이 증발하는 버그 클래스였다. (2026-07 실플레이 판단)
      // 일반 액션은 창이 열린 동안 이미 거부되므로 선택을 미룰 수는 있어도 우회할 수는 없다.
      if (!anim) return false;
      anim.t += dtMs;
      const t = clamp(anim.t / anim.duration, 0, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      for (const p of players) {
        p.rx = lerp(p.fx, p.tx, ease);
        p.ry = lerp(p.fy, p.ty, ease);
      }
      if (t >= 1) {
        for (const p of players) { p.x = p.tx; p.y = p.ty; p.fx = p.x; p.fy = p.y; }
        const done = anim.onDone;
        anim = null;
        if (done) done();
        return false;
      }
      return true;
    },

    // Ball render position during/after animation.
    ballPos() {
      const h = holder();
      if (!anim?.ball) return h ? { x: h.rx ?? h.x, y: h.ry ?? h.y, lofted: false, flying: false } : null;
      const t = clamp(anim.t / anim.duration, 0, 1);
      const b = anim.ball;
      if (b.withHolder) return { x: h.rx ?? h.x, y: h.ry ?? h.y, lofted: false, flying: false };
      if (b.then) {
        // Two-leg flight (bounce / third man).
        const leg = t < 0.5 ? { from: b.from, to: b.to, lt: t * 2 } : { from: b.to, to: b.then, lt: (t - 0.5) * 2 };
        return { x: lerp(leg.from.x, leg.to.x, leg.lt), y: lerp(leg.from.y, leg.to.y, leg.lt), lofted: false, flying: true };
      }
      const ft = Math.min(1, t / 0.85);
      return {
        x: lerp(b.from.x, b.to.x, ft),
        y: lerp(b.from.y, b.to.y, ft),
        lofted: !!b.lofted, flightT: ft, flying: ft < 1,
      };
    },

    // What the player senses instead of a pressure number (§9).
    pressureExpression() {
      const p = state.pressure / 100;
      return {
        level: p,
        ring: clamp((p - 0.25) / 0.75, 0, 1),
        vignette: clamp((p - 0.5) / 0.5, 0, 1) * 0.4,
        shout: p >= 0.92 ? t('log.shout.urgent') : p >= 0.78 ? t('log.shout.hurry') : null,
        holderThreat: press.holderThreat(state),
      };
    },

    rewardWindowVisible() {
      return activeWindow();
    },

    pressInfo() {
      return press.adaptationInfo();
    },

    // Where do WE currently hold a real edge (numerical / between-lines)?
    // Drives the optional superiority overlay so the player can SEE the thing
    // the reward window points at.
    superiorityZones() {
      return findSuperiorityZones(state, { minValue: 1 });
    },

    // Scan all legal pass options for the current holder and return the top
    // `limit` ranked by tactical score. Useful for AI hints and UI overlays.
    scanOptions(limit = 5) {
      const h = holder();
      if (!h) return [];
      const w = activeWindow();
      const mates = ours().filter((p) => p.id !== h.id && p.role !== 'GK');
      const results = [];

      const scoreOption = (actionId, target) => {
        let risk = 1, targetX = target.x;
        // 추천의 합법성 — dispatch가 거부할 옵션은 후보에서 제외한다. 이 목록은
        // UI 힌트와 AI 정책이 그대로 실행하므로, 여기서 새면 사람에겐 "실행 불가
        // 추천"이, 자기대국엔 결정적 거부 루프(교착)가 된다. (자기대국 감사)
        if (isOffside(target)) return null;
        if (actionId === 'to_feet') {
          const ev = evaluateLane(h, target, opps(), { rewardWindow: w });
          risk = clamp(ev.risk * (1.15 - (h.traits?.pass ?? 0.7) * 0.3), 0.02, 0.97);
          targetX = target.x;
        } else if (actionId === 'pass_space') {
          // 동료 앞 공간으로 — 공간 패스. 멀면 자동 로빙(롱패스 능력 필요).
          // 조준점은 dispatch(pass_space)와 같은 경계 클램프·최소거리 게이트를 통과해야 한다.
          const aim = { x: clamp(target.x + 10, 2, PITCH_W - 2), y: clamp(target.y, 2, PITCH_H - 2) };
          if (dist(h, aim) < 4) return null;
          if (dist(h, aim) > 28 && (h.traits?.longPass ?? 0) < LONG_PASS_GATE) return null;
          // 실제 수신자는 착지점 최근접 us(조준 동료가 아닐 수 있음) — dispatch의
          // 오프사이드 판정 대상과 같은 선수로 검사해야 추천이 안 새어 나간다.
          const receiver = mates.reduce((a, p) => (dist(p, aim) < dist(a, aim) ? p : a), target);
          if (isOffside(receiver)) return null;
          const ev = evaluateLane(h, aim, opps(), { lofted: dist(h, aim) > 28, rewardWindow: w });
          risk = clamp(ev.risk * (1.1 - (h.traits?.pass ?? 0.7) * 0.25), 0.02, 0.97);
          targetX = aim.x;
        }
        if (risk >= 0.88) return null;
        const safety = (1 - risk) * 0.50;
        const fwd = clamp((targetX - h.x) / 55, -0.3, 1) * 0.22;
        let winBonus = 0;
        if (w?.kind === 'real') {
          const wd = Math.hypot(targetX - w.x, target.y - w.y);
          winBonus = wd < w.r ? 0.55 : wd < w.r * 2 ? 0.20 : 0;
        }
        const phaseBonus = (state.phase === 'BUILDUP' && targetX > PHASE_LINES.PROGRESSION) ? 0.28
          : (state.phase === 'PROGRESSION' && targetX > PHASE_LINES.FINAL_THIRD) ? 0.28 : 0;
        const comboBonus = actionId === 'pass_space' ? 0.12 : 0;
        const orientBonus = (h.orientation === 'BACK' && targetX <= h.x + 2) ? 0.18 : 0;
        // 오버로드-투-아이솔레이트(E3): 볼 반대편(|Δy|>16)이 비었으면 전환으로
        // 약측 1v1 고립을 만든다. 전환은 전진(fwd)이 낮아 늘 저평가됐다 — 열린
        // 약측일수록 보너스를 얹어 evaluator가 스위치를 실제 추천하게 한다.
        // (자기대국 감사: 열린 스위치 21% 가용인데 실행 23%뿐 → 정산 isolation
        // 보너스가 사문. 수신자 오픈니스에 비례하므로 막힌 쪽으론 안 뜬다.)
        let switchBonus = 0;
        if (Math.abs(target.y - h.y) > 16) {
          const open = nearestDefender(target, opps()).d;
          // 연속 스위치 쿨다운 — 직전이 전환이면 ×0.5로 감가(탁구질/좌우좌 왕복
          // 억제 + 저강도 블록[D2]에서 약측이 늘 열려 스위치 과반응하던 것 완화).
          const cooldown = state.lastWasSwitch ? 0.5 : 1;
          switchBonus = clamp((open - 10) / 16, 0, 1) * 0.24 * cooldown;
        }
        const score = safety + fwd + winBonus + phaseBonus + comboBonus * 0.8 + orientBonus + switchBonus;
        return { action: actionId, target, score, risk };
      };

      for (const mate of mates) {
        for (const actionId of ['to_feet', 'pass_space']) {
          const opt = scoreOption(actionId, mate);
          if (opt) results.push(opt);
        }
      }
      results.sort((a, b) => b.score - a.score);
      const top = results.slice(0, limit);
      if (top[0]) {
        const { action, target, score } = top[0];
        if (action === 'pass_space') top[0].why = t('log.why.spaceAhead').replace('{label}', target.label);
        else top[0].why = t('log.why.safeLink').replace('{label}', target.label).replace('{x}', score.toFixed(2));
      }
      return top;
    },

    // Switch a line's intent mid-match. Free of turn cost — the movement
    // itself takes turns (6m/drift), and the press needs its recognition
    // delay to re-read us, so the timing of the switch IS the decision.
    setLineIntent(group, intent, { silent = false } = {}) {
      if (!INTENT_OFFSET[group] || INTENT_OFFSET[group][intent] === undefined) return false;
      if (state.lineIntents[group] === intent) return true;
      state.lineIntents[group] = intent;
      if (group === 'back' && intent === 'hold') {
        const resolved = resolveCounterRisk(state);
        if (resolved.length) {
          state.facts.situationsResolved += resolved.length;
          logLine(t('log.counterResolved'), 'success');
        }
      }
      if (!silent && state.status === 'live') {
        const groupLabel = t({ front: 'dr.front', mid: 'dr.mid', back: 'dr.back' }[group]);
        const intentLabel = t(`log.intent.${group}.${intent}`);
        logLine(t('log.lineIntent.change').replace('{group}', groupLabel).replace('{intent}', intentLabel), 'info');
      }
      return true;
    },

    openPressingMode,

    // 수비 국면의 상대 전개 성향을 경기 중 교체(null=결정적 best). 에이전트 듀얼·
    // B단계에서 "상대 지휘자"가 스텝마다 위험 성향을 고르는 훅.
    setOpponentDisposition(d) {
      if (d !== null && !isDisposition(d)) return false;
      liveOppDisposition = d;
      return true;
    },

    advanceOpponentBuildUp(options = {}) {
      if (!possessionTurnoverLoop) return { ok: false, rejected: true };
      const disposition = options.disposition ?? opponentBuildDisposition;
      const step = applyOpponentBuildStep({ state }, {
        ...options,
        disposition,
        rng: options.rng ?? (disposition ? rng.next : undefined),
      });
      if (step?.stalled) {
        const regain = applyPossessionEvent({ state }, 'press_regain', { at: step.at, regainSide: 'us' });
        if (regain) {
          logLine(t('log.oppStall'), 'success');
          return { ...step, regained: true, regain };
        }
      }
      return step ?? { ok: false, rejected: true };
    },

    chooseSituationOption(choiceId) {
      // 카운터프레스 전환 창의 선택은 별도 경로로 처리(E1).
      if (state.transition) {
        if (choiceId === 'cp_press' || choiceId === 'cp_retreat') return resolveTransition(choiceId);
        return { ok: false, rejected: true };
      }
      if (state.defensivePress) {
        if (choiceId === 'dp_press' || choiceId === 'dp_cut' || choiceId === 'dp_drop') return resolveDefensivePress(choiceId);
        return { ok: false, rejected: true };
      }
      // 수비 국면(A): 상대 전개 저지 5택(지목 마크·전술 파울 포함).
      if (state.defenseLoop && state.matchDecision?.id === 'defend') {
        if (choiceId === 'dp_press' || choiceId === 'dp_cut' || choiceId === 'dp_mark' || choiceId === 'dp_drop' || choiceId === 'dp_foul') return resolveDefendStep(choiceId);
        return { ok: false, rejected: true };
      }
      if (state.status !== 'live') return { ok: false, rejected: true };
      const result = applyMatchDecision(state, choiceId);
      if (!result) return { ok: false, rejected: true };
      state.facts.decisionsMade++;
      logLine(result.text, result.tone);
      return { ok: true, choice: result.choice };
    },
  };
}
// (P0 2026-06-12: pressure→commit link, blind-side windows, team push, collapse@100)
