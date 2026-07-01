// Phase 1 — 읽기 전용 opp 빌드업 dry-run. docs/symmetric-duel-design.md.
//
// "상대가 지금 공을 잡고 빌드업한다면 무엇을 할까?" 를 엔진을 한 톨도 바꾸지 않고
// 관측한다. mirror 로 opp 를 'us 관점(+x 전진)'으로 돌린 뒤, 위치 데이터만으로
// 패스 후보를 읽어 best/gamble/trap 을 낸다. 결과 좌표는 원래(언미러) 프레임으로도 같이 준다.
//
// Phase 1 범위: 이것은 "dry-run 근사"다 — 엔진의 정식 scanOptions/마무리 로직을 그대로
// 재사용하는 통합은 Phase 2(로컬 런타임 검증)에서 한다. 지금 목적은 (1) 관측 가능성과
// (2) 미러 파이프라인을 read-only 로 확정하는 것.
//
// 순수·읽기 전용 — state 를 변경하지 않고 engine.js 를 import 하지 않는다(샌드박스 테스트 가능).

import { clamp } from '../data/pitch.js';
import { mirrorState, mirrorPoint } from './mirror.js';

// 점 p 에서 선분 a→b 까지 최단 거리(패스 레인에 가장 가까운 수비수 거리 계산용).
function pointToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function minLaneDist(a, b, defenders) {
  let min = Infinity;
  for (const d of defenders) min = Math.min(min, pointToSegment(d, a, b));
  return Number.isFinite(min) ? min : 50;
}

// engine 또는 engine.state 어느 쪽을 받아도 동작.
export function oppBuildDryRun(engineOrState, options = {}) {
  const state = engineOrState?.state ?? engineOrState;
  if (!state || state.status !== 'live' || !Array.isArray(state.players)) return null;

  const m = mirrorState(state);                              // opp → side 'us', +x 전진
  const builders = m.players.filter((p) => p.side === 'us'); // 상대(미러됨) = 빌드업 팀
  const defenders = m.players.filter((p) => p.side === 'opp'); // 우리(미러됨) = 수비
  if (builders.length < 2) return null;

  const actualHolder = builders.find((p) => p.id === state.holderId) ?? null;
  const holder = actualHolder ?? [...builders].sort((a, b) => a.x - b.x)[0];
  const mates = builders.filter((p) => p.id !== holder.id && p.x > holder.x - 2);
  const limit = options.limit ?? 8;

  const candidates = mates.map((t) => {
    const progress = t.x - holder.x;                         // 미러 +x = 상대 공격 방향
    const risk = clamp(1 - minLaneDist(holder, t, defenders) / 18, 0.05, 0.95);
    const safety = 1 - risk;
    const reward = clamp(progress / 48, 0, 0.6) + safety * 0.3;
    return {
      action: 'to_feet', type: 'pass',
      target: { id: t.id, label: t.label, x: t.x, y: t.y },  // 미러 프레임
      targetReal: mirrorPoint(t),                            // 원래(언미러) 좌표 — 리포트·렌더용
      progress, risk, safety, reward,
      net: reward - risk * 0.6,
    };
  }).sort((a, b) => b.net - a.net).slice(0, limit);

  const base = {
    possession: 'opp',
    holderId: holder.id,
    holderAssumption: actualHolder ? 'actual' : 'deepest',
    holderReal: mirrorPoint(holder),
    candidates,
    mirrored: true,
  };
  if (!candidates.length) return { ...base, best: null, gamble: null, trap: null };

  const best = candidates[0];
  const gamble = candidates.find((c) => c !== best && c.reward >= 0.4 && c.risk >= 0.3)
    ?? candidates[1] ?? null;
  const trap = [...candidates].filter((c) => c !== best).sort((a, b) => b.risk - a.risk)[0] ?? null;
  return { ...base, best, gamble, trap };
}
