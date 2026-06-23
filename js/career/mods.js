// 통합의 핵심 — 클럽 업그레이드를 전술 코어에 연결하는 글루.
//
// 엔진 내부는 한 줄도 고치지 않는다. 비결: 선수 traits(pass/shot/keeping)는
// dispatch 시점에 실시간으로 읽히므로(engine.js·shots.js), createEngine 직후
// 'us' 선수의 traits를 클럽 공격 레벨만큼 부스트하면 전술 플레이 전체가
// 그만큼 쉬워진다. 상대 강도는 intensityOverride(압박 mid/high/vhigh)로 전달.
//
// 그래서 업그레이드는 숫자놀음이 아니라 "패스가 덜 끊기고 슛이 더 들어가는"
// 체감으로 돌아온다. 수비 레벨은 경기 후 실점 시뮬(simConcede)로 작동한다.

import { attackOVR, defenseOVR, teamOVR, oppBaseOVR, POSITIONS } from './club.js';
import { philoMods } from './philosophy.js';

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// 공격/수비 OVR → 트레잇 부스트. matchSetup과 upgradePreview가 공유하는 단일 진실원
// (둘이 따로 계산하면 미리보기와 실제 경기가 어긋난다).
export function boostsFor(atk, def) {
  const atkEdge = Math.max(0, atk - 8);
  return {
    passBoost: clamp(atkEdge * 0.010, 0, 0.24),   // pass/pressResistance
    shotBoost: clamp(atkEdge * 0.018, 0, 0.55),   // 슛 affinity ×(1+x)
    gkBoost: clamp(Math.max(0, def - 8) * 0.006, 0, 0.18),
  };
}

// 순수 미리보기 — 이 포지션을 한 레벨 올리면 다음 경기에서 무엇이 달라지는지.
// 클럽 상태를 변경하지 않는다(renderHub가 매번 호출해도 안전). 다음 상대 기준 승률 변화 포함.
export function upgradePreview(key) {
  const pos = POSITIONS.find((p) => p.key === key);
  const atk0 = attackOVR(), def0 = defenseOVR();
  const atk1 = atk0 + (pos?.atk ?? 0), def1 = def0 + (pos?.def ?? 0);
  const b0 = boostsFor(atk0, def0), b1 = boostsFor(atk1, def1);
  const oppOVR = oppBaseOVR();
  const winOf = (atk, def) => Math.round(clamp((atk + def) / (atk + def + oppOVR), 0.08, 0.92) * 100);
  return {
    atk: { from: Math.round(atk0), to: Math.round(atk1) },
    def: { from: Math.round(def0), to: Math.round(def1) },
    pass: { from: b0.passBoost, to: b1.passBoost },
    shot: { from: b0.shotBoost, to: b1.shotBoost },
    gk: { from: b0.gkBoost, to: b1.gkBoost },
    win: { from: winOf(atk0, def0), to: winOf(atk1, def1) },
  };
}

// 클럽 상태 + 상대 OVR → 이번 매치의 셋업(엔진 옵션 + 트레잇 부스트 + 실점 모델).
export function matchSetup(oppOVR) {
  const atk = attackOVR();
  const def = defenseOVR();
  const team = atk + def;
  const pm = philoMods();

  // 상대 압박: 게겐 'pressRelief'면 팀을 효과적으로 더 강하게 봐 압박이 가벼워진다.
  const rel = oppOVR / Math.max(1, team * (1 + pm.pressRelief * 0.08));
  let intensity;
  if (rel < 0.82) intensity = 'mid';
  else if (rel < 1.18) intensity = 'high';
  else intensity = 'vhigh';

  // 공격 레벨 → 패스/슈팅 트레잇(boostsFor) + 철학 패스 보너스 가산.
  const b = boostsFor(atk, def);
  const passBoost = clamp(b.passBoost + pm.passBoostAdd, 0, 0.32);

  return {
    intensity, passBoost, shotBoost: b.shotBoost, gkBoost: b.gkBoost,
    xgMul: pm.xgMul,                 // 철학 마무리 배율 (applyClubBoost·스코어 공유)
    oppOVR, teamOVR: team, atk, def,
    odds: oddsFromRatio(team, oppOVR),
  };
}

// 엔진 생성 직후 호출 — 'us' 선수 traits를 셋업만큼 끌어올린다.
export function applyClubBoost(engine, setup) {
  for (const p of engine.state.players) {
    if (p.side !== 'us') continue;
    const t = { ...(p.traits || {}) };
    t.pass = clamp((t.pass ?? 0.7) + setup.passBoost, 0, 0.98);
    t.pressResistance = clamp((t.pressResistance ?? 0.7) + setup.passBoost, 0, 0.98);
    t.longPass = clamp((t.longPass ?? 0.5) + setup.passBoost * 0.7, 0, 0.98);
    if (t.carry != null) t.carry = clamp(t.carry + setup.passBoost * 0.6, 0, 0.98);
    if (p.role === 'GK') t.keeping = clamp((t.keeping ?? 0.75) + setup.gkBoost, 0, 0.98);
    // 마무리: 보유한 슛 존 affinity를 일괄 스케일 (강화 + 철학 xgMul)
    if (t.shot && typeof t.shot === 'object') {
      const shot = {};
      const mul = (1 + setup.shotBoost) * (setup.xgMul || 1);
      for (const k of Object.keys(t.shot)) shot[k] = t.shot[k] * mul;
      t.shot = shot;
    }
    p.traits = t;
  }
}

// 수행 품질(전술 모먼트를 얼마나 잘 풀었나) + 수비 + 철학 → 스코어라인.
// perf: 'goal'|'near'|'fail' 문자열, 또는 { tone, baits, linesBroken, switches, runs, windowsUsed, situationsResolved, decisionsMade, xg }.
// 잘 풀수록(지배력↑) 다득점(0~3)·점수차·실점 억제 — "내 전술이 결과를 바꾼다".
export function resolveScoreline(perf, setup, rngNext, pmods = philoMods()) {
  const P = typeof perf === 'string' ? { tone: perf } : (perf || {});
  const tone = P.tone || 'fail';

  // 빌드업 품질(압박을 얼마나 흔들었나) + 슛 품질
  const execRaw = (P.baits || 0) * 0.05 + (P.linesBroken || 0) * 0.12 + (P.switches || 0) * 0.08
                + (P.runs || 0) * 0.05 + (P.windowsUsed || 0) * 0.10
                + (P.situationsResolved || 0) * 0.09 + (P.decisionsMade || 0) * 0.04;
  const exec = clamp(execRaw * (pmods.execMul || 1), 0, 0.8);
  const xg = clamp((P.xg || 0) * (pmods.xgMul || 1), 0, 1);
  const edge = clamp((setup.atk - 8) / 40, 0, 0.5);          // 공격 전력 우위
  const dominance = clamp(exec + xg * 0.35 + edge * 0.4, 0, 1);

  let ourGoals = 0;
  if (tone === 'goal') {
    ourGoals = 1;
    const p2 = clamp(dominance * 0.55 + (pmods.secondGoalBonus || 0), 0, 0.85);
    if (rngNext() < p2) {
      ourGoals = 2;
      if (rngNext() < dominance * 0.30) ourGoals = 3;         // 압도적일 때만 3골
    }
  } else if (tone === 'near') {
    if (rngNext() < clamp(exec + xg * 0.4 - 0.15, 0, 0.4)) ourGoals = 1; // 리바운드/세컨볼
  } // fail → 0

  // 실점: 상대 공격 vs 수비, 지배력만큼 감소, 철학 concedeMul, fail이면 가산(역습 relief 반영).
  const oppAtk = setup.oppOVR * 0.5;
  let concedeP = clamp(oppAtk / (oppAtk + setup.def * 1.5), 0.05, 0.85);
  concedeP *= (pmods.concedeMul || 1);
  concedeP *= (1 - dominance * 0.35);
  if (tone === 'fail') concedeP += 0.18 * (1 - (pmods.failConcedeRelief || 0));
  concedeP = clamp(concedeP, 0.02, 0.92);

  let oppGoals = 0;
  if (rngNext() < concedeP) oppGoals += 1;
  if (rngNext() < concedeP * 0.45) oppGoals += 1;

  const result = ourGoals > oppGoals ? 'w' : ourGoals < oppGoals ? 'l' : 'd';
  return {
    ourGoals, oppGoals, result, cleanSheet: oppGoals === 0,
    dominance: +dominance.toFixed(2), exec: +exec.toFixed(2), xg: +xg.toFixed(2),
  };
}

function oddsFromRatio(team, oppOVR) {
  const w = clamp(team / (team + oppOVR), 0.08, 0.9);
  const d = clamp(0.30 * (1 - Math.abs(0.5 - w) * 1.3), 0.10, 0.34);
  const l = clamp(1 - w - d, 0.04, 0.9);
  const sum = w + d + l;
  return { win: Math.round((w / sum) * 100), draw: Math.round((d / sum) * 100), loss: Math.round((l / sum) * 100) };
}
