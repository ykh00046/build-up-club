// Phase 1 좌표 미러 — docs/symmetric-duel-design.md.
//
// 비점유 측(opp)이 점유로 바뀌면, 보드를 180° 회전(x→W-x, y→H-y)하고 side 라벨을
// 스왑해 엔진에 "항상 +x로 전진하는 us"처럼 보여준다. 그러면 같은 빌드업 로직을
// 양측이 공유할 수 있다(체스의 side-to-move 보드 플립과 동일한 기법).
//
// 왜 x만이 아니라 180°(x·y 둘 다)인가:
//   x만 뒤집으면 좌우(윙)가 거울처럼 바뀌어 선수 역할/풋이 어긋난다. 180° 점대칭은
//   상대의 공격 셋업을 우리 좌표계로 "방향만" 돌려놓아 좌우 일관성을 보존한다.
//
// 순수 함수 — 엔진을 import 하지 않는다. 그래서 engine.js 없이 단독 테스트가 된다.
// 미러는 involution: mirror(mirror(x)) === x.

import { PITCH_W, PITCH_H } from '../data/pitch.js';

export function mirrorX(x) { return PITCH_W - x; }
export function mirrorY(y) { return PITCH_H - y; }
export function mirrorPoint(p) { return { ...p, x: PITCH_W - p.x, y: PITCH_H - p.y }; }

const SWAP_SIDE = { us: 'opp', opp: 'us' };
export function swapSide(side) { return SWAP_SIDE[side] ?? side; }

// 좌표를 가진 보조 필드까지 회전(애니메이션 시작 fx/fy, 정착 rx/ry, 목표 tx/ty).
function mirrorCoord(v) { return v == null ? v : PITCH_W - v; }
function mirrorCoordY(v) { return v == null ? v : PITCH_H - v; }

// 선수 한 명 미러 — 좌표 회전 + side 스왑. id/label/traits/role 등은 보존.
export function mirrorPlayer(p) {
  return {
    ...p,
    x: PITCH_W - p.x, y: PITCH_H - p.y,
    homeX: mirrorCoord(p.homeX), homeY: mirrorCoordY(p.homeY),
    rx: mirrorCoord(p.rx), ry: mirrorCoordY(p.ry),
    fx: mirrorCoord(p.fx), fy: mirrorCoordY(p.fy),
    tx: mirrorCoord(p.tx), ty: mirrorCoordY(p.ty),
    side: swapSide(p.side),
  };
}

export function mirrorPlayers(players = []) { return players.map(mirrorPlayer); }

// 상태 스냅샷 미러 — opp 점유 국면을 "us가 +x로 빌드업"하는 읽기 전용 관점으로 변환.
// 엔진 state 를 변경하지 않고 새 객체를 반환한다(정책·평가용). holderId 는 같은
// 선수를 가리키므로 보존(미러는 좌표/side 라벨만 바꾼다).
export function mirrorState(state) {
  if (!state) return state;
  return {
    ...state,
    players: mirrorPlayers(state.players),
    ball: state.ball ? mirrorPoint(state.ball) : state.ball,
    rewardWindow: mirrorMaybePoint(state.rewardWindow),
    transition: state.transition
      ? { ...state.transition, loss: mirrorMaybePoint(state.transition.loss) }
      : state.transition,
  };
}

// 결과 좌표를 원래 관점으로 되돌릴 때(렌더/실측). 미러가 involution 이므로 동일 함수.
export const unmirrorPoint = mirrorPoint;
export const unmirrorState = mirrorState;

function mirrorMaybePoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? mirrorPoint(value) : value;
}
