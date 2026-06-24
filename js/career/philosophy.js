// 클럽 철학(정체성) 분기 — 장기 성장의 갈래.
// 철학을 고르고, 철학 포인트(승격/우승/프레스티지로 획득)로 티어 퍼크를 해금하면
// 그 퍼크가 전술 매치(글루)와 수행기반 스코어(mods.resolveScoreline)에 영구 반영된다.
// → "내 전술 선택이 결과를 바꾼다" + "런마다 다른 클럽".

import { club } from './club.js';
import { activeIdentityLevel } from './identity.js';

export const PHILOSOPHIES = [
  {
    id: 'positional', name: '포지셔널', kicker: '점유 · 빌드업', color: '#5dd6c5',
    desc: '압박을 흔들어 만든 빌드업이 곧 결과. 잘 풀수록 다득점.',
    perks: [
      { id: 'pos1', name: '레인 장악',   desc: '패스 안정 +0.06',                 mod: { passBoostAdd: 0.06 } },
      { id: 'pos2', name: '제3의 침투',   desc: '빌드업 품질 가치 ↑ · 추가 득점 +12%', mod: { execMul: 1.35, secondGoalBonus: 0.12 } },
      { id: 'pos3', name: '완성형 점유',   desc: '실점 -15% · 추가 득점 +10%',       mod: { concedeMul: 0.85, secondGoalBonus: 0.10 } },
      { id: 'pos4', name: '점유 마스터리', desc: '[Lv4] 반복 패스 적응 완화 · 빌드업 가치 ↑', tier: 4, mod: { execMul: 1.15 } },
    ],
  },
  {
    id: 'direct', name: '역습', kicker: '다이렉트 · 전환', color: '#f5a623',
    desc: '잃어도 위험을 줄이고, 한 방의 마무리에 강하다.',
    perks: [
      { id: 'cnt1', name: '안정된 라인',   desc: '실점 -12%',                       mod: { concedeMul: 0.88 } },
      { id: 'cnt2', name: '한 방의 마무리', desc: '슛 마무리 +8%',                   mod: { xgMul: 1.08 } },
      { id: 'cnt3', name: '전광석화',      desc: '볼 로스트 시 역습 실점 위험 절반',  mod: { failConcedeRelief: 0.5 } },
      { id: 'cnt4', name: '침투 마에스트로', desc: '[Lv4] 침투 성공 후 득점 가치 ↑',   tier: 4, mod: { xgMul: 1.06 } },
    ],
  },
  {
    id: 'pressproof', name: '게겐프레스', kicker: '즉시 압박', color: '#e35d5d',
    desc: '상대 압박을 무디게 하고 되찾아 누른다.',
    perks: [
      { id: 'geg1', name: '압박 저항',    desc: '상대 압박 강도 완화',              mod: { pressRelief: 1 } },
      { id: 'geg2', name: '리게인',       desc: '실점 -10% · 패스 안정 +0.04',      mod: { concedeMul: 0.90, passBoostAdd: 0.04 } },
      { id: 'geg3', name: '질식 수비',     desc: '실점 -18%',                       mod: { concedeMul: 0.82 } },
      { id: 'geg4', name: '압박 정복자',   desc: '[Lv4] 압박 상황 대응력 강화',       tier: 4, mod: { pressRelief: 1 } },
    ],
  },
  {
    id: 'wing', name: '측면 공략', kicker: '폭 · 크로스', color: '#5aa9f0',
    desc: '폭을 넓혀 약측을 공략. 전환·측면 마무리에 강하다.',
    perks: [
      { id: 'wng1', name: '오버랩',       desc: '전환·측면 빌드업 가치 ↑',          mod: { execMul: 1.25 } },
      { id: 'wng2', name: '크로스 정확도', desc: '슛 마무리 +10%',                  mod: { xgMul: 1.10 } },
      { id: 'wng3', name: '양 측면 과부하', desc: '추가 득점 +15%',                  mod: { secondGoalBonus: 0.15 } },
      { id: 'wng4', name: '약측 지배자',   desc: '[Lv4] 전환 후 약측 우위 가치 ↑',    tier: 4, mod: { execMul: 1.15 } },
    ],
  },
];

export const NEUTRAL_MODS = { execMul: 1, xgMul: 1, concedeMul: 1, secondGoalBonus: 0, passBoostAdd: 0, pressRelief: 0, failConcedeRelief: 0 };

export function getPhilosophy(id) { return PHILOSOPHIES.find((p) => p.id === id) || null; }
export function currentPhilosophy() { return getPhilosophy(club.philosophy); }
export function isPerkUnlocked(perkId) { return !!(club.perks && club.perks[perkId]); }

// 현재(또는 지정) 철학에서 다음에 해금 가능한 퍼크 인덱스(티어 순서). 전부 해금이면 -1.
export function nextPerkIndex(philoId = club.philosophy) {
  const ph = getPhilosophy(philoId);
  if (!ph) return -1;
  for (let i = 0; i < ph.perks.length; i++) if (!isPerkUnlocked(ph.perks[i].id)) return i;
  return -1;
}

// 정체성 전환 — 장기 커밋 보상 (design §7.3 / roadmap P4 "전환 비용").
// 이전 정체성과 다른 id 로 전환 시: 이전 정체성 identityXp 20% 차감 +
// identityStreak 리셋. 같은 id 재선택 또는 최초 선택은 비용 없음. perks 보존.
export function choosePhilosophy(id) {
  if (!getPhilosophy(id)) return false;
  const prev = club.philosophy;
  if (prev && prev !== id) {
    club.identityXp = club.identityXp || {};
    if (typeof club.identityXp[prev] === 'number' && club.identityXp[prev] > 0) {
      club.identityXp[prev] = Math.floor(club.identityXp[prev] * 0.8);
    }
    club.identityStreak = { id: null, count: 0 };
  }
  club.philosophy = id;
  return true;
}

// 다음 티어 퍼크 해금(포인트 1 소모, 순서대로).
// T4(tier:4) 고유 퍼크는 현재 정체성 레벨이 Lv4 이상일 때만 해금(roadmap P4).
export function unlockNextPerk() {
  const ph = currentPhilosophy();
  if (!ph) return false;
  const idx = nextPerkIndex();
  if (idx < 0) return false;
  if ((club.philoPoints || 0) < 1) return false;
  const perk = ph.perks[idx];
  if (perk.tier === 4) {
    const lvl = activeIdentityLevel()?.level ?? 0;
    if (lvl < 4) return false;
  }
  club.philoPoints -= 1;
  club.perks = club.perks || {};
  club.perks[perk.id] = true;
  return true;
}

export function grantPhiloPoints(n) { club.philoPoints = (club.philoPoints || 0) + n; }

// 현재 철학의 해금된 퍼크 modifier 집계 — 매치/스코어 글루가 사용.
export function philoMods() {
  const m = { ...NEUTRAL_MODS };
  const ph = currentPhilosophy();
  if (!ph) return m;
  for (const perk of ph.perks) {
    if (!isPerkUnlocked(perk.id)) continue;
    const mod = perk.mod || {};
    if (mod.execMul) m.execMul *= mod.execMul;
    if (mod.xgMul) m.xgMul *= mod.xgMul;
    if (mod.concedeMul) m.concedeMul *= mod.concedeMul;
    if (mod.secondGoalBonus) m.secondGoalBonus += mod.secondGoalBonus;
    if (mod.passBoostAdd) m.passBoostAdd += mod.passBoostAdd;
    if (mod.pressRelief) m.pressRelief += mod.pressRelief;
    if (mod.failConcedeRelief) m.failConcedeRelief = Math.max(m.failConcedeRelief, mod.failConcedeRelief);
  }
  return m;
}
