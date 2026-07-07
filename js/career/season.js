// 시즌/매치데이 — 어떤 전술 시나리오로, 어떤 상대와 붙는지 결정.
// 디비전이 올라갈수록 더 까다로운 압박 스킴 풀로 로테이션한다(체감 난이도 곡선).
// 압박 '강도'는 mods.matchSetup의 intensityOverride가 따로 제어하므로, 여기선
// 스킴 '종류'의 다양성만 담당한다.

import { SCENARIOS } from '../data/scenarios.js';

// 디비전별 시나리오 풀(아래로 갈수록 상위 디비전). 셀은 scenarios.js 기준.
// 5부: 느슨한 지역/미드블록 → 1부: 대인·게겐 고강도까지.
const DIV_POOLS = [
  ['D2', 'C1', 'D1'],              // 5부 — 로우블록/지역, 입문
  ['C1', 'D1', 'A1', 'E2'],       // 4부 — 지역 + 하이브리드 입문 + E2 하이브리드
  ['A1', 'A2', 'D1', 'E2'],       // 3부 — 하이브리드 전방 압박 + E2 하이브리드
  ['A2', 'B1', 'C2', 'E1'],       // 2부 — 대인 + 게겐 등장 + E1 게겐 거울매치
  ['B1', 'B2', 'C2', 'E1'],       // 1부 — 대인·게겐 고강도 + E1 게겐 거울매치
];

// 디비전 풀(셀 배열) 반환 — season-goals 가 타겟 셀을 정할 때 사용.
export function divisionPool(divIdx) {
  return DIV_POOLS[Math.min(divIdx, DIV_POOLS.length - 1)];
}

export function scenarioCellForMatchday(divIdx, matchday) {
  const pool = DIV_POOLS[Math.min(divIdx, DIV_POOLS.length - 1)];
  return pool[matchday % pool.length];
}

export function scenarioForMatchday(divIdx, matchday) {
  return SCENARIOS[scenarioCellForMatchday(divIdx, matchday)] || SCENARIOS.A1;
}

// 상대 전개 성향(에이전트 듀얼/C단계) — 볼 상실 후 수비 국면에서 상대가 고르는
// 루트의 위험 성향. 압박 스킴과 한 몸으로 묶는다: 게겐프레스 팀은 탈취 즉시
// 직선 역습이 정체성이고, 대인 고강도는 과감하게, 로우블록/지역은 신중하게 전개.
// 상위 디비전 풀일수록 man/gegen이 늘어 수비 국면 난이도 곡선이 자연히 생긴다.
const SCHEME_DISPOSITION = {
  lowblock: 'safe', zonal: 'safe',
  midblock: 'balanced', hybrid: 'balanced',
  man: 'aggressive', gegen: 'direct',
};

export function opponentDisposition(divIdx, matchday) {
  return SCHEME_DISPOSITION[scenarioForMatchday(divIdx, matchday)?.scheme] ?? 'balanced';
}

// ── 라이벌전(B3 시즌 서사) ────────────────────────────────────────────────
// 디비전마다 고정 라이벌 1팀 — 두 풀 사이클마다 한 번 재회하는 더비. 성향·스킴은
// 그 매치데이 로테이션 그대로(변장 없음), 대신 판이 커진다: 승리 정산 보너스 +50%,
// 허브·결과 카드에 더비 표식. 이름이 고정이라 "또 너냐"의 서사가 생긴다.
const RIVALS = ['Union Holt', 'Racing Brakka', 'Dynamo Kessel', 'Atlético Castellón', 'Inter Verdano'];
export function rivalName(divIdx) { return RIVALS[Math.min(divIdx, RIVALS.length - 1)]; }
export function isRivalMatchday(divIdx, matchday) {
  const pool = DIV_POOLS[Math.min(divIdx, DIV_POOLS.length - 1)];
  const cycle = pool.length * 2;
  return matchday % cycle === cycle - 1;
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
