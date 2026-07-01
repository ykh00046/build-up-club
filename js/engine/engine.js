// Turn engine. One dispatch = one tactical decision: resolve the action with
// the same lane math the preview showed, let the press react (probabilistic
// commit), update pressure/phase, and animate both teams' movement.
//
// Phases: BUILDUP → PROGRESSION → FINAL_THIRD → SHOT(goal). The goal — not
// "zone reached" — is the success signal. There are no grades anywhere.

import { PHASE_LINES, PITCH_W, PITCH_H, clamp, dist, lerp, carryRange } from '../data/pitch.js';
import { josa } from '../util/josa.js';
import {
  evaluateLane, evaluateLanding, linesBroken, offsideLine,
  nearestDefender, TACKLE_RADIUS, computeOrientation, receiverPressure,
} from './space.js';
import { createPress } from './press.js';
import { findSuperiorityZones, superiorityAt } from './superiority.js';
import { detectShotZone, resolveShot } from './shots.js';
import { buildOutcome } from './outcome.js';
import { applyOpponentBuildStep, applyPossessionEvent } from './possession-adapter.js';
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
  const { intensityOverride, possessionTurnoverLoop = false, opponentBuildDisposition = null } = options;
  const press = createPress({ ...scenario, ...(intensityOverride ? { intensityOverride } : {}) });

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
    finishAttempt(tr.kind, tr.detail);
    return { ok: true, recovered: false };
  }

  function pressureHunters(point) {
    return ours()
      .filter((p) => p.role !== 'GK')
      .map((p) => ({ p, d: dist(p, point) }))
      .filter((x) => x.d < 24)
      .sort((a, b) => a.d - b.d);
  }

  function defensivePressProb(carrier, hunters) {
    const near = hunters.filter((x) => x.d < 14).length;
    const front = state.lineIntents.front === 'pin' ? 0.08 : 0;
    const mid = state.lineIntents.mid === 'between' ? 0.06 : 0;
    const momentum = ((state.momentum ?? 50) - 50) / 100 * 0.12;
    const fatigue = ((state.fatigue ?? 0) / 100) * 0.16;
    const carrierCalm = (carrier.traits?.pressResistance ?? carrier.traits?.pass ?? 0.65) * 0.18;
    return clamp(0.22 + near * 0.11 + front + mid + momentum - fatigue - carrierCalm, 0.12, 0.74);
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
    state.matchDecision = null;
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
      let want;
      if (cutbackDeveloping && (p.role === 'ST' || p.role === '10')) {
        // 컷백 도착: 페널티 스폿(컷백 존 x90.5~99.5)으로 파고들어 풀백을 받는다.
        want = clamp(PITCH_W - 12, 4, PITCH_W - 3);   // ~93 (penaltySpotX)
      } else if (cutbackDeveloping && farSideW) {
        // 백포스트 도착 — 컷백이 뒤로 흐르거나 크로스가 넘어올 때의 제2 마무리 지점.
        want = clamp(PITCH_W - 7, 4, PITCH_W - 3);    // ~98 back post
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
      startAnim({ from: { x: from.x, y: from.y }, to: cutPoint, lofted: useLofted }, useLofted ? 900 : 650, () => {
        endAttempt('intercepted', { interceptor, reason: ev.reason, risk });
      });
      return { ok: false };
    }

    const fromPos = { x: from.x, y: from.y };
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

    if (broken > 0) addPressure(-6 * broken);
    const usedWindow = windowUseCheck(target);

    const trigger = passTriggerFor(fromPos, target, target);
    if (trigger === 'gkpass') addPressure(8);
    else if (trigger === 'backpass') addPressure(4);

    pressReact({ type: 'pass', trigger, dist: dist(from, target) });
    maybeAdvancePhase();

    const trapped = receiverTrapCheck(target);
    startAnim({ from: fromPos, to: { x: target.x, y: target.y }, lofted: useLofted }, useLofted ? 900 : 650, () => {
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
      const ev = evaluateLane(from, landing, opps(), { lofted, rewardWindow: activeWindow() });
      const reachPenalty = clamp((du - 6) / 16, 0, 0.4); // 동료가 착지점에서 멀면 위험↑
      const risk = clamp((ev.risk + reachPenalty) * (1.1 - pass * 0.25) * tacRiskMul(state.currentAction), 0.02, 0.97);

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
      if (Math.abs(fromPos.y - landing.y) > 20) state.facts.switches++; // 측면 전환 → 측면 정체성
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
      else { addPressure(-5); }
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
      maybeAdvancePhase();
      startAnim({ from: fromPos, to, lofted: false, withHolder: true }, 650, null);
      logLine(t('log.carry.probe').replace('{label}', jl(h.label, '이', '가')), 'info');
      return { ok: true };
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
  };

  function fail(message) {
    logLine(message, 'warn');
    return { ok: false, rejected: true, message };
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
      logSituationEvents(prepareSituations(state, actionId));
      state.lastTacticalFactors = tacticalFactors(state, actionId);
      // Buildup clock: dawdling lets the press settle — with fair warning.
      if (state.turn === 12) logLine(t('log.clock.dawdle'), 'warn');
      if (state.turn > 14) addPressure(5);
      const result = fn(targetId, point);
      if (result.rejected) state.turn--;
      else logSituationEvents(updateTacticalState(state, actionId, result.ok));
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
    // Uses the identical formula as resolveShot. Returns { zone, xg } or null.
    previewShot() {
      if (state.phase !== 'FINAL_THIRD') return null;
      const h = holder();
      const zone = detectShotZone(h, state);
      if (!zone) return null;
      const defenders = opps();
      const gk = defenders.find((d) => d.line === 'gk');
      const pressureAtShot = Math.max(
        receiverPressure(h, defenders),
        gk ? clamp(1 - dist(h, gk) / 7, 0, 1) * 0.8 : 0,
      );
      const affinity = h.traits?.shot?.[zone.id] ?? 0.7;
      const gkFactor = gk ? clamp(1 - (gk.traits?.keeping ?? 0.75) * clamp(1 - dist(h, gk) / 30, 0.2, 1) * 0.45, 0.5, 1) : 1;
      const xg = clamp(zone.baseXg * affinity * (1 - pressureAtShot * 0.35) * gkFactor, 0.01, 0.85);
      return { zone, xg };
    },

    // Advance animations. Returns true while animating.
    update(dtMs) {
      // 카운터프레스 5초 카운트다운 (E1): 시간 초과 시 자동 후퇴.
      if (state.transition && state.status === 'live') {
        state.transition.msLeft -= dtMs;
        if (state.transition.msLeft <= 0) resolveTransition('cp_retreat');
      }
      if (state.defensivePress && state.status === 'live') {
        state.defensivePress.msLeft -= dtMs;
        if (state.defensivePress.msLeft <= 0) resolveDefensivePress('dp_drop');
      }
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
        if (actionId === 'to_feet') {
          const ev = evaluateLane(h, target, opps(), { rewardWindow: w });
          risk = clamp(ev.risk * (1.15 - (h.traits?.pass ?? 0.7) * 0.3), 0.02, 0.97);
          targetX = target.x;
        } else if (actionId === 'pass_space') {
          // 동료 앞 공간으로 — 공간 패스. 멀면 자동 로빙(롱패스 능력 필요).
          const aim = { x: target.x + 10, y: target.y };
          if (dist(h, aim) > 28 && (h.traits?.longPass ?? 0) < LONG_PASS_GATE) return null;
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
        const score = safety + fwd + winBonus + phaseBonus + comboBonus * 0.8 + orientBonus;
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
