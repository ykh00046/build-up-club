// 상대 지휘자(에이전트 듀얼/C단계) — 수비 국면에서 상대 전개 성향을 상황에
// 반응해 교체한다. B단계에서 엔진에 열어둔 setOpponentDisposition 훅의 실사용자.
//
// 순수 함수: (엔진 state 읽기, 기본 성향) → 성향. 엔진/DOM import 없음이라
// 샌드박스에서 단독 테스트 가능하다. 실제 훅 호출은 main.js가 한다.
//
// 듀얼 감각의 규칙 3개 (우선순위 순):
// 1. 이 경기에서 이미 여러 번 뺏겼다(defensivePressWins≥2) → 데인 상대는
//    위험을 접는다: safe. (경기 단위 기억 — 우리 압박이 잘 먹히면 상대가 움츠림)
// 2. 우리가 내려서기만 반복한다(contained≥2) → 수동적 블록은 직선 침투로
//    처벌: direct. (내려서기 스팸의 카운터 — 안전 버튼이 공짜가 아니게)
// 3. 우리 강압박을 한 번이라도 벗겨냈다(beaten≥1) → 기세를 타고 과감하게:
//    aggressive. (압박 실패의 비용이 슛각 헌납에서 전개 위험까지 번짐)
// 해당 없음 → 매치데이 페르소나(base) 유지. base는 season.opponentDisposition.

export function commandOpponent(state, base = null) {
  const dl = state?.defenseLoop;
  if (!dl) return base;
  if ((state.facts?.defensivePressWins ?? 0) >= 2) return 'safe';
  if (dl.contained >= 2) return 'direct';
  if (dl.beaten >= 1) return 'aggressive';
  return base;
}
