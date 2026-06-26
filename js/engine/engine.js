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
import { createRng } from './rng.js';
import {
  applyMatchDecision, createTacticalState, prepareSituations, resolveCounterRisk,
  tacticalFactors, tacticalRiskMultiplier, updateTacticalState,
} from './tactics.js';

const LONG_PASS_GATE = 0.5;

export function createEngine(scenario, seed = Date.now() % 2147483647, options = {}) {
  const rng = createRng(seed);
  const { intensityOverride } = options;
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
    holderId: 'us-gk',
    phase: 'BUILDUP',
    pressure: 22,
    consecutiveHolds: 0,
    turn: 0,
    rewardWindow: null,
    facts: {
      baits: 0, linesBroken: 0, switches: 0, windowsUsed: 0, runs: 0,
      situationsTriggered: 0, situationsResolved: 0, decisionsMade: 0,
      counterpressWins: 0, secondBalls: 0,
    },
    log: [],
    status: 'live',          // live | over
    outcome: null,
    transition: null,        // 카운터프레스 5초 창 (E1): { kind, detail, loss, msLeft, regainP }
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

  function addPressure(delta) {
    state.pressure = clamp(state.pressure + delta, 0, 100);
  }

  function tacRiskMul(actionId) { return tacticalRiskMultiplier(state, actionId); }

  function logSituationEvents(events) {
    for (const event of events) {
      if (event.type === 'activated') {
        state.facts.situationsTriggered++;
        logLine(`${event.situation.title} — ${event.situation.detail}`, 'warn');
      } else if (event.type === 'resolved') {
        state.facts.situationsResolved++;
        logLine(`${event.situation.title} 대응 성공 — 상대의 변화를 다시 흔들었습니다.`, 'success');
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
      title: '⚡ 카운터프레스 (5초)',
      detail: `볼 상실 — 즉시 압박해 되찾거나(${Math.round(regainP * 100)}%) 후퇴하세요.`,
      choices: [
        { id: 'cp_press', label: '카운터프레스', desc: '즉시 압박해 되찾기 — 실패 시 역습 노출' },
        { id: 'cp_retreat', label: '후퇴', desc: '블록으로 복귀해 안전하게 종료' },
      ],
    };
    logLine('볼 상실 — 카운터프레스 기회! 5초 안에 결정하세요.', 'warn');
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
      logLine('카운터프레스 성공! 높은 곳에서 되찾아 즉시 재공격합니다.', 'success');
      return { ok: true, recovered: true };
    }
    logLine(choiceId === 'cp_press' ? '카운터프레스 실패 — 역습에 노출됩니다.' : '후퇴 — 블록으로 복귀합니다.',
      choiceId === 'cp_press' ? 'error' : 'info');
    finishAttempt(tr.kind, tr.detail);
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
  const INTENT_KO = {
    front: { pin: '라인 밀어내기', drop: '내려와 연결' },
    mid: { between: '라인 사이 침투', support: '빌드업 보조' },
    back: { overlap: '풀백 전진', hold: '후방 안정' },
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
      const want = clamp(Math.min(p.homeX + push + cfg.off, line - cfg.gap, 95), 4, PITCH_W - 3);
      const dx = want - p.x;
      if (Math.abs(dx) > 0.3) {
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

      if (state.phase === 'FINAL_THIRD') {
        if (p.role === 'W') {
          // Wingers tuck in toward their near-post angle — not the centre,
          // so they arrive on the edge of the box rather than crowding the 6yd.
          const nearPost = p.homeY < PITCH_H / 2 ? PITCH_H / 2 - 9 : PITCH_H / 2 + 9;
          wantY = lerp(wantY, nearPost, 0.45);
        } else if (p.role === 'ST') {
          // Striker gravitates to penalty-spot Y — slight pull from ball side
          // so a cross from either flank finds them near the centre.
          wantY = lerp(wantY, PITCH_H / 2, 0.35);
        }
      }

      const dy = clamp(wantY, 2, PITCH_H - 2) - p.y;
      if (Math.abs(dy) > 0.3) {
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
      logLine(`상대가 적응했습니다 — ${reaction.shapeAdapted}`, 'warn');
      shapePendingLogged = false;
    } else if (reaction.shapePending && !shapePendingLogged) {
      logLine('상대가 우리 배치 변화를 읽는 중입니다 — 지금이 기회입니다.', 'info');
      shapePendingLogged = true;
    } else if (!reaction.shapePending) {
      shapePendingLogged = false;
    }
    if (reaction.rewardWindow) {
      state.rewardWindow = reaction.rewardWindow;
      if (reaction.rewardWindow.kind === 'real') {
        logLine(`${byId(reaction.committerId)?.label ?? '압박수'}가 튀어나왔습니다 — 등 뒤가 비었습니다!`, 'success');
      }
    }
    // Counter-drop fork log: when a marker chooses to HOLD rather than follow
    // the drop, the dropped player is open. Surface this immediately so the
    // player knows to exploit it before the situation closes.
    if (reaction.forkHeld?.length > 0) {
      const mark = byId(reaction.forkHeld[0].markId);
      if (mark) logLine(`${josa(mark.label, '이', '가')} 내려오는데 마커가 따라오지 않습니다 — 발 밑으로 받을 수 있습니다!`, 'success');
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

  // The space pass goes to wherever the receiver's space actually IS — not
  // only straight ahead. Scan direction (straight / inward / outward) ×
  // depth and take the most alive corridor: an open fullback gets the channel
  // ahead of him, a midfielder gets the pocket, a striker the in-behind.
  // Used by both dispatch and preview, so what you see is what gets played.
  function bestLandingFor(target) {
    const depths = state.phase === 'BUILDUP' ? [7, 11] : [8, 13, 18];
    const inward = target.y > PITCH_H / 2 ? -7 : 7;
    let best = null;
    for (const depth of depths) {
      for (const dy of [0, inward, -inward * 0.7]) {
        const zone = {
          x: clamp(target.x + depth, 4, PITCH_W - 5),
          y: clamp(target.y + dy, 3, PITCH_H - 3),
          r: 5,
        };
        const landing = evaluateLanding(zone, target, opps(), { rewardWindow: activeWindow() });
        const score = -landing.risk * 20 + zone.x * 0.15;
        if (!best || score > best.score) best = { zone, landing, score };
      }
    }
    return best;
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
    const contested = du < do_ + 2.5;   // 러너가 충분히 가까움 → 세컨볼 경합
    if (contested && rng.next() < 0.5) return { result: 'loose', receiver, winner: no };
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
        ? ` — ${josa(midFree.p.label, '이', '가')} 라인 사이에서 열려 있습니다`
        : ' — 라인 사이에서 전개하세요';
      logLine(`빌드업 돌파 — 전진 단계입니다${tip}.`, 'success');
    } else if (state.phase === 'PROGRESSION' && h.x > PHASE_LINES.FINAL_THIRD) {
      state.phase = 'FINAL_THIRD';
      addPressure(-6);
      // Suggest the scenario target shot or the most open finishing runner.
      const targetTip = state.scenario?.targetShot
        ? ` — 목표: ${state.scenario.targetShot}`
        : '';
      const boxRunner = ours()
        .filter((p) => p.id !== h.id && (p.role === 'W' || p.role === 'ST'))
        .map((p) => ({ p, ev: evaluateLane(h, p, opps(), {}) }))
        .filter((o) => o.ev.risk < 0.50)
        .sort((a, b) => a.ev.risk - b.ev.risk)[0];
      const runTip = boxRunner ? ` · ${boxRunner.p.label} 마무리 가능` : '';
      logLine(`파이널 서드${targetTip}${runTip}.`, 'success');
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
    return point.x > offsideLine(opps()) + 0.2;
  }

  // ─── shared pass resolution ───────────────────────────────────────────────
  function resolvePassTo(target, { lofted = false, viaLabel = null, extraRisk = 0, autoLob = false } = {}) {
    const from = holder();
    if (isOffside(target)) {
      return fail(`${josa(target.label, '은', '는')} 오프사이드 위치입니다 — 라인 뒤에서는 받을 수 없습니다.`);
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
    state.lastPassFromByline = fromPos.x > 90 && (fromPos.y < 16 || fromPos.y > PITCH_H - 16) && Math.abs(target.y - PITCH_H / 2) < 14;
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

    let msg = viaLabel ? `${viaLabel} → ${target.label}` : `${target.label}에게 연결`;
    if (useLofted && !lofted) msg += ' — 로빙으로 넘김';
    if (broken > 0) msg += ` — 라인 ${broken}개 통과`;
    if (usedWindow) msg += ' — 열린 공간 활용!';
    const _hint = _quickHint(target);
    if (_hint) msg += ` ${_hint}`;
    logLine(msg, broken > 0 || usedWindow ? 'success' : 'info');
    return { ok: true };
  }

  // ─── actions ──────────────────────────────────────────────────────────────
  const actions = {
    to_feet(targetId) {
      const target = byId(targetId);
      if (!target || target.side !== 'us' || target.id === state.holderId) return fail('받을 동료를 선택하세요.');
      return resolvePassTo(target, { autoLob: true });
    },

    into_space(targetId) {
      const target = byId(targetId);
      if (!target || target.side !== 'us' || target.id === state.holderId) return fail('침투할 동료를 선택하세요.');
      if (target.role === 'GK') return fail('GK는 공간 침투를 하지 않습니다.');
      if (isOffside(target)) return fail(`${josa(target.label, '은', '는')} 오프사이드 위치입니다 — 먼저 온사이드로 데려오세요 (런 지시).`);
      const from = holder();
      const { zone, landing } = bestLandingFor(target);
      const lofted = dist(from, zone) > 32;
      if (lofted && (from.traits?.longPass ?? 0) < LONG_PASS_GATE) {
        return fail(`${from.label}의 긴 패스 정확도로는 닿지 않는 거리입니다.`);
      }
      const kickPenalty = lofted ? (1 - (from.traits?.longPass ?? 0.5)) * 0.3 : 0;
      const ev = evaluateLane(from, zone, opps(), { lofted, rewardWindow: activeWindow() });
      const risk = clamp((Math.max(ev.risk, landing.risk) + kickPenalty) * (1.1 - (from.traits?.pass ?? 0.7) * 0.25) * tacRiskMul(state.currentAction), 0.02, 0.97);

      // 깨끗한 성공 vs 실패는 기존 risk로 판정(밸런스 보존). 실패 시 착지 경합으로
      // 루즈볼(세컨볼·되찾기) vs 탈취 분기 — 가혹한 이진 실패 완화(Inc.1).
      let loose = false;
      if (rollFail(risk)) {
        const contest = resolveLanding(zone, target);
        if (contest.result !== 'loose') {
          const interceptor = contest.winner ?? landing.interceptor ?? ev.interceptor ?? nearestDefender(zone, opps()).defender;
          pressReact({ type: 'pass', trigger: 'pass' });
          startAnim({ from: { x: from.x, y: from.y }, to: zone, lofted }, lofted ? 950 : 700, () => {
            endAttempt('intercepted', { interceptor, reason: 'contest', risk });
          });
          return { ok: false };
        }
        loose = true;   // 세컨볼 — 압박 속에 따냄(계속)
      }

      const fromPos = { x: from.x, y: from.y };
      state.facts.linesBroken += linesBroken(fromPos, zone, opps());
      target.tx = zone.x; target.ty = zone.y;
      target.x = zone.x; target.y = zone.y; // logical position = landing point
      state.holderId = target.id;
      state.consecutiveHolds = 0;
      target.orientation = 'FACING'; // moving reception → always FACING (P1)
      state.lastPassLofted = lofted;
      state.lastPassFromByline = false;
      state.lastPassCross = false;
      windowUseCheck(zone);
      // 루즈볼(세컨볼) = 압박 속에 따냄 — 실패가 아니라 경합 승리. 깨끗하면 압박 완화.
      if (loose) {
        addPressure(10);
        state.facts.secondBalls = (state.facts.secondBalls || 0) + 1;
      } else {
        addPressure(-6);
      }
      pressReact({ type: 'pass', trigger: 'pass', dist: dist(fromPos, zone) });
      maybeAdvancePhase();
      const trapped = receiverTrapCheck(target);
      startAnim({ from: fromPos, to: zone, lofted }, lofted ? 950 : 700, () => {
        if (trapped) endAttempt('trapped', { holder: target });
      });
      logLine(loose
        ? `세컨볼 경합 — ${josa(target.label, '이', '가')} 압박 속에 따냈습니다.`
        : `${josa(target.label, '이', '가')} 공간에서 받았습니다.`,
        loose ? 'warn' : 'success');
      return { ok: true };
    },

    // 공간 지향 패스(Inc.2): 임의 지점으로 패스 → 정확도만큼 산포된 착지점에서
    // 가장 가까운 us가 받음(또는 실패 시 착지 경합). 전환(롱·측면)도 이 하나로
    // 흡수 — 멀면 자동 로빙. 발밑(to_feet)은 선수 선택으로 별도 유지.
    pass_space(_t, point) {
      const from = holder();
      if (!point) return fail('패스할 공간을 클릭하세요.');
      const aim = { x: clamp(point.x, 2, PITCH_W - 2), y: clamp(point.y, 2, PITCH_H - 2) };
      const d = dist(from, aim);
      if (d < 4) return fail('너무 가깝습니다 — 운반을 쓰세요.');
      const lofted = d > 28;
      if (lofted && (from.traits?.longPass ?? 0) < LONG_PASS_GATE) {
        return fail(`${from.label}의 롱패스 정확도로는 닿지 않는 거리입니다.`);
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
      if (!nu) return fail('받을 동료가 근처에 없습니다.');
      const ev = evaluateLane(from, landing, opps(), { lofted, rewardWindow: activeWindow() });
      const reachPenalty = clamp((du - 6) / 16, 0, 0.4); // 동료가 착지점에서 멀면 위험↑
      const risk = clamp((ev.risk + reachPenalty) * (1.1 - pass * 0.25) * tacRiskMul(state.currentAction), 0.02, 0.97);

      const fromPos = { x: from.x, y: from.y };
      let loose = false;
      if (rollFail(risk)) {
        const c = resolveLanding(landing, nu);
        if (c.result !== 'loose') {
          const interceptor = c.winner ?? ev.interceptor ?? nearestDefender(landing, opps()).defender;
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
      state.lastPassFromByline = false;
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
        ? `세컨볼 경합 — ${josa(nu.label, '이', '가')} 압박 속에 따냈습니다.`
        : `${josa(nu.label, '이', '가')} 공간에서 받았습니다.`,
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
          logLine(`${josa(h.label, '이', '가')} 마커에 막혔습니다 — 리턴이 가장 안전합니다.`, 'warn');
        } else if (h.orientation === 'BACK') {
          const _escHint = _quickHint(h);
          if (_escHint) logLine(`등진 상태 지속 — ${_escHint.replace('→ ', '')}`, 'warn');
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
        logLine('상대가 미끼를 물지 않고 물러섭니다 — 블록이 내려앉습니다.', 'info');
      } else {
        logLine('상대가 버팁니다. 압박이 조여옵니다…', 'warn');
      }
      startAnim(null, 450, null);
      return { ok: true };
    },

    carry(_targetId, point) {
      const h = holder();
      if (!point) return fail('운반할 지점을 클릭하세요.');
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
      logLine(`${josa(h.label, '이', '가')} 공을 운반하며 압박을 시험합니다.`, 'info');
      return { ok: true };
    },

    shoot() {
      const h = holder();
      if (state.phase !== 'FINAL_THIRD') return fail('아직 슛 단계가 아닙니다 — 파이널 서드까지 전진하세요.');
      const zone = detectShotZone(h, state);
      if (!zone) return fail('유효한 슛 존이 아닙니다. 컷백/하프스페이스/센트럴 D를 만들어 보세요.');
      const res = resolveShot(h, zone, state, rng);
      state.phase = 'SHOT';
      const goalMouth = { x: PITCH_W - 0.5, y: PITCH_H / 2 + rng.range(-3, 3) };
      startAnim({ from: { x: h.x, y: h.y }, to: goalMouth, lofted: false }, 700, () => {
        endAttempt(res.result, { shooter: h, zone, xg: res.xg });
      });
      logLine(`${h.label}의 슛 — ${zone.ko}!`, 'info');
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
    if (winBonus > 0.3) return `→ ${mate.label}으로 열린 공간 마감 기회!`;
    if (actionId === 'pass_space' && bestScore > 0.7) return `→ ${mate.label} 앞 공간으로 패스`;
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
      if (state.transition) return { ok: false, rejected: true, message: '전환 국면 — 카운터프레스/후퇴를 선택하세요.' };
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
      if (state.turn === 12) logLine('너무 오래 끌고 있습니다 — 2턴 뒤부터 압박이 가속됩니다.', 'warn');
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
      if (actionId === 'into_space' && target.role === 'GK') return null;
      // Offside receivers: previewable, but as a rule violation — not a lane.
      if (actionId === 'to_feet' && isOffside(target)) {
        return { kind: 'lane', target, lane: { risk: 1, status: 'offside', interceptor: null, reason: 'offside' } };
      }
      const w = activeWindow();
      if (actionId === 'into_space') {
        if (isOffside(target)) {
          return { kind: 'lane', target, lane: { risk: 1, status: 'offside', interceptor: null, reason: 'offside' } };
        }
        const pickL = bestLandingFor(target);
        const zone = pickL.zone;
        const landing = _applyTac(withTrap(pickL.landing, zone, target.id, target.traits, 'landing'), 'landing');
        const lane = _applyTac(evaluateLane(h, zone, opps(), { lofted: dist(h, zone) > 32, rewardWindow: w }));
        return { kind: 'space', zone, landing, lane, target };
      }
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
        shout: p >= 0.92 ? '빨리 빨리!' : p >= 0.78 ? '빨리!' : null,
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
        if (action === 'pass_space') top[0].why = `${target.label} 앞 공간으로 패스`;
        else top[0].why = `${target.label}에게 안전 연결 (score ${score.toFixed(2)})`;
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
          logLine('역습 경고 대응 — 풀백이 자리를 지키며 후방 균형을 회복했습니다.', 'success');
        }
      }
      if (!silent && state.status === 'live') {
        logLine(`${{ front: '전방', mid: '중원', back: '후방' }[group]} → ${INTENT_KO[group][intent]} — 상대가 다시 읽기 전까지가 기회입니다.`, 'info');
      }
      return true;
    },

    chooseSituationOption(choiceId) {
      // 카운터프레스 전환 창의 선택은 별도 경로로 처리(E1).
      if (state.transition) {
        if (choiceId === 'cp_press' || choiceId === 'cp_retreat') return resolveTransition(choiceId);
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
