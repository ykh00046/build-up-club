// 통합의 핵심 — 클럽 업그레이드를 전술 코어에 연결하는 글루.
//
// 엔진 내부는 한 줄도 고치지 않는다. 비결: 선수 traits(pass/shot/keeping)는
// dispatch 시점에 실시간으로 읽히므로(engine.js·shots.js), createEngine 직후
// 'us' 선수의 traits를 클럽 공격 레벨만큼 부스트하면 전술 플레이 전체가
// 그만큼 쉬워진다. 상대 강도는 intensityOverride(압박 mid/high/vhigh)로 전달.
//
// 그래서 업그레이드는 숫자놀음이 아니라 "패스가 덜 끊기고 슛이 더 들어가는"
// 체감으로 돌아온다. 수비 레벨은 경기 후 실점 시뮬(simConcede)로 작동한다.

import { activeTrainingEffects, attackOVR, defenseOVR, teamOVR, oppBaseOVR, POSITIONS, club } from './club.js';
import { philoMods } from './philosophy.js';
import { activeIdentityLevel, scanFactor } from './identity.js';
import { buildSalida32, buildDoublePivot23, build433Ours } from '../data/formations.js';
import { deliveryBonus } from '../data/setpieces.js';
import { roleMods } from '../data/roles.js';

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// 빌드업 셰이프 (enhancement-plan E6, research §2.4). 경기 전 선택으로 구조와
// 트레이드오프를 바꾼다. builder=null이면 시나리오 고유 셰이프를 유지(기본).
//  - balanced : 살리다 3-2 — 첫 줄 안정, 보정 중립(기본)
//  - control  : 인버티드 풀백/더블피벗 — 중앙 통제·레스트 디펜스(실점↓), 마무리 살짝↓
//  - attack   : 3-2-5 전진 — 전방 위협(마무리·xG↑), 배후 노출로 실점↑
export const BUILD_SHAPES = {
  balanced: { key: 'balanced', label: '균형', sub: '살리다 3-2', desc: '안정적 첫 줄 빌드업 — 보정 중립', builder: null, mods: {} },
  control: { key: 'control', label: '통제', sub: '인버티드 풀백', desc: '중앙 통제·역습 차단(실점↓), 마무리 살짝↓', builder: buildDoublePivot23, mods: { passAdd: 0.02, shotMul: 0.95, concedeMul: 0.93 } },
  attack: { key: 'attack', label: '공격', sub: '3-2-5 전진', desc: '전방 위협·xG↑, 배후 노출로 실점↑', builder: build433Ours, mods: { shotAdd: 0.05, xgMul: 1.05, concedeMul: 1.10 } },
};

// 선택한 셰이프의 트레이드오프를 setup에 반영(킥오프 직전 호출). setup을 직접 수정.
export function applyShape(setup, key) {
  const shape = BUILD_SHAPES[key];
  if (!setup || !shape) return setup;
  const m = shape.mods;
  setup.passBoost = clamp(setup.passBoost + (m.passAdd || 0), 0, 0.32);
  setup.shotBoost = clamp((setup.shotBoost + (m.shotAdd || 0)) * (m.shotMul || 1), 0, 0.6);
  setup.xgMul = (setup.xgMul || 1) * (m.xgMul || 1);
  setup.shapeConcedeMul = m.concedeMul || 1;
  setup.shape = key;
  return setup;
}

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

  // 선수 롤(E8): 중원/전방 롤의 트레이드오프를 합산.
  const rmMf = roleMods('mf', club.roles?.mf), rmFw = roleMods('fw', club.roles?.fw);
  const rolePassAdd = (rmMf.passAdd || 0) + (rmFw.passAdd || 0);
  const roleShotAdd = (rmFw.shotAdd || 0);
  const roleXgMul = (rmFw.xgMul || 1);
  const roleConcedeMul = (rmMf.concedeMul || 1) * (rmFw.concedeMul || 1);
  const roleSecondGoalAdd = (rmMf.secondGoalAdd || 0) + (rmFw.secondGoalAdd || 0);
  const roleSetPieceAdd = (rmMf.setPieceAdd || 0) + (rmFw.setPieceAdd || 0);

  // 공격 레벨 → 패스/슈팅 트레잇(boostsFor) + 철학 패스 보너스 가산 + 롤.
  const b = boostsFor(atk, def);
  const passBoost = clamp(b.passBoost + pm.passBoostAdd + rolePassAdd, 0, 0.32);
  const trainingEffects = activeTrainingEffects();
  const trainingScore = trainingEffects.reduce((acc, effect) => {
    const score = effect.score || {};
    acc.execAdd += Number(score.execAdd || 0);
    acc.xgMul *= Number(score.xgMul || 1);
    acc.concedeMul *= Number(score.concedeMul || 1);
    return acc;
  }, { execAdd: 0, xgMul: 1, concedeMul: 1 });

  return {
    intensity, passBoost,
    shotBoost: clamp(b.shotBoost + roleShotAdd, 0, 0.6),   // + 롤(인사이드 포워드)
    gkBoost: b.gkBoost,
    xgMul: pm.xgMul * roleXgMul,     // 철학 마무리 배율 × 롤 (applyClubBoost·스코어 공유)
    oppOVR, teamOVR: team, atk, def,
    trainingEffects,
    trainingScore,
    scan: scanFactor(),              // 스캐닝(E7) — applyClubBoost·UI 공유
    setPieceCoach: club.setPieceCoach || 0,   // 세트피스 코치 레벨(E5)
    roleConcedeMul, roleSecondGoalAdd, roleSetPieceAdd,   // 선수 롤(E8)
    odds: oddsFromRatio(team, oppOVR),
  };
}

// 선택한 세트피스 딜리버리를 setup에 반영(킥오프 직전, applyShape와 같은 패턴). E5.
export function applySetPiece(setup, delivery, scheme) {
  if (!setup) return setup;
  setup.delivery = delivery || null;
  setup.deliveryBonus = delivery ? deliveryBonus(delivery, scheme) : 0;
  return setup;
}

// 엔진 생성 직후 호출 — 'us' 선수 traits를 셋업만큼 끌어올린다.
export function applyClubBoost(engine, setup) {
  engine.state.trainingEffects = setup.trainingEffects || [];
  engine.state.identityLevel = activeIdentityLevel();
  // 스캐닝(E7): 수신 전 지각 — 전진 패스·압박 저항을 소폭 안정화(닫힌 몸 위험 완화).
  const scan = setup.scan ?? scanFactor();
  engine.state.scanFactor = scan;
  for (const p of engine.state.players) {
    if (p.side !== 'us') continue;
    const t = { ...(p.traits || {}) };
    t.pass = clamp((t.pass ?? 0.7) + setup.passBoost, 0, 0.98);
    t.pressResistance = clamp((t.pressResistance ?? 0.7) + setup.passBoost + scan * 0.06, 0, 0.98);
    t.longPass = clamp((t.longPass ?? 0.5) + setup.passBoost * 0.7 + scan * 0.04, 0, 0.98);
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

  // 오버로드-투-아이솔레이트(질적 우위, E3): 한쪽을 유인(baits)한 뒤 전환(switch)하면
  // 반대편 1v1 고립이 만들어진다. 모두에게 열린 베이스 보상(wing execMul이 추가 증폭).
  const isolation = ((P.baits || 0) >= 2 && (P.switches || 0) >= 1) ? 0.08 : 0;
  // 빌드업 품질(압박을 얼마나 흔들었나) + 슛 품질
  const execRaw = (P.baits || 0) * 0.05 + (P.linesBroken || 0) * 0.12 + (P.switches || 0) * 0.08
                + (P.runs || 0) * 0.05 + (P.windowsUsed || 0) * 0.10
                + (P.situationsResolved || 0) * 0.09 + (P.decisionsMade || 0) * 0.04 + isolation;
  const trainingScore = setup.trainingScore || {};
  const exec = clamp(execRaw * (pmods.execMul || 1) + (trainingScore.execAdd || 0), 0, 0.8);
  const xg = clamp((P.xg || 0) * (pmods.xgMul || 1) * (trainingScore.xgMul || 1), 0, 1);
  const edge = clamp((setup.atk - 8) / 40, 0, 0.5);          // 공격 전력 우위
  const dominance = clamp(exec + xg * 0.35 + edge * 0.4, 0, 1);

  // 게임스테이트 (E4, research §3.2). 기본값(모멘텀 50·피로 0)은 중립 → 엔진 없이
  // 돌리는 career-sim 회귀에는 영향 없음. 실제 경기에서만 엔진 상태가 흘러든다.
  const momentum = P.momentum ?? 50;
  const fatigue = P.fatigue || 0;
  const momFac = clamp(0.85 + (momentum / 100) * 0.30, 0.7, 1.2);  // 모멘텀↑ → 다득점↑

  let ourGoals = 0;
  if (tone === 'goal') {
    ourGoals = 1;
    // 다득점은 '수행(dominance)'이 주도, 퍽은 보조(×0.55) — 퍽 누적만으로 보장되지 않게.
    // 배율 스택을 막기 위해 2골 상한도 0.72로 제한(상위 디비전 스윙 완화). 모멘텀이 추가 변조.
    const p2 = clamp((dominance * 0.50 + (pmods.secondGoalBonus || 0) * 0.55 + (setup.roleSecondGoalAdd || 0)) * momFac, 0, 0.72);  // + 롤(메짤라)
    if (rngNext() < p2) {
      ourGoals = 2;
      // 3골은 진짜 압도적일 때만 — dominance 0.6 초과분에 비례(최대 ~24%).
      if (dominance > 0.6 && rngNext() < (dominance - 0.6) * 0.6) ourGoals = 3;
    }
  } else if (tone === 'near') {
    if (rngNext() < clamp(exec + xg * 0.4 - 0.15, 0, 0.4)) ourGoals = 1; // 리바운드/세컨볼
  } // fail → 0

  // 세트피스 채널 (E5, §3.3): 저분산 득점원. 실제 경기엔 항상 delivery가 있고
  // (브리핑 선택), career-sim 회귀엔 없어 rng 미소비 → 시퀀스 불변. 코치 레벨·
  // 마킹 상성·공격 전력이 전환 확률을 끌어올린다.
  let setPieceGoal = false;
  if (setup.delivery) {
    const coach = clamp(setup.setPieceCoach || 0, 0, 3);
    const spEdge = clamp((setup.atk - 8) / 40, 0, 0.3);
    // 보조 득점원으로 조정(밸런스 튜닝): 코치 없이 ~9%, 풀투자 ~21% 상한.
    // 오픈플레이 빌드업이 주(主), 세트피스는 보(補).
    const spP = clamp(0.025 + coach * 0.03 + (setup.deliveryBonus || 0) * 0.04 + spEdge * 0.08 + (setup.roleSetPieceAdd || 0), 0, 0.22);  // + 롤(타깃맨)
    if (rngNext() < spP) { ourGoals += 1; setPieceGoal = true; }
  }

  // 실점: 상대 공격 vs 수비, 지배력만큼 감소, 철학 concedeMul, fail이면 가산(역습 relief 반영).
  const oppAtk = setup.oppOVR * 0.5;
  let concedeP = clamp(oppAtk / (oppAtk + setup.def * 1.5), 0.05, 0.85);
  concedeP *= (pmods.concedeMul || 1);
  concedeP *= (trainingScore.concedeMul || 1);
  concedeP *= (setup.shapeConcedeMul || 1);   // 빌드업 셰이프 트레이드오프 (E6)
  concedeP *= (setup.roleConcedeMul || 1);     // 선수 롤 트레이드오프 (E8, 레지스타)
  concedeP *= (1 - dominance * 0.35);
  // 수비 전환(E1, §3.1): 볼 상실 시 역습 노출. 단, 지배력이 높았다면 레스트 디펜스가
  // 갖춰져 카운터프레스로 회복 — 통제된 상실일수록 역습 페널티가 줄어든다.
  if (tone === 'fail') concedeP += 0.18 * (1 - dominance * 0.40) * (1 - (pmods.failConcedeRelief || 0));
  concedeP = clamp(concedeP, 0.02, 0.92);

  let oppGoals = 0;
  if (rngNext() < concedeP) oppGoals += 1;
  if (rngNext() < concedeP * 0.45) oppGoals += 1;
  // 후반 피로 — 골은 막판에 몰린다(§3.2). 피로가 쌓였을 때만 늦은 실점 롤(피로 0이면
  // rng를 소비하지 않아 career-sim 시퀀스 불변).
  if (fatigue > 0 && rngNext() < concedeP * (fatigue / 100) * 0.5) oppGoals += 1;

  const result = ourGoals > oppGoals ? 'w' : ourGoals < oppGoals ? 'l' : 'd';
  return {
    ourGoals, oppGoals, result, cleanSheet: oppGoals === 0, setPieceGoal,
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
