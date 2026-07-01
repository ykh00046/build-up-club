// Phase 1 — 읽기 전용 opp 빌드업 dry-run 회귀. docs/symmetric-duel-design.md.
// engine.js 미import (pitch.js + mirror.js + dry-run.js) → 샌드박스 실행 가능.

import { PITCH_W, PITCH_H } from '../js/data/pitch.js';
import { oppBuildDryRun } from '../js/engine/dry-run.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK' : 'FAIL'} ${m}`); if (!c) fail++; };

// 합성 상태 — 상대(opp)는 -x로 공격(높은 x에서 빌드업 시작), 우리(us)는 수비.
// 좌표는 PITCH 비율로 둬서 정확한 치수와 무관하게 in-bounds.
function makeState() {
  const W = PITCH_W, H = PITCH_H;
  return {
    status: 'live', phase: 'BUILDUP', holderId: 'us-st',
    players: [
      { id: 'opp-gk', side: 'opp', x: W * 0.95, y: H * 0.50, label: 'GK' },
      { id: 'opp-cb', side: 'opp', x: W * 0.85, y: H * 0.42, label: 'CB' },
      { id: 'opp-cm', side: 'opp', x: W * 0.65, y: H * 0.55, label: 'CM' },
      { id: 'opp-st', side: 'opp', x: W * 0.42, y: H * 0.50, label: 'ST' },
      { id: 'us-st', side: 'us', x: W * 0.55, y: H * 0.50, label: 'ST' },
      { id: 'us-cb', side: 'us', x: W * 0.30, y: H * 0.45, label: 'CB' },
    ],
  };
}

console.log('=== opp 빌드업 dry-run 테스트 (Phase 1) ===\n');

// [1] 읽기 전용 — state 를 변경하지 않는다
const s = makeState();
const before = JSON.stringify(s);
const read = oppBuildDryRun(s);
ok(JSON.stringify(s) === before, 'dry-run 은 state 를 변경하지 않음(읽기 전용)');

// [2] 형태
ok(read && read.possession === 'opp', 'opp 점유 관점 반환');
ok(read.mirrored === true, '미러로 산출됨을 표시');
ok(Array.isArray(read.candidates) && read.candidates.length > 0, '빌드업 후보 존재');
ok(read.best && read.best.action === 'to_feet', 'best 패스 후보 존재');
ok(read.best.targetReal && Number.isFinite(read.best.targetReal.x), 'best 에 원래(언미러) 좌표 포함');

// [3] 가설 점유자 = 가장 깊은 빌더(상대 GK, 원래 최대 x)
ok(read.holderId === 'opp-gk', '가설 점유자 = 가장 깊은 빌더(GK)');
ok(read.holderAssumption === 'deepest', '비-opp 점유 상태에서는 최후방 빌더 가정');
ok(Math.abs(read.holderReal.x - PITCH_W * 0.95) < 1, 'holderReal 은 원래 좌표로 복원');

// [4] best 패스는 상대 공격 방향(원래 -x = 더 낮은 x)으로 전진
ok(read.best.targetReal.x < read.holderReal.x, 'best 패스는 상대 공격 방향(앞)으로 전진');
ok(read.candidates.every((c) => c.targetReal.x < read.holderReal.x + 1), '모든 후보가 전진성 패스');

// [5] 결정성 — 같은 입력 → 같은 best
const read2 = oppBuildDryRun(makeState());
ok(read2.best.target.id === read.best.target.id, '결정적(같은 입력 → 같은 best)');

// [6] 위험 의미 — 후보 risk/safety 가 0~1, net 정렬
ok(read.candidates.every((c) => c.risk >= 0 && c.risk <= 1 && c.safety >= 0 && c.safety <= 1), 'risk/safety 0~1');
ok(read.candidates.every((c, i, arr) => i === 0 || arr[i - 1].net >= c.net), 'net 내림차순 정렬');

// [7] 가드 — 비-live / 데이터 부족이면 null
ok(oppBuildDryRun({ ...makeState(), status: 'over' }) === null, '비-live 면 null');
ok(oppBuildDryRun(null) === null, 'null 입력 가드');
ok(oppBuildDryRun({ status: 'live', players: [{ id: 'opp-1', side: 'opp', x: 10, y: 10 }] }) === null, '빌더 부족이면 null');

// [8] engine 래퍼도 허용 (engine.state 자동 추출)
const readViaEngine = oppBuildDryRun({ state: makeState() });
ok(readViaEngine?.best?.target.id === read.best.target.id, 'engine 객체(.state)도 허용');

// [9] 실제 opp 점유면 가설 GK가 아니라 현재 holder 를 기준으로 읽는다
const oppHeldState = { ...makeState(), holderId: 'opp-cm' };
const oppHeldRead = oppBuildDryRun(oppHeldState);
ok(oppHeldRead?.holderId === 'opp-cm', '실제 opp 점유자 우선');
ok(oppHeldRead?.holderAssumption === 'actual', '실제 opp 점유는 actual 로 표시');
ok(Math.abs(oppHeldRead.holderReal.x - PITCH_W * 0.65) < 1, 'actual holderReal 은 현재 opp 점유자 좌표');

console.log(fail === 0 ? '\nopp 빌드업 dry-run 통과' : `\n${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
