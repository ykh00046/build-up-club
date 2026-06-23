// 시즌/매치데이 — 어떤 전술 시나리오로, 어떤 상대와 붙는지 결정.
// 디비전이 올라갈수록 더 까다로운 압박 스킴 풀로 로테이션한다(체감 난이도 곡선).
// 압박 '강도'는 mods.matchSetup의 intensityOverride가 따로 제어하므로, 여기선
// 스킴 '종류'의 다양성만 담당한다.

import { SCENARIOS } from '../data/scenarios.js';

// 디비전별 시나리오 풀(아래로 갈수록 상위 디비전). 셀은 scenarios.js 기준.
// 5부: 느슨한 지역/미드블록 → 1부: 대인·게겐 고강도까지.
const DIV_POOLS = [
  ['D2', 'C1', 'D1'],              // 5부 — 로우블록/지역, 입문
  ['C1', 'D1', 'A1'],              // 4부 — 지역 + 하이브리드 입문
  ['A1', 'A2', 'D1'],             // 3부 — 하이브리드 전방 압박
  ['A2', 'B1', 'C2'],             // 2부 — 대인 + 게겐 등장
  ['B1', 'B2', 'C2'],             // 1부 — 대인·게겐 고강도
];

export function scenarioCellForMatchday(divIdx, matchday) {
  const pool = DIV_POOLS[Math.min(divIdx, DIV_POOLS.length - 1)];
  return pool[matchday % pool.length];
}

export function scenarioForMatchday(divIdx, matchday) {
  return SCENARIOS[scenarioCellForMatchday(divIdx, matchday)] || SCENARIOS.A1;
}

// 상대 클럽명 생성 — 디비전이 높을수록 격이 오르는 느낌.
const PREFIX = ['Real', 'Inter', 'Athletic', 'Sporting', 'Dynamo', 'Olympic', 'United', 'City',
  'Borussia', 'Atlético', 'Racing', 'Union', 'Rovers', 'Wanderers'];
const PLACE = ['Verdano', 'Marília', 'Kessel', 'Porto Vale', 'Aldermoor', 'Steingau', 'Río Hondo',
  'Castellón', 'Northgate', 'Lindholm', 'Brakka', 'Sandoval', 'Querência', 'Holt'];
const SUFFIX_TOP = ['CF', 'FC', '1909', 'SC'];

// matchday를 시드로 결정적 생성(같은 경기 = 같은 이름).
export function opponentName(divIdx, matchday) {
  let h = (divIdx * 7919 + matchday * 104729 + 17) >>> 0;
  const pick = (arr) => arr[(h = (h * 1103515245 + 12345) >>> 0) % arr.length];
  const a = pick(PREFIX);
  const b = pick(PLACE);
  const tier = 5 - divIdx;
  const s = tier >= 3 ? pick(SUFFIX_TOP) : '';
  return `${a} ${b}${s ? ' ' + s : ''}`.trim();
}
