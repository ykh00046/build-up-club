// probe6-attack-switchbonus-gate — scanOptions()의 switchBonus(engine.js:1686-1690)가
// 커밋 설명대로 "막힌 약측(<10m)엔 0, 열린 정도(10~26m)에 비례"로 실제 작동하는지
// 위치를 직접 통제해 engine.scanOptions() 산출 점수로 실측한다.
//
// 방법: 홀더·전방 스위치 타깃(|Δy|=24>16, 스위치 게이트 통과)을 고정하고, 그 타깃에
// 가장 가까운 수비수 1명("sweep defender")만 4m~34m로 스윕(다른 상대는 전부 화면 밖
// 멀리 치워 스윕 수비수가 항상 nearestDefender가 되게 함). 동일 좌표에서 |Δy|=8(<16,
// 스위치 게이트 미통과) 대조군 타깃도 같은 거리로 스윕해 비교 — 대조군 점수는 거리와
// 무관하게 평평해야(스위치 게이트 밖) switchBonus가 없다는 뜻이고, 실험군은 10m 이하
// 평평 → 10~26m 구간 상승 → 26m+ 재평평(클램프) 패턴이 나와야 공식대로.
//
// 실행: node scripts/probe6-attack-switchbonus-gate.mjs

import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { PITCH_H } from '../js/data/pitch.js';
// (clamp is declared later, before first use, via function hoisting)

const FAR_AWAY = { x: -500, y: -500 }; // scanOptions 후보 스캔에서 사실상 무관하게 만드는 위치

function setupEngine() {
  const e = createEngine(getScenario('A1'), 1);
  // 홀더: 중앙 저지대. 스위치 타깃(실험군): |Δy|=24(>16, 게이트 통과). 대조군: |Δy|=8(게이트 미통과).
  const holder = e.state.players.find((p) => p.id === 'us-6');
  holder.x = 30; holder.y = 34; holder.tx = holder.x; holder.ty = holder.y;
  e.state.holderId = holder.id;
  e.state.possession = 'us';
  e.state.phase = 'BUILDUP';

  const switchTarget = e.state.players.find((p) => p.id === 'us-lw'); // 실험군
  switchTarget.x = 30; switchTarget.y = 58; switchTarget.tx = switchTarget.x; switchTarget.ty = switchTarget.y; // Δy=24
  const controlTarget = e.state.players.find((p) => p.id === 'us-rw'); // 대조군
  controlTarget.x = 30; controlTarget.y = 26; controlTarget.tx = controlTarget.x; controlTarget.ty = controlTarget.y; // Δy=8

  // 나머지 us 선수는 스캔 후보 노이즈를 줄이려 멀리 치움(스캔 자체는 막지 않되 최상위권 다툼 방지 목적은 아님 — 그냥 방치해도 무방).
  const sweepDef = e.state.players.find((p) => p.id === 'opp-lb');
  for (const p of e.state.players) {
    if (p.side !== 'opp') continue;
    if (p.id === sweepDef.id) continue;
    p.x = FAR_AWAY.x; p.y = FAR_AWAY.y; p.tx = p.x; p.ty = p.y;
  }
  return { e, holder, switchTarget, controlTarget, sweepDef };
}

function scoreFor(e, targetId) {
  const top = e.scanOptions(20);
  const hit = top.find((o) => o.action === 'pass_space' && o.target?.id === targetId);
  return hit ? hit.score : null;
}

console.log('=== switchBonus 게이트/비례 실측 프로브 (engine.scanOptions) ===\n');
console.log('실험군 타깃 us-lw: Δy=24 (스위치 게이트 통과, |Δy|>16)');
console.log('대조군 타깃 us-rw: Δy=8  (스위치 게이트 미통과, |Δy|<=16) — switchBonus 항상 0 기대\n');

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 스윕은 타깃의 y축(측면) 방향으로만 오프셋한다 — pass_space의 aim은 target.x+10 이므로,
// x축으로 스윕하면 d=10에서 수비수가 정확히 aim 지점에 겹쳐 lane-risk가 폭증하는 인위적
// 교란(작위적 아티팩트)이 생긴다. y축 스윕이면 aim까지 거리는 sqrt(10²+d²)로 매끈하게
// 변해(≈kink 없음) switchBonus(그 자체가 d를 그대로 씀)의 gate(d=10)만 도드라진다.
const distances = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34];
console.log('수비수거리(y축 오프셋)  실험군score  대조군score  차이(≈switchBonus)');
const rows = [];
for (const d of distances) {
  const { e, switchTarget, sweepDef } = setupEngine();
  sweepDef.x = switchTarget.x;
  sweepDef.y = clamp(switchTarget.y - d, 2, PITCH_H - 2); // 중앙 쪽으로 d만큼
  sweepDef.tx = sweepDef.x; sweepDef.ty = sweepDef.y;

  const sExp = scoreFor(e, 'us-lw');

  const { e: e2, controlTarget, sweepDef: sweepDef2 } = setupEngine();
  sweepDef2.x = controlTarget.x;
  sweepDef2.y = clamp(controlTarget.y + d, 2, PITCH_H - 2);
  sweepDef2.tx = sweepDef2.x; sweepDef2.ty = sweepDef2.y;
  const sCtl = scoreFor(e2, 'us-rw');

  rows.push({ d, sExp, sCtl });
  const diff = (sExp != null && sCtl != null) ? (sExp - sCtl).toFixed(3) : 'n/a';
  console.log(`  ${String(d).padStart(3)}m      ${sExp == null ? '  n/a ' : sExp.toFixed(3).padStart(11)}   ${sCtl == null ? '  n/a ' : sCtl.toFixed(3).padStart(11)}   ${diff}`);
}

console.log('\n[예상 공식] switchBonus = clamp((open-10)/16, 0, 1) * 0.24');
console.log('  open<=10 → 0.000 / open=18 → 0.120 / open>=26 → 0.240 (클램프 상한)\n');

console.log('[진단]');
const flags = [];
const under10 = rows.filter((r) => r.d <= 10 && r.sExp != null && r.sCtl != null);
const flatDiffs = under10.map((r) => r.sExp - r.sCtl);
const maxFlat = flatDiffs.length ? Math.max(...flatDiffs.map(Math.abs)) : null;
if (maxFlat != null && maxFlat > 0.02) flags.push(`10m 이하 구간에서 실험군-대조군 차이가 ${maxFlat.toFixed(3)} — 이론상 0에 가까워야(스위치 게이트 open<=10→bonus 0) 하는데 어긋남`);
else if (maxFlat != null) flags.push(`10m 이하 구간 차이 최대 ${maxFlat.toFixed(3)} — 사실상 0, "막힌 약측엔 보너스 없음" 확인`);

const at26 = rows.find((r) => r.d === 26);
const at34 = rows.find((r) => r.d === 34);
if (at26 && at34 && at26.sExp != null && at34.sExp != null) {
  const plateauDiff = Math.abs(at34.sExp - at26.sExp);
  if (plateauDiff < 0.02) flags.push(`26m→34m 실험군 score 변화 ${plateauDiff.toFixed(3)} — 클램프 상한(0.24) 도달 확인`);
  else flags.push(`26m→34m 실험군 score 변화 ${plateauDiff.toFixed(3)} — 클램프가 예상대로 평평하지 않음`);
}
const at10 = rows.find((r) => r.d === 10);
const at18 = rows.find((r) => r.d === 18);
if (at10 && at18 && at10.sExp != null && at18.sExp != null) {
  const rampDiff = at18.sExp - at10.sExp;
  if (rampDiff > 0.05) flags.push(`10m→18m 실험군 score 상승 ${rampDiff.toFixed(3)} — 오픈니스 비례 상승 확인(선형 램프 작동)`);
  else flags.push(`10m→18m 실험군 score 상승 ${rampDiff.toFixed(3)} — 기대(≈0.12)보다 약함`);
}
if (flags.length === 0) console.log('  판정 불가(후보가 top-20에서 누락됨 — 시나리오 조정 필요).');
else for (const f of flags) console.log(`  - ${f}`);

console.log('\n완료.');
