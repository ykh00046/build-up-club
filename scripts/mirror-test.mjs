// Phase 1 좌표 미러 회귀 — docs/symmetric-duel-design.md.
// engine.js 를 import 하지 않으므로 (pitch.js + mirror.js 만) 샌드박스에서도 실행된다.
// 미러가 involution 이고, 대칭 포지션이 미러의 고정점임을 고정한다 — 50:50 불변식의 토대.

import { PITCH_W, PITCH_H } from '../js/data/pitch.js';
import {
  mirrorX, mirrorY, mirrorPoint, swapSide, mirrorPlayer, mirrorPlayers, mirrorState,
} from '../js/engine/mirror.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log('=== 좌표 미러 테스트 (Phase 1) ===\n');

// [1] 축 미러 — 경계 스왑 + 중앙 고정점
ok(near(mirrorX(0), PITCH_W) && near(mirrorX(PITCH_W), 0), 'mirrorX 가 좌우 경계를 스왑');
ok(near(mirrorX(PITCH_W / 2), PITCH_W / 2), 'mirrorX 중앙은 고정점');
ok(near(mirrorY(0), PITCH_H) && near(mirrorY(PITCH_H / 2), PITCH_H / 2), 'mirrorY 경계 스왑·중앙 고정');

// [2] 점 미러 involution
const pts = [{ x: 12, y: 7 }, { x: 80, y: 51 }, { x: 33.5, y: 18.2 }];
ok(pts.every((p) => { const d = mirrorPoint(mirrorPoint(p)); return near(d.x, p.x) && near(d.y, p.y); }),
  'mirrorPoint 은 involution (미러∘미러 = 항등)');

// [3] side 스왑
ok(swapSide('us') === 'opp' && swapSide('opp') === 'us', 'swapSide us↔opp');
ok(swapSide(swapSide('us')) === 'us', 'swapSide 도 involution');

// [4] 선수 미러 — side 스왑 + 좌표 회전, 식별자 보존, 더블 미러 복원
const pl = { id: 'us-cm', label: 'CM', role: 'CM', side: 'us', x: 30, y: 20, homeX: 31, homeY: 21, rx: 28, ry: 19, traits: { pass: 0.8 } };
const m = mirrorPlayer(pl);
ok(m.side === 'opp', '선수 미러: side 스왑');
ok(near(m.x, PITCH_W - 30) && near(m.y, PITCH_H - 20), '선수 미러: 좌표 180° 회전');
ok(near(m.homeX, PITCH_W - 31) && near(m.homeY, PITCH_H - 21), '선수 미러: home 앵커도 회전');
ok(m.id === 'us-cm' && m.label === 'CM' && m.traits.pass === 0.8, '선수 미러: id/label/traits 보존');
const mm = mirrorPlayer(m);
ok(mm.side === 'us' && near(mm.x, 30) && near(mm.y, 20) && near(mm.homeX, 31), '선수 더블 미러 = 원본');

// [5] 상태 미러 — opp 점유가 us 관점으로, holderId 보존, 더블 미러 복원
const state = {
  status: 'live', phase: 'BUILDUP', holderId: 'opp-cb',
  players: [
    { id: 'opp-cb', side: 'opp', x: 20, y: 34 },
    { id: 'us-st', side: 'us', x: 90, y: 34 },
  ],
  ball: { x: 20, y: 34 },
  rewardWindow: { x: 42, y: 20, r: 6, kind: 'real' },
  transition: { kind: 'intercepted', loss: { x: 38, y: 50 }, msLeft: 3000, regainP: 0.4 },
};
const ms = mirrorState(state);
const holderInMirror = ms.players.find((p) => p.id === 'opp-cb');
ok(ms.holderId === 'opp-cb', '상태 미러: holderId 보존(같은 선수)');
ok(holderInMirror.side === 'us', '상태 미러: opp 점유자가 us 관점으로 보임');
ok(near(holderInMirror.x, PITCH_W - 20), '상태 미러: 점유자 좌표 회전');
ok(near(ms.ball.x, PITCH_W - 20), '상태 미러: 볼 좌표 회전');
ok(near(ms.rewardWindow.x, PITCH_W - 42) && near(ms.rewardWindow.y, PITCH_H - 20), '상태 미러: 리워드 윈도우 좌표 회전');
ok(near(ms.transition.loss.x, PITCH_W - 38) && near(ms.transition.loss.y, PITCH_H - 50), '상태 미러: 전환 손실 지점 회전');
const back = mirrorState(ms);
ok(back.players.find((p) => p.id === 'opp-cb').side === 'opp' && near(back.players.find((p) => p.id === 'opp-cb').x, 20),
  '상태 더블 미러 = 원본');

// [6] 대칭 포지션은 미러의 고정점 — 50:50 불변식의 기반
// 각 us 선수에 대해 (W-x, H-y, opp) 짝을 둔 점대칭 포메이션을 만들면,
// 미러한 집합이 원래 집합과 (멀티셋으로) 같아야 한다.
function symmetricFormation() {
  const base = [[25, 15], [25, 53], [40, 34], [55, 20], [55, 48]];
  const players = [];
  for (const [x, y] of base) {
    players.push({ id: `us-${x}-${y}`, side: 'us', x, y });
    players.push({ id: `opp-${x}-${y}`, side: 'opp', x: PITCH_W - x, y: PITCH_H - y });
  }
  return players;
}
function keySet(players) {
  return new Set(players.map((p) => `${p.side}:${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`));
}
const sym = symmetricFormation();
const symMirrored = mirrorPlayers(sym);
const a = keySet(sym), b = keySet(symMirrored);
const sameSet = a.size === b.size && [...a].every((k) => b.has(k));
ok(sameSet, '대칭 포지션은 미러 고정점 (구조 비대칭 0 → 50:50 불변식 토대)');

console.log(fail === 0 ? '\n좌표 미러 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
