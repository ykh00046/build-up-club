// Phase 2 소유권 전환 FSM — docs/symmetric-duel-design.md.
//
// "공을 잃거나(turnover), 압박으로 되찾거나(press_regain), 키퍼로 물러나거나(reset),
//  골/아웃 뒤 재시작(restart)" 할 때 — 누가 어디서 빌드업을 시작하는지를 순수하게 계산한다.
// engine.state 를 변경하지 않고 "무엇이 바뀌어야 하는지"(possession/holderId/phase/mirror)만 기술한다.
// engine.js 를 import 하지 않는다 → 샌드박스 단독 테스트 가능.
//
// mirror 플래그: 새 점유 측이 opp 면, 엔진은 Phase 1 좌표 미러로 그 측 빌드업을 돌려야 한다.

// 각 측의 공격 방향: us → +x, opp → -x.
export function attackDir(side) { return side === 'us' ? 1 : -1; }

function swap(side) { return side === 'us' ? 'opp' : 'us'; }

function holderSide(state) {
  const h = state.players?.find((p) => p.id === state.holderId);
  return h?.side ?? null;
}

// 한 측의 '가장 깊은 빌더' = 자기 진영(공격 반대 방향) 끝 선수. us=최소 x, opp=최대 x.
export function deepestBuilder(players = [], side, { includeGk = true } = {}) {
  const team = players.filter((p) => p.side === side && (includeGk || p.role !== 'GK'));
  if (!team.length) return null;
  const dir = attackDir(side);
  return team.reduce((deep, p) => ((dir > 0 ? p.x < deep.x : p.x > deep.x) ? p : deep));
}

export function goalkeeper(players = [], side) {
  return players.find((p) => p.side === side && p.role === 'GK') ?? deepestBuilder(players, side);
}

function nearestTo(players = [], side, pt) {
  if (!pt) return null;
  const team = players.filter((p) => p.side === side);
  if (!team.length) return null;
  const d2 = (p) => (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
  return team.reduce((best, p) => (d2(p) < d2(best) ? p : best));
}

// 전환 이벤트 → 다음 소유 상태(순수). null 이면 적용 불가.
// event: 'turnover' | 'press_regain' | 'reset' | 'restart'
export function resolvePossession(state, event, options = {}) {
  if (!state || !Array.isArray(state.players)) return null;
  const cur = state.possession ?? holderSide(state) ?? 'us';
  let possession = cur;
  let pick = null;
  switch (event) {
    case 'turnover':                 // 공 잃음 → 상대 점유, 상대 최후방 빌더부터
      possession = swap(cur);
      pick = deepestBuilder(state.players, possession);
      break;
    case 'press_regain':             // 압박 성공 → 압박 측 점유, 회복 지점에서 가장 가까운 선수
      possession = options.regainSide ?? swap(holderSide(state) ?? cur);
      pick = nearestTo(state.players, possession, options.at) ?? deepestBuilder(state.players, possession);
      break;
    case 'reset':                    // 키퍼 리셋 → 현재 점유 측 GK
      possession = cur;
      pick = goalkeeper(state.players, possession);
      break;
    case 'restart':                  // 골/아웃 후 재시작 → 지정 측(기본=상대) 킥오프
      possession = options.side ?? swap(cur);
      pick = deepestBuilder(state.players, possession);
      break;
    default:
      return null;
  }
  if (!pick) return null;
  return { possession, holderId: pick.id, phase: 'BUILDUP', mirror: possession === 'opp', event };
}
