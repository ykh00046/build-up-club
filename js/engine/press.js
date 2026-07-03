// Press AI. The opponent is a coordinated block, not eleven red circles:
// it shifts with the ball, marks (per scheme), evaluates triggers, and makes
// probabilistic commit decisions (full / partial / hold / drop_off) so the
// press is learnable but never fully predictable.

import { clamp, dist, PITCH_W, PITCH_H } from '../data/pitch.js';
import { nearestDefender, evaluateLane } from './space.js';
import { findSuperiorityZones } from './superiority.js';
import { t } from '../career/i18n.js';

// midblock/lowblock(E10): 지역 방어 계열 — 사람보다 공간을 지키고 드롭오프가 잦다
// (마킹 분기는 man/hybrid가 아니라 zonal-like로 폴백). 블록일수록 base commit↓.
const SCHEME_BASE = { hybrid: 0.50, man: 0.58, zonal: 0.36, gegen: 0.62, midblock: 0.40, lowblock: 0.30 };
// vhigh 1.45→1.30 (자기대국 감사): 커밋이 폭증하면 등 뒤 real 윈도우(공격 보상)가
// 함께 폭증해 최고 강도가 오히려 최다 득점이 됐다. 커밋 절제(discipline)와 세트.
const INTENSITY_MUL = { low: 0.75, mid: 1.0, high: 1.18, vhigh: 1.30 };
const COMPACT = {
  tight:  { sideShift: 0.50, windowR: 6.0, lineGap: -0.25 },
  normal: { sideShift: 0.40, windowR: 7.5, lineGap: 0 },
  loose:  { sideShift: 0.30, windowR: 9.0, lineGap: 0.25 },
};

const TRIGGER_WEIGHT = {
  hold: 1.30, backpass: 1.25, gkpass: 1.45, carry: 1.10,
  wideReceive: 1.15, pivotPass: 1.0, pass: 0.55, bounce: 1.05,
  third_man: 1.00, switch: 0.5, shoot: 0,
  run: 0.6, // an off-ball run is visible — the block may stir
  // bounce/third_man raised 0.7→1.05/1.00: combination play threatens the block,
  // so the press scrambles harder AFTER a one-two or third-man succeeds.
};

// How many turns each scheme needs to recognise a shape change (§6.4).
// During the delay the press operates on its PREVIOUS reading — that lag is
// the shape advantage window the player exploits.
const RECOG_DELAY = { hybrid: 2, man: 3, zonal: 3, gegen: 4, midblock: 3, lowblock: 4 };

export function createPress(config) {
  const { scheme, compactness, intensityOverride } = config;
  const intensity = intensityOverride ?? config.intensity ?? 'high';
  // 강도 → 수비 물리량. 커밋 확률(INTENSITY_MUL)만 올리면 full_commit이 등 뒤
  // real 윈도우를 함께 늘려 공격 보상이 상쇄된다 — 측정상 goal%가 low 15.7 →
  // vhigh 17.3으로 오히려 역전, 커리어 디비전 램프가 헛돌았다(자기대국 감사).
  // 강할수록 블록이 볼 쪽으로 더 붙고(sideShift↑) 내주는 창이 작아진다(windowR↓).
  const INTENSITY_PHYS = {
    low:   { shift: -0.05, winR: +1.0 },
    mid:   { shift: 0,     winR: 0 },
    high:  { shift: +0.05, winR: -0.7 },
    vhigh: { shift: +0.12, winR: -1.6 },
  };
  const czBase = COMPACT[compactness] || COMPACT.normal;
  const ph = INTENSITY_PHYS[intensity] ?? INTENSITY_PHYS.mid;
  const cz = {
    sideShift: czBase.sideShift + ph.shift,
    windowR: Math.max(4.5, czBase.windowR + ph.winR),
    lineGap: czBase.lineGap,
  };
  let accumulator = 0;   // urgency rises the longer we stay alive in their press
  let droppedOff = 0;    // turns remaining of deliberate retreat
  let actionChain = [];  // last 5 trigger kinds (pattern recognition)
  let chainHolds = 0;    // consecutive trailing holds → chain-alert (press reads release)
  let gegenMul = 1.0;    // gegenpressing burst: 1-turn spike after bounce/third_man

  // ─── shape reading (§6.4) ──────────────────────────────────────────────────
  let currentReading = null;            // what the press believes about us
  let pendingReading = null;            // { reading, applyAtTurn }
  let adaptation = { lineBias: 0, backDrop: 0, sideBias: 0, commitMul: 1, labelKo: null };

  function readShape(state) {
    const ours = state.players.filter((p) => p.side === 'us' && p.role !== 'GK');
    const sorted = [...ours].sort((a, b) => b.x - a.x);
    const frontX = sorted.slice(0, 3).reduce((s, p) => s + p.x, 0) / 3;
    const inOppHalf = ours.filter((p) => p.x > 45);
    const highSide = inOppHalf.filter((p) => p.y > PITCH_H / 2).length;
    const lowSide = inOppHalf.length - highSide;
    return {
      forwardLine: frontX > 72 ? 'high' : frontX > 55 ? 'mid' : 'low',
      overload: highSide - lowSide >= 2 ? 'high' : lowSide - highSide >= 2 ? 'low' : 'balanced',
      baity: state.facts.baits >= 3,
    };
  }

  function sameReading(a, b) {
    return !!a && !!b && a.forwardLine === b.forwardLine && a.overload === b.overload && a.baity === b.baity;
  }

  function deriveAdaptation(r) {
    const a = { lineBias: 0, backDrop: 0, sideBias: 0, commitMul: 1, labelKo: [] };
    if (r.forwardLine === 'high') { a.backDrop = 4; a.labelKo.push(t('press.adapt.dropBack')); }
    if (r.forwardLine === 'low') { a.lineBias = -3; a.commitMul *= 1.15; a.labelKo.push(t('press.adapt.pushUp')); }
    if (r.overload !== 'balanced') {
      a.sideBias = r.overload === 'high' ? 6 : -6;
      a.labelKo.push(r.overload === 'high' ? t('press.adapt.shiftLow') : t('press.adapt.shiftHigh'));
    }
    if (r.baity) { a.commitMul *= 0.75; a.labelKo.push(t('press.adapt.wary')); }
    a.labelKo = a.labelKo.join(' · ') || null;
    return a;
  }

  // Returns { pending, justApplied } for logging/HUD.
  function updateShapeReading(state) {
    const reading = readShape(state);
    let pending = false, justApplied = null;
    if (!currentReading) {
      // First calibration is silent — a window only exists relative to a
      // previous belief the press is lagging behind.
      currentReading = reading;
      adaptation = deriveAdaptation(reading);
      return { pending: false, justApplied: null };
    }
    if (!sameReading(reading, currentReading)) {
      if (!pendingReading || !sameReading(pendingReading.reading, reading)) {
        pendingReading = { reading, applyAtTurn: state.turn + (RECOG_DELAY[scheme] ?? 3) };
      }
      pending = true;
    } else {
      pendingReading = null;
    }
    if (pendingReading && state.turn >= pendingReading.applyAtTurn) {
      currentReading = pendingReading.reading;
      adaptation = deriveAdaptation(currentReading);
      justApplied = adaptation.labelKo;
      pendingReading = null;
      pending = false;
    }
    return { pending, justApplied };
  }

  function defenders(state) { return state.players.filter((p) => p.side === 'opp'); }
  function holder(state) { return state.players.find((p) => p.id === state.holderId); }

  // Base block movement: anchors shift ball-side and with ball height; man
  // and hybrid markers track their marks goal-side within the leash.
  // rng: if provided, counter-drop fork decisions are computed here.
  function positionBlock(state, rng) {
    const forkEvents = [];
    const ball = holder(state) || { x: 20, y: 34 };
    const shiftY = (ball.y - PITCH_H / 2) * cz.sideShift + adaptation.sideBias;
    // Per-line retreat: as the ball advances the back line drops fastest
    // (toward its own box) — which is also what keeps good shot zones
    // reachable under the offside rule.
    const retreat = { front: 0.30, mid: 0.36, back: 0.44 };
    const baseShift = (droppedOff > 0 ? 5 : 0) + adaptation.lineBias;
    // A bypassed front line doesn't keep pressing fresh air — it folds back
    // into a midfield block (team_shape_advance §3). Per-defender, not per-line.
    const shiftXFor = (d) => {
      const beaten = d.line === 'front' && ball.x > d.x + 5;
      const factor = beaten ? 0.55 : (retreat[d.line] ?? 0.3);
      // 자유 패스 모델 — 블록이 공 진행에 더 적극적으로 따라 올라온다(캡 30→34).
      // 높은 라인은 배후 공간을 내주므로 공간 패스(로빙)와 트레이드오프가 된다.
      return clamp((ball.x - 22) * factor, -6, beaten ? 42 : 34) + baseShift;
    };
    const byId = new Map(state.players.map((p) => [p.id, p]));

    for (const d of defenders(state)) {
      if (d.line === 'gk') { d.tx = d.homeX; d.ty = d.homeY; continue; }
      if (d.beatenTurns > 0) {
        // Beaten (e.g. by a one-two): frozen this beat — but still yields to
        // the separation pass below instead of standing on a player.
        d.tx = d.x; d.ty = d.y;
        continue;
      }
      if (d.committedTurns > 0) {
        // A committed presser hunts the ball holder — but arrives at tackling
        // distance, never standing on top of him.
        const dxb = ball.x - d.x, dyb = ball.y - d.y;
        const dd = Math.hypot(dxb, dyb) || 1;
        const stop = Math.min(dd, 2.6);
        d.tx = ball.x - (dxb / dd) * stop;
        d.ty = ball.y - (dyb / dd) * stop;
        continue;
      }
      const shiftX = shiftXFor(d);
      let tx = d.homeX + shiftX + (d.line === 'back' ? adaptation.backDrop : 0);
      let ty = d.homeY + shiftY * (d.line === 'front' ? 1.0 : d.line === 'mid' ? 0.85 : 0.6);

      // Screening (formations `screens`): the DM sits IN the lane between the
      // ball and the player he erases — a body in the corridor, not a marker.
      // This is what the briefings promised ("6번은 스크린에 가려져") and what
      // shuts the free central gut-route (P1a: A2 rush exploit).
      const screenTarget = d.screens ? byId.get(d.screens) : null;
      if (screenTarget && screenTarget.id !== state.holderId) {
        // screenLerp (default 0.4): higher = screener pulled more toward ball.
        // A2 uses 0.55 → on carry the screener overshoots further from the
        // target (exposes the 10); on hold they're less perfectly positioned
        // (reduces the hold-is-always-bad penalty). §A2 정답축.
        const sLerp = d.screenLerp ?? 0.4;
        tx = ball.x * sLerp + screenTarget.x * (1 - sLerp);
        ty = ball.y * sLerp + screenTarget.y * (1 - sLerp);
      }

      const mark = d.markId ? byId.get(d.markId) : null;
      const tracksMark = mark && (scheme === 'man' || (scheme === 'hybrid' && dist(d, mark) < d.leash));
      if (tracksMark) {
        // Counter-drop fork (§drop_lab): when a man-marker's target drops deep
        // behind the anchor, hybrid/zonal schemes face a genuine fork:
        //   follow → marker vacates his original slot (window for a third runner)
        //   hold   → dropped player receives freely (player must exploit it fast)
        // man-scheme always tracks (high-commitment man-marking philosophy).
        const anchorX = d.homeX + shiftXFor(d);
        const markDropped = mark.x < anchorX - 5;
        if (markDropped && rng && scheme !== 'man') {
          // Decide once per turn (sticky for the duration of the drop episode).
          if (d.forkDecidedAt !== state.turn) {
            const threat = clamp(1 - dist(mark, ball) / 22, 0, 1); // near ball = risky to let go
            d.holdsDropMark = rng.next() > (0.28 + threat * 0.52);
            d.forkDecidedAt = state.turn;
            forkEvents.push({
              kind: d.holdsDropMark ? 'hold' : 'follow',
              defenderId: d.id, markId: d.markId,
            });
          }
        } else if (!markDropped) {
          d.holdsDropMark = false;
          d.forkDecidedAt = null;
        }

        if (!d.holdsDropMark) {
          // Goal-side of the mark (opp defend the x=PITCH_W goal), at touch-tight
          // distance but never standing on the mark.
          tx = mark.x + 2.6;
          ty = mark.y + (mark.y > PITCH_H / 2 ? -0.8 : 0.8);
        }
        // holdsDropMark=true → marker stays at anchor; mark receives freely.
      }
      // Leash back to the anchor so the block never disintegrates.
      const ax = d.homeX + shiftX, ay = d.homeY + shiftY * 0.7;
      const leash = d.leash * (scheme === 'man' ? 1.5 : 1.0);
      const dd = Math.hypot(tx - ax, ty - ay);
      if (dd > leash) {
        tx = ax + ((tx - ax) / dd) * leash;
        ty = ay + ((ty - ay) / dd) * leash;
      }
      // A back line HOLDS the edge of its box (P1a): it does not retreat into
      // its own six-yard box — that's what made the offside line a tap-in
      // service lane (measured: line at x≈97, 46/50 bot goals = six-yard).
      // Man-markers tracking a runner may go deeper; the zonal line may not.
      if (d.line === 'back' && !tracksMark) tx = Math.min(tx, 88.5);
      d.tx = clamp(tx, 2, PITCH_W - 2);
      d.ty = clamp(ty, 2, PITCH_H - 2);
    }

    // No freedom inside the box (P1a): the nearest back-line defender steps
    // onto the ball the moment it lives at the box edge. clampSpeed still
    // caps him at a sprint — a finish off a fast switch/window arrives before
    // he does, a walk-in does not. Ends the unpressured six-yard stroll.
    if (ball.x > 85) {
      let nearest = null, nd = Infinity;
      for (const d of defenders(state)) {
        if (d.line !== 'back' || d.beatenTurns > 0) continue;
        const dd = Math.hypot(d.x - ball.x, d.y - ball.y);
        if (dd < nd) { nd = dd; nearest = d; }
      }
      if (nearest) {
        const dxb = ball.x - nearest.x, dyb = ball.y - nearest.y;
        const dd = Math.hypot(dxb, dyb) || 1;
        const stop = Math.min(dd, 2.4);
        nearest.tx = ball.x - (dxb / dd) * stop;
        nearest.ty = ball.y - (dyb / dd) * stop;
      }
    }

    resolveOverlaps(state);
    return forkEvents;
  }

  // Players never rest standing on each other. Defenders are the reactive
  // side, so they yield: any defender target closer than MIN_SEP to one of
  // our players (or a fellow defender) is pushed out along the offset.
  const MIN_SEP = 2.4;

  function resolveOverlaps(state) {
    const defs = defenders(state).filter((d) => d.line !== 'gk');
    const ourPlayers = state.players.filter((p) => p.side === 'us');
    for (let iter = 0; iter < 3; iter++) {
      for (const d of defs) {
        // Defender-vs-defender first; ours last, so within an iteration the
        // hard rule (never rest on one of OUR players) wins.
        for (const other of defs) {
          if (other !== d) pushOff(d, other.tx, other.ty);
        }
        for (const o of ourPlayers) pushOff(d, o.x, o.y);
      }
    }
    // Final sweep: ours-vs-defender separation is absolute.
    for (const d of defs) {
      for (const o of ourPlayers) pushOff(d, o.x, o.y);
      d.tx = clamp(d.tx, 2, PITCH_W - 2);
      d.ty = clamp(d.ty, 2, PITCH_H - 2);
    }
  }

  function pushOff(d, px, py) {
    let dx = d.tx - px, dy = d.ty - py;
    let dd = Math.hypot(dx, dy);
    if (dd >= MIN_SEP) return;
    if (dd < 0.01) { dx = 1; dy = 0; dd = 1; } // degenerate: yield goal-side
    d.tx = px + (dx / dd) * MIN_SEP;
    d.ty = py + (dy / dd) * MIN_SEP;
  }

  // Defenders are not teleporters: each beat they cover at most a sprint's
  // worth of grass. The block LAGS a big switch — that lag is the point.
  // vhigh만 반 발 더 빠르다 — 최상위 압박의 "따라잡힌다" 체감(디비전 램프).
  const MAX_STEP = intensity === 'vhigh' ? 8 : 7;
  const MAX_STEP_COMMIT = intensity === 'vhigh' ? 11 : 10;

  // dt = 행동 시간(짧은 패스면 작음). 수비 이동 캡을 그만큼 줄여 — 짧은 순간엔
  // 수비도 조금만 좁힌다. 짧은 패스 연쇄(원투·써드맨)가 자연 발생하는 이유.
  function clampSpeed(state, dt = 1) {
    const ourPlayers = state.players.filter((p) => p.side === 'us');
    for (const d of defenders(state)) {
      if (d.line === 'gk') continue;
      const cap = (d.committedTurns > 0 ? MAX_STEP_COMMIT : MAX_STEP) * dt;
      const dx = d.tx - d.x, dy = d.ty - d.y;
      const dd = Math.hypot(dx, dy);
      if (dd > cap) {
        d.tx = d.x + (dx / dd) * cap;
        d.ty = d.y + (dy / dd) * cap;
      }
      // Separation stays absolute even after the clamp.
      for (const o of ourPlayers) pushOff(d, o.x, o.y);
      d.tx = clamp(d.tx, 2, PITCH_W - 2);
      d.ty = clamp(d.ty, 2, PITCH_H - 2);
    }
  }

  // Evaluate one trigger and decide what the press does about it.
  // Pressure feeds commit probability (S2): the bait the player accumulates is
  // a real resource — a press under provocation jumps more. 0 pressure ≈ ×0.6,
  // kickoff (22) ≈ ×0.78, fully baited (100) ≈ ×1.4.
  // depthMul: continuous curve on holder.x — press tightens as ball advances.
  // backMul: BACK-oriented holder is a static target — commit directly amplified.
  // chainAlertMul: 2+ consecutive holds = press reads the release pattern (×1.18).
  // gegenMul: 1-turn spike after a successful combination (bounce/third_man).
  function decide(state, triggerKind, rng) {
    const h = holder(state);
    // Depth curve: replaces step-function phaseMul. Linear ramp from x=40 to
    // x=88 (box edge). Keeps 1.0 in deep build-up; peaks at 1.35 inside the box.
    const hx = h?.x ?? 20;
    const depthMul = hx < 40 ? 1.0
      : hx >= 88 ? 1.35
      : 1.0 + (hx - 40) * (0.35 / 48);
    // BACK-oriented holder can only return — press sees a static target and
    // steps on it. Direct ×1.30 amplifier on full_commit weight.
    const backMul = h?.orientation === 'BACK' ? 1.30 : 1.0;
    const chainAlertMul = chainHolds >= 2 ? 1.18 : 1.0;
    const p = clamp(
      (SCHEME_BASE[scheme] ?? 0.5)
      * (INTENSITY_MUL[intensity] ?? 1)
      * (TRIGGER_WEIGHT[triggerKind] ?? 0.5)
      * (0.85 + accumulator * 0.05)
      * (0.6 + (state.pressure / 100) * 0.8)
      * adaptation.commitMul
      * depthMul
      * chainAlertMul
      * gegenMul,
      0.02, 0.92,
    );
    // 고강도 압박은 빠를 뿐 아니라 절제됐다 — 점프는 오되 각을 덜 버린다(partial↑).
    // full_commit만 늘리면 등 뒤 real 윈도우가 함께 급증해 공격 보상이 상쇄,
    // 강도 램프가 역전된다(자기대국 감사: goal% low 15.7 < vhigh 17.3).
    const discipline = intensity === 'vhigh' ? 0.6 : intensity === 'high' ? 0.25 : 0;
    return rng.weighted([
      { value: 'full_commit',    w: p * backMul },
      { value: 'partial_commit', w: p * (0.55 + discipline) },
      { value: 'hold',           w: Math.max(0.08, 1 - p) },
      { value: 'drop_off',       w: scheme === 'man' ? 0.05 : scheme === 'gegen' ? 0.07 : 0.14 },
    ]);
  }

  // How much does removing this defender improve our best available pass-risk?
  // High value → this defender is actively blocking a dangerous lane → reluctant
  // to commit (leaving would gift a real window). Low value → covering a lane
  // nobody uses → safe to send without tactical cost.
  function vacancyValue(candidate, state) {
    const ball = holder(state);
    if (!ball) return 0;
    const allDefs = defenders(state).filter((d) => d.line !== 'gk');
    const defsWithout = allDefs.filter((d) => d.id !== candidate.id);
    const ours = state.players.filter((p) => p.side === 'us' && p.id !== ball.id && p.role !== 'GK');
    let maxGain = 0;
    for (const m of ours) {
      const withRisk = evaluateLane(ball, m, allDefs, {}).risk;
      const withoutRisk = evaluateLane(ball, m, defsWithout, {}).risk;
      const gain = withRisk - withoutRisk;
      if (gain > maxGain) maxGain = gain;
    }
    return clamp(maxGain, 0, 1);
  }

  function pickCommitter(state, rng) {
    const ball = holder(state);
    // Only defenders near the ball realistically jump — no cross-pitch sprints.
    // Smart selection: key defenders (whose departure opens a dangerous lane)
    // are reluctant to commit — they know what they're protecting. Low-value
    // cover men commit freely. man-scheme ignores this (pure man-marking).
    const candidates = defenders(state)
      .filter((d) => d.line !== 'gk' && d.committedTurns <= 0 && dist(d, ball) < 18)
      .map((d) => {
        const vacancy = scheme === 'man' ? 0 : vacancyValue(d, state);
        const reluctance = vacancy * 1.4; // higher lane value → less willing to jump
        return { value: d, w: Math.max(0.01, d.jumpiness) / (Math.max(4, dist(d, ball)) * (1 + reluctance)) };
      });
    if (!candidates.length) return null;
    return rng.weighted(candidates);
  }

  return {
    scheme, intensity, compactness,
    windowRadius: cz.windowR,

    // Snap the block into its true kickoff shape (man-markers attached,
    // ball-side shift applied) BEFORE the first preview, so what the player
    // sees at turn 0 is what the lane evaluator rolls. (ISSUE-001)
    init(state) {
      // Calibrate the shape reading on the kickoff arrangement so the FIRST
      // change the player makes is what opens a recognition-delay window.
      updateShapeReading(state);
      positionBlock(state);
      // Law 16: at a goal kick the opponents wait outside the penalty area.
      // They may flood in after the first touch — but not stand on the GK.
      for (const d of defenders(state)) {
        if (d.line !== 'gk' && d.tx < 18.5) d.tx = 18.5;
      }
      resolveOverlaps(state);
      for (const d of defenders(state)) {
        d.x = d.tx; d.y = d.ty;
        d.fx = d.x; d.fy = d.y;
        d.rx = d.x; d.ry = d.y;
      }
    },

    // Called once after every player action. Mutates defender targets
    // (d.tx/d.ty, d.committedTurns) and returns the press decision.
    react(state, event, rng) {
      accumulator = Math.min(6, accumulator + (state.phase === 'BUILDUP' ? 0.6 : 0.25));
      // BACK-oriented holder is static target — press reads it and steps up (P1).
      const h = holder(state);
      if (h?.orientation === 'BACK') accumulator = Math.min(6, accumulator + 1.5);
      if (droppedOff > 0) droppedOff--;
      const shape = updateShapeReading(state);

      for (const d of defenders(state)) {
        if (d.committedTurns > 0) d.committedTurns--;
      }

      // Action-chain memory: track consecutive holds so the press can "read"
      // the classic hold→hold→release pattern. After 2+ consecutive holds:
      //   • commit probability rises ×1.18 (chain-alert in decide())
      //   • reward window shrinks ×0.72 (press pre-positioned, less blind-side)
      // Reset on any non-hold action — the pattern has been broken.
      const triggerKind = event.trigger || event.type;
      // Gegenpressing burst: after a successful combination (bounce / third_man)
      // the press scrambles hard for one turn — real-football counter-press.
      // gegenMul decays to 1.0 each react() call; set to 1.30 only on those triggers.
      // Gegenpressing burst only fires for the gegen scheme (real-football counter-press).
      gegenMul = (scheme === 'gegen' && (triggerKind === 'bounce' || triggerKind === 'third_man')) ? 1.30 : 1.0;
      if (triggerKind === 'hold') { chainHolds = Math.min(chainHolds + 1, 5); }
      else { chainHolds = 0; }
      actionChain.push(triggerKind);
      if (actionChain.length > 5) actionChain.shift();

      let decision = null;
      let committer = null;
      let rewardWindow = null;

      if ((TRIGGER_WEIGHT[triggerKind] ?? 0) > 0 && state.phase !== 'SHOT') {
        decision = decide(state, triggerKind, rng);

        // In the final third the press holds its shape — retreating into your
        // own box while conceding a final-third attack is tactically wrong.
        if (decision === 'drop_off' && state.phase === 'FINAL_THIRD') decision = 'hold';

        if (decision === 'full_commit' || decision === 'partial_commit') {
          committer = pickCommitter(state, rng);
          if (committer) {
            // The window is BEHIND the jumper (F2): a presser sprinting at the
            // ball cannot see — or cover — the space at his back. Project from
            // his current spot away from the ball: that is the line gap he
            // stops screening the moment he commits. (The old anchor formula
            // opened windows in our own build-up zone — measured useless.)
            const ball = holder(state);
            const dxv = committer.x - ball.x, dyv = committer.y - ball.y;
            const dv = Math.hypot(dxv, dyv) || 1;
            const depth = 7;
            const vacated = {
              x: clamp(committer.x + (dxv / dv) * depth, 6, PITCH_W - 6),
              y: clamp(committer.y + (dyv / dv) * depth, 5, PITCH_H - 5),
            };
            if (decision === 'full_commit') {
              committer.committedTurns = 2;
              // P1: the window opens at the EDGE the jump created — a teammate
              // who now holds real superiority near the vacated space — not the
              // empty grass itself. If the jump created no usable edge, no real
              // window opens (the natural scarcity F3 asked for).
              const edge = findSuperiorityZones(state, { minValue: 1 })
                .filter((z) => dist(z, vacated) < 24)
                .sort((a, b) => b.value - a.value || dist(a, vacated) - dist(b, vacated))[0];
              rewardWindow = edge
                ? {
                    x: edge.x, y: edge.y, r: cz.windowR,
                    kind: 'real', expiresTurn: state.turn + 2,
                    openedBy: triggerKind, committerId: committer.id,
                    edgeKind: edge.kind,
                  }
                : null;
            } else {
              // Half-step pressure only — no bait window. 가짜 창은 측정상 아무도
              // 안 속았다(2,300패스 중 가짜行 0건 — 레인 평가가 위험을 정직하게
              // 반영해 프리뷰가 스스로 회피). 화면 노이즈만 남아 제거(자기대국 2R).
              // "보이는 반짝임 = 진짜 기회" 신뢰 확보가 이 게임 문법에 맞다.
              committer.halfStep = { x: (committer.x + ball.x) / 2, y: (committer.y + ball.y) / 2 };
            }
          }
        } else if (decision === 'drop_off') {
          droppedOff = 2;
        }
      }

      // Chain-alert window shrink: after 2+ consecutive holds the press has
      // pre-positioned for the release — the blind-side gap is smaller.
      if (rewardWindow && chainHolds >= 2) {
        rewardWindow.r = Math.max(rewardWindow.r * 0.72, 3.5);
      }

      const forkEvents = positionBlock(state, rng);

      // The half-step overrides the block position for a partial commit —
      // then re-resolve separation so the step never lands on a player.
      if (committer?.halfStep) {
        committer.tx = committer.halfStep.x;
        committer.ty = committer.halfStep.y;
        delete committer.halfStep;
        resolveOverlaps(state);
      }

      clampSpeed(state, event?.dt ?? 1);

      return {
        decision, committerId: committer?.id ?? null, rewardWindow,
        shapePending: shape.pending, shapeAdapted: shape.justApplied,
        forkHeld: forkEvents.filter((e) => e.kind === 'hold'),
        forkFollowed: forkEvents.filter((e) => e.kind === 'follow'),
      };
    },

    // For the HUD: what does the press currently believe / is it re-reading?
    adaptationInfo() {
      return {
        labelKo: adaptation.labelKo,
        reading: currentReading,
        pending: !!pendingReading,
      };
    },

    // Immediate threat on the ball holder right now (0..1).
    holderThreat(state) {
      const ball = holder(state);
      if (!ball) return 0;
      const { d } = nearestDefender(ball, defenders(state));
      return clamp(1 - d / 9, 0, 1);
    },
  };
}
