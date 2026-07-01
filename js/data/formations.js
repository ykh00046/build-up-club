// Team builders. Every builder returns fresh player objects so a new attempt
// never shares state with the previous one.
//
// Trait scale is 0..1. `shot` holds per-zone affinity multipliers used by the
// multi-zone shot resolver (missing zone = 0.7 default).

function P(base) {
  return {
    traits: {}, ...base,
    homeX: base.x, homeY: base.y,
  };
}

// ─── Our shapes ────────────────────────────────────────────

// Salida 3-2: the 6 drops between split CBs, right FB inverts, left FB overlaps.
export function buildSalida32() {
  return [
    P({ id: 'us-gk',  role: 'GK',  num: 1,  label: 'GK',     x: 6,  y: 34, traits: { pass: .8, longPass: .55, pressResistance: .55, pace: .3, shot: {} } }),
    P({ id: 'us-lcb', role: 'CB',  num: 4,  label: 'LCB',    x: 17, y: 22, traits: { pass: .85, longPass: .7, pressResistance: .7, pace: .5, shot: {} } }),
    P({ id: 'us-rcb', role: 'CB',  num: 5,  label: 'RCB',    x: 17, y: 46, traits: { pass: .8, longPass: .6, pressResistance: .8, pace: .6, carry: .85, shot: {} } }),
    P({ id: 'us-lb',  role: 'FB',  num: 3,  label: 'LB',     x: 32, y: 9,  traits: { pass: .7, longPass: .5, pressResistance: .6, pace: .8, shot: { cutbackDeliver: 1.1 } } }),
    P({ id: 'us-rb',  role: 'IFB', num: 2,  label: 'IFB',    x: 28, y: 50, traits: { pass: .8, longPass: .65, pressResistance: .75, pace: .7, shot: { midRange: .9 } } }),
    P({ id: 'us-6',   role: 'DM',  num: 6,  label: '6',      x: 26, y: 34, traits: { pass: .9, longPass: .8, pressResistance: .85, pace: .5, shot: { midRange: 1.0, centralD: .9 } } }),
    P({ id: 'us-l8',  role: '8',   num: 8,  label: 'L8',     x: 45, y: 24, traits: { pass: .85, longPass: .6, pressResistance: .8, pace: .7, shot: { cutback: 1.2, centralD: 1.0, midRange: .9, closeRange: 1.0 } } }),
    P({ id: 'us-r8',  role: '8',   num: 10, label: 'R8',     x: 45, y: 44, traits: { pass: .85, longPass: .65, pressResistance: .8, pace: .75, shot: { cutback: 1.2, centralD: 1.1, midRange: 1.0, closeRange: 1.0 } } }),
    P({ id: 'us-lw',  role: 'W',   num: 11, label: 'LW',     x: 68, y: 8,  traits: { pass: .75, longPass: .4, pressResistance: .7, pace: .95, shot: { halfSpace: 1.2, cutback: .9 } } }),
    P({ id: 'us-rw',  role: 'W',   num: 7,  label: 'RW',     x: 68, y: 60, traits: { pass: .75, longPass: .4, pressResistance: .7, pace: .9, shot: { halfSpace: 1.15, cutback: .9 } } }),
    P({ id: 'us-st',  role: 'ST',  num: 9,  label: 'ST',     x: 80, y: 34, traits: { pass: .7, longPass: .3, pressResistance: .65, pace: .8, shot: { sixYard: 1.3, header: 1.2, halfSpace: .9, centralD: .9, closeRange: 1.15 } } }),
  ];
}

// Double Pivot 2-3: two 6s in front of the CBs, both FBs hold width, a 10
// between the lines.
export function buildDoublePivot23() {
  return [
    P({ id: 'us-gk',  role: 'GK',  num: 1,  label: 'GK',     x: 6,  y: 34, traits: { pass: .8, longPass: .75, pressResistance: .55, pace: .3, shot: {} } }),
    P({ id: 'us-lcb', role: 'CB',  num: 4,  label: 'LCB',    x: 16, y: 25, traits: { pass: .85, longPass: .75, pressResistance: .7, pace: .5, shot: {} } }),
    P({ id: 'us-rcb', role: 'CB',  num: 5,  label: 'RCB',    x: 16, y: 43, traits: { pass: .85, longPass: .7, pressResistance: .7, pace: .55, shot: {} } }),
    P({ id: 'us-lb',  role: 'FB',  num: 3,  label: 'LB',     x: 30, y: 9,  traits: { pass: .75, longPass: .5, pressResistance: .65, pace: .85, shot: { cutbackDeliver: 1.1 } } }),
    P({ id: 'us-rb',  role: 'FB',  num: 2,  label: 'RB',     x: 30, y: 59, traits: { pass: .75, longPass: .5, pressResistance: .65, pace: .85, shot: { cutbackDeliver: 1.1 } } }),
    P({ id: 'us-6',   role: 'DM',  num: 6,  label: '6A',     x: 27, y: 28, traits: { pass: .9, longPass: .85, pressResistance: .85, pace: .5, shot: { midRange: 1.1, centralD: .9 } } }),
    P({ id: 'us-l8',  role: 'DM',  num: 8,  label: '6B',     x: 27, y: 40, traits: { pass: .9, longPass: .7, pressResistance: .85, pace: .6, shot: { midRange: 1.0, centralD: 1.0 } } }),
    P({ id: 'us-r8',  role: '10',  num: 10, label: '10',     x: 50, y: 30, traits: { pass: .9, longPass: .6, pressResistance: .85, pace: .75, shot: { centralD: 1.2, midRange: 1.1, cutback: 1.1, closeRange: 1.05 } } }),
    P({ id: 'us-lw',  role: 'W',   num: 11, label: 'LW',     x: 66, y: 10, traits: { pass: .75, longPass: .4, pressResistance: .7, pace: .95, shot: { halfSpace: 1.2, cutback: .9 } } }),
    P({ id: 'us-rw',  role: 'W',   num: 7,  label: 'RW',     x: 66, y: 58, traits: { pass: .75, longPass: .4, pressResistance: .7, pace: .9, shot: { halfSpace: 1.15, cutback: .9 } } }),
    P({ id: 'us-st',  role: 'ST',  num: 9,  label: 'ST',     x: 78, y: 34, traits: { pass: .7, longPass: .3, pressResistance: .7, pace: .75, shot: { sixYard: 1.25, header: 1.35, halfSpace: .9, closeRange: 1.15 } } }),
  ];
}

// 4-3-3: 정형 4-3-3 보유 형태 — 단일 피벗(6) + 두 8번 + 전방 3인.
// (E1 거울매치용 us 4-3-3. salida 빌드업이 아닌 표준 배치.)
export function build433Ours() {
  return [
    P({ id: 'us-gk',  role: 'GK',  num: 1,  label: 'GK',     x: 6,  y: 34, traits: { pass: .8, longPass: .6, pressResistance: .55, pace: .3, shot: {} } }),
    P({ id: 'us-lcb', role: 'CB',  num: 4,  label: 'LCB',    x: 16, y: 25, traits: { pass: .85, longPass: .7, pressResistance: .7, pace: .5, shot: {} } }),
    P({ id: 'us-rcb', role: 'CB',  num: 5,  label: 'RCB',    x: 16, y: 43, traits: { pass: .85, longPass: .65, pressResistance: .75, pace: .55, carry: .8, shot: {} } }),
    P({ id: 'us-lb',  role: 'FB',  num: 3,  label: 'LB',     x: 32, y: 9,  traits: { pass: .72, longPass: .5, pressResistance: .6, pace: .88, shot: { cutbackDeliver: 1.1 } } }),
    P({ id: 'us-rb',  role: 'FB',  num: 2,  label: 'RB',     x: 32, y: 59, traits: { pass: .72, longPass: .5, pressResistance: .6, pace: .85, shot: { cutbackDeliver: 1.1 } } }),
    P({ id: 'us-6',   role: 'DM',  num: 6,  label: '6',      x: 32, y: 34, traits: { pass: .9, longPass: .8, pressResistance: .85, pace: .5, shot: { midRange: 1.0, centralD: .9 } } }),
    P({ id: 'us-l8',  role: '8',   num: 8,  label: 'L8',     x: 48, y: 24, traits: { pass: .85, longPass: .6, pressResistance: .8, pace: .72, shot: { cutback: 1.2, centralD: 1.0, midRange: .9, closeRange: 1.0 } } }),
    P({ id: 'us-r8',  role: '8',   num: 10, label: 'R8',     x: 48, y: 44, traits: { pass: .85, longPass: .65, pressResistance: .8, pace: .75, shot: { cutback: 1.2, centralD: 1.1, midRange: 1.0, closeRange: 1.0 } } }),
    P({ id: 'us-lw',  role: 'W',   num: 11, label: 'LW',     x: 70, y: 9,  traits: { pass: .75, longPass: .4, pressResistance: .7, pace: .95, shot: { halfSpace: 1.2, cutback: .9 } } }),
    P({ id: 'us-rw',  role: 'W',   num: 7,  label: 'RW',     x: 70, y: 59, traits: { pass: .75, longPass: .4, pressResistance: .7, pace: .9, shot: { halfSpace: 1.15, cutback: .9 } } }),
    P({ id: 'us-st',  role: 'ST',  num: 9,  label: 'ST',     x: 80, y: 34, traits: { pass: .7, longPass: .3, pressResistance: .65, pace: .8, shot: { sixYard: 1.3, header: 1.2, halfSpace: .9, centralD: .9, closeRange: 1.15 } } }),
  ];
}

// 4-4-2: 두 줄의 4 + 투톱. 측면 미드는 폭을 잡고, 중앙 더블이 스크린, 두 ST가 전방을 공유.
// (E2 us 4-4-2 — opp 4-2-3-1 미드블록 상대.)
export function build442Ours() {
  return [
    P({ id: 'us-gk',  role: 'GK',  num: 1,  label: 'GK',     x: 6,  y: 34, traits: { pass: .78, longPass: .6, pressResistance: .5, pace: .3, shot: {} } }),
    P({ id: 'us-lcb', role: 'CB',  num: 4,  label: 'LCB',    x: 16, y: 26, traits: { pass: .82, longPass: .65, pressResistance: .68, pace: .5, shot: {} } }),
    P({ id: 'us-rcb', role: 'CB',  num: 5,  label: 'RCB',    x: 16, y: 42, traits: { pass: .82, longPass: .6, pressResistance: .7, pace: .55, shot: {} } }),
    P({ id: 'us-lb',  role: 'FB',  num: 3,  label: 'LB',     x: 30, y: 9,  traits: { pass: .72, longPass: .5, pressResistance: .6, pace: .85, shot: { cutbackDeliver: 1.05 } } }),
    P({ id: 'us-rb',  role: 'FB',  num: 2,  label: 'RB',     x: 30, y: 59, traits: { pass: .72, longPass: .5, pressResistance: .6, pace: .85, shot: { cutbackDeliver: 1.05 } } }),
    P({ id: 'us-6',   role: '8',   num: 6,  label: 'LCM',    x: 42, y: 28, traits: { pass: .88, longPass: .72, pressResistance: .82, pace: .6, shot: { midRange: 1.0, centralD: .95 } } }),
    P({ id: 'us-l8',  role: '8',   num: 8,  label: 'RCM',    x: 42, y: 40, traits: { pass: .88, longPass: .68, pressResistance: .82, pace: .62, shot: { midRange: 1.05, centralD: 1.0, closeRange: .95 } } }),
    P({ id: 'us-lw',  role: 'W',   num: 11, label: 'LM',     x: 56, y: 10, traits: { pass: .76, longPass: .45, pressResistance: .7, pace: .92, shot: { halfSpace: 1.1, cutback: 1.0 } } }),
    P({ id: 'us-rw',  role: 'W',   num: 7,  label: 'RM',     x: 56, y: 58, traits: { pass: .76, longPass: .45, pressResistance: .7, pace: .9, shot: { halfSpace: 1.1, cutback: 1.0 } } }),
    P({ id: 'us-st',  role: 'ST',  num: 9,  label: 'ST',     x: 78, y: 28, traits: { pass: .72, longPass: .35, pressResistance: .68, pace: .82, shot: { sixYard: 1.3, header: 1.25, halfSpace: .95, closeRange: 1.15 } } }),
    P({ id: 'us-r8',  role: 'ST',  num: 10, label: 'ST2',    x: 78, y: 40, traits: { pass: .74, longPass: .35, pressResistance: .68, pace: .8, shot: { sixYard: 1.25, header: 1.3, centralD: 1.0, closeRange: 1.2 } } }),
  ];
}

// ── 추가 전용 포메이션 빌더 (허브 포메이션 보드 8종 중 나머지 6개) ──────────────
// 역할별 트레잇 템플릿(복제해 공유 방지). 기존 빌더 id 규약 재사용 → 맨마킹 호환.
const TR = {
  gk: { pass: .8, longPass: .6, pressResistance: .55, pace: .3, shot: {} },
  cb: { pass: .85, longPass: .7, pressResistance: .7, pace: .5, shot: {} },
  fb: { pass: .73, longPass: .5, pressResistance: .62, pace: .86, shot: { cutbackDeliver: 1.1 } },
  dm: { pass: .9, longPass: .8, pressResistance: .85, pace: .52, shot: { midRange: 1.0, centralD: .9 } },
  cm: { pass: .86, longPass: .65, pressResistance: .8, pace: .72, shot: { cutback: 1.15, centralD: 1.05, midRange: .95, closeRange: 1.0 } },
  am: { pass: .9, longPass: .6, pressResistance: .85, pace: .76, shot: { centralD: 1.2, midRange: 1.1, cutback: 1.1, closeRange: 1.05 } },
  w: { pass: .76, longPass: .4, pressResistance: .7, pace: .92, shot: { halfSpace: 1.18, cutback: .9 } },
  st: { pass: .7, longPass: .32, pressResistance: .66, pace: .8, shot: { sixYard: 1.3, header: 1.25, halfSpace: .9, centralD: .9, closeRange: 1.15 } },
};
const tr = (k) => ({ ...TR[k], shot: { ...TR[k].shot } });

// 4-2-3-1: 더블 6 + 3선(양 와이드 + 중앙 10) + 원톱.
export function build4231Ours() {
  return [
    P({ id: 'us-gk',  role: 'GK', num: 1,  label: 'GK',  x: 6,  y: 34, traits: tr('gk') }),
    P({ id: 'us-lcb', role: 'CB', num: 4,  label: 'LCB', x: 16, y: 25, traits: tr('cb') }),
    P({ id: 'us-rcb', role: 'CB', num: 5,  label: 'RCB', x: 16, y: 43, traits: tr('cb') }),
    P({ id: 'us-lb',  role: 'FB', num: 3,  label: 'LB',  x: 30, y: 9,  traits: tr('fb') }),
    P({ id: 'us-rb',  role: 'FB', num: 2,  label: 'RB',  x: 30, y: 59, traits: tr('fb') }),
    P({ id: 'us-6',   role: 'DM', num: 6,  label: '6A',  x: 29, y: 28, traits: tr('dm') }),
    P({ id: 'us-r8',  role: 'DM', num: 8,  label: '6B',  x: 29, y: 40, traits: tr('dm') }),
    P({ id: 'us-lw',  role: 'W',  num: 11, label: 'LAM', x: 58, y: 13, traits: tr('w') }),
    P({ id: 'us-l8',  role: '10', num: 10, label: 'CAM', x: 54, y: 34, traits: tr('am') }),
    P({ id: 'us-rw',  role: 'W',  num: 7,  label: 'RAM', x: 58, y: 55, traits: tr('w') }),
    P({ id: 'us-st',  role: 'ST', num: 9,  label: 'ST',  x: 80, y: 34, traits: tr('st') }),
  ];
}

// 3-5-2: 백3 + 윙백2(높이) + 중앙 3(6+더블8) + 투톱.
export function build352Ours() {
  return [
    P({ id: 'us-gk',  role: 'GK', num: 1,  label: 'GK',  x: 6,  y: 34, traits: tr('gk') }),
    P({ id: 'us-lcb', role: 'CB', num: 4,  label: 'LCB', x: 16, y: 20, traits: tr('cb') }),
    P({ id: 'us-rcb', role: 'CB', num: 5,  label: 'CB',  x: 16, y: 34, traits: tr('cb') }),
    P({ id: 'us-6',   role: 'CB', num: 6,  label: 'RCB', x: 16, y: 48, traits: tr('cb') }),
    P({ id: 'us-lb',  role: 'FB', num: 3,  label: 'LWB', x: 44, y: 8,  traits: tr('fb') }),
    P({ id: 'us-rb',  role: 'FB', num: 2,  label: 'RWB', x: 44, y: 60, traits: tr('fb') }),
    P({ id: 'us-l8',  role: 'DM', num: 8,  label: '6',   x: 29, y: 34, traits: tr('dm') }),
    P({ id: 'us-r8',  role: '8',  num: 10, label: 'L8',  x: 47, y: 25, traits: tr('cm') }),
    P({ id: 'us-lw',  role: '8',  num: 7,  label: 'R8',  x: 47, y: 43, traits: tr('cm') }),
    P({ id: 'us-rw',  role: 'ST', num: 11, label: 'LST', x: 76, y: 27, traits: tr('st') }),
    P({ id: 'us-st',  role: 'ST', num: 9,  label: 'RST', x: 76, y: 41, traits: tr('st') }),
  ];
}

// 3-4-3: 백3 + 미드4(중앙 더블8 + 양 윙백) + 전방3(양 윙어 + 원톱).
export function build343Ours() {
  return [
    P({ id: 'us-gk',  role: 'GK', num: 1,  label: 'GK',  x: 6,  y: 34, traits: tr('gk') }),
    P({ id: 'us-lcb', role: 'CB', num: 4,  label: 'LCB', x: 16, y: 20, traits: tr('cb') }),
    P({ id: 'us-rcb', role: 'CB', num: 5,  label: 'CB',  x: 16, y: 34, traits: tr('cb') }),
    P({ id: 'us-6',   role: 'CB', num: 6,  label: 'RCB', x: 16, y: 48, traits: tr('cb') }),
    P({ id: 'us-l8',  role: '8',  num: 8,  label: 'L8',  x: 40, y: 28, traits: tr('cm') }),
    P({ id: 'us-r8',  role: '8',  num: 10, label: 'R8',  x: 40, y: 40, traits: tr('cm') }),
    P({ id: 'us-lb',  role: 'FB', num: 3,  label: 'LWB', x: 50, y: 8,  traits: tr('fb') }),
    P({ id: 'us-rb',  role: 'FB', num: 2,  label: 'RWB', x: 50, y: 60, traits: tr('fb') }),
    P({ id: 'us-lw',  role: 'W',  num: 11, label: 'LW',  x: 70, y: 16, traits: tr('w') }),
    P({ id: 'us-st',  role: 'ST', num: 9,  label: 'ST',  x: 80, y: 34, traits: tr('st') }),
    P({ id: 'us-rw',  role: 'W',  num: 7,  label: 'RW',  x: 70, y: 52, traits: tr('w') }),
  ];
}

// 4-3-1-2 다이아몬드: 백4 + 다이아(6+양8+10) + 투톱.
export function build4312Ours() {
  return [
    P({ id: 'us-gk',  role: 'GK', num: 1,  label: 'GK',  x: 6,  y: 34, traits: tr('gk') }),
    P({ id: 'us-lcb', role: 'CB', num: 4,  label: 'LCB', x: 16, y: 25, traits: tr('cb') }),
    P({ id: 'us-rcb', role: 'CB', num: 5,  label: 'RCB', x: 16, y: 43, traits: tr('cb') }),
    P({ id: 'us-lb',  role: 'FB', num: 3,  label: 'LB',  x: 30, y: 9,  traits: tr('fb') }),
    P({ id: 'us-rb',  role: 'FB', num: 2,  label: 'RB',  x: 30, y: 59, traits: tr('fb') }),
    P({ id: 'us-6',   role: 'DM', num: 6,  label: '6',   x: 29, y: 34, traits: tr('dm') }),
    P({ id: 'us-l8',  role: '8',  num: 8,  label: 'L8',  x: 46, y: 23, traits: tr('cm') }),
    P({ id: 'us-r8',  role: '8',  num: 7,  label: 'R8',  x: 46, y: 45, traits: tr('cm') }),
    P({ id: 'us-lw',  role: '10', num: 10, label: '10',  x: 57, y: 34, traits: tr('am') }),
    P({ id: 'us-rw',  role: 'ST', num: 11, label: 'LST', x: 78, y: 28, traits: tr('st') }),
    P({ id: 'us-st',  role: 'ST', num: 9,  label: 'RST', x: 78, y: 40, traits: tr('st') }),
  ];
}

// 5-3-2: 백5(윙백 포함) + 중앙3 + 투톱 — 가장 수비적.
export function build532Ours() {
  return [
    P({ id: 'us-gk',  role: 'GK', num: 1,  label: 'GK',  x: 6,  y: 34, traits: tr('gk') }),
    P({ id: 'us-lcb', role: 'CB', num: 4,  label: 'LCB', x: 16, y: 18, traits: tr('cb') }),
    P({ id: 'us-rcb', role: 'CB', num: 5,  label: 'CB',  x: 15, y: 34, traits: tr('cb') }),
    P({ id: 'us-6',   role: 'CB', num: 6,  label: 'RCB', x: 16, y: 50, traits: tr('cb') }),
    P({ id: 'us-lb',  role: 'FB', num: 3,  label: 'LWB', x: 40, y: 8,  traits: tr('fb') }),
    P({ id: 'us-rb',  role: 'FB', num: 2,  label: 'RWB', x: 40, y: 60, traits: tr('fb') }),
    P({ id: 'us-l8',  role: 'DM', num: 8,  label: '6',   x: 29, y: 34, traits: tr('dm') }),
    P({ id: 'us-r8',  role: '8',  num: 10, label: 'L8',  x: 44, y: 24, traits: tr('cm') }),
    P({ id: 'us-lw',  role: '8',  num: 7,  label: 'R8',  x: 44, y: 44, traits: tr('cm') }),
    P({ id: 'us-rw',  role: 'ST', num: 11, label: 'LST', x: 74, y: 28, traits: tr('st') }),
    P({ id: 'us-st',  role: 'ST', num: 9,  label: 'RST', x: 74, y: 40, traits: tr('st') }),
  ];
}

// 4-5-1: 백4 + 미드5(6+더블8+양 와이드) + 원톱 — 컴팩트.
export function build451Ours() {
  return [
    P({ id: 'us-gk',  role: 'GK', num: 1,  label: 'GK',  x: 6,  y: 34, traits: tr('gk') }),
    P({ id: 'us-lcb', role: 'CB', num: 4,  label: 'LCB', x: 16, y: 25, traits: tr('cb') }),
    P({ id: 'us-rcb', role: 'CB', num: 5,  label: 'RCB', x: 16, y: 43, traits: tr('cb') }),
    P({ id: 'us-lb',  role: 'FB', num: 3,  label: 'LB',  x: 30, y: 9,  traits: tr('fb') }),
    P({ id: 'us-rb',  role: 'FB', num: 2,  label: 'RB',  x: 30, y: 59, traits: tr('fb') }),
    P({ id: 'us-6',   role: 'DM', num: 6,  label: '6',   x: 32, y: 34, traits: tr('dm') }),
    P({ id: 'us-l8',  role: '8',  num: 8,  label: 'L8',  x: 44, y: 26, traits: tr('cm') }),
    P({ id: 'us-r8',  role: '8',  num: 10, label: 'R8',  x: 44, y: 42, traits: tr('cm') }),
    P({ id: 'us-lw',  role: 'W',  num: 11, label: 'LM',  x: 52, y: 12, traits: tr('w') }),
    P({ id: 'us-rw',  role: 'W',  num: 7,  label: 'RM',  x: 52, y: 56, traits: tr('w') }),
    P({ id: 'us-st',  role: 'ST', num: 9,  label: 'ST',  x: 78, y: 34, traits: tr('st') }),
  ];
}

// ─── Opponent presses ──────────────────────────────────────────
// Opp players carry: line ('front'|'mid'|'back'|'gk'), jumpiness (who commits),
// leash (how far they stray from anchor), and optionally markId (man/hybrid).

function D(base) {
  return {
    leash: 10, jumpiness: .5, markId: null,
    ...base,
    homeX: base.x, homeY: base.y, traits: { pace: .7, ...(base.traits || {}) },
  };
}

// 4-3-3 hybrid high press
export function build433Hybrid({ screen = 'us-6', screenLerp, stHomeX } = {}) {
  return [
    D({ id: 'opp-st', role: 'ST', num: 9,  label: 'ST',  x: stHomeX ?? 14, y: 34, line: 'front', jumpiness: .9,  leash: 14 }),
    D({ id: 'opp-lw', role: 'W',  num: 11, label: 'LW',  x: 23, y: 49, line: 'front', jumpiness: .75, leash: 12 }),
    D({ id: 'opp-rw', role: 'W',  num: 7,  label: 'RW',  x: 23, y: 19, line: 'front', jumpiness: .75, leash: 12 }),
    D({ id: 'opp-6',  role: 'DM', num: 6,  label: '6',   x: 40, y: 34, line: 'mid',   jumpiness: .35, leash: 9,  screens: screen, screenLerp }),
    D({ id: 'opp-l8', role: '8',  num: 8,  label: 'L8',  x: 31, y: 45, line: 'mid',   jumpiness: .7,  leash: 11 }),
    D({ id: 'opp-r8', role: '8',  num: 10, label: 'R8',  x: 31, y: 23, line: 'mid',   jumpiness: .7,  leash: 11 }),
    D({ id: 'opp-lb', role: 'FB', num: 3,  label: 'LB',  x: 56, y: 55, line: 'back',  jumpiness: .55, leash: 10 }),
    D({ id: 'opp-lcb',role: 'CB', num: 4,  label: 'LCB', x: 59, y: 42, line: 'back',  jumpiness: .3,  leash: 7 }),
    D({ id: 'opp-rcb',role: 'CB', num: 5,  label: 'RCB', x: 59, y: 26, line: 'back',  jumpiness: .3,  leash: 7 }),
    D({ id: 'opp-rb', role: 'FB', num: 2,  label: 'RB',  x: 56, y: 13, line: 'back',  jumpiness: .55, leash: 10 }),
    D({ id: 'opp-gk', role: 'GK', num: 1,  label: 'GK',  x: 100, y: 34, line: 'gk',   jumpiness: 0,   leash: 4, traits: { keeping: .8 } }),
  ];
}

// 4-4-2 Zonal Block
export function build442Zonal() {
  return [
    D({ id: 'opp-st',  role: 'ST', num: 9,  label: 'ST',  x: 22, y: 27, line: 'front', jumpiness: .52, leash: 8 }),
    D({ id: 'opp-st2', role: 'ST', num: 11, label: 'ST2', x: 22, y: 41, line: 'front', jumpiness: .52, leash: 8 }),
    D({ id: 'opp-rm',  role: 'M',  num: 7,  label: 'RM',  x: 38, y: 11, line: 'mid',   jumpiness: .58, leash: 9 }),
    D({ id: 'opp-rcm', role: 'M',  num: 8,  label: 'RCM', x: 36, y: 25, line: 'mid',   jumpiness: .55, leash: 8 }),
    D({ id: 'opp-lcm', role: 'M',  num: 6,  label: 'LCM', x: 36, y: 43, line: 'mid',   jumpiness: .55, leash: 8 }),
    D({ id: 'opp-lm',  role: 'M',  num: 3,  label: 'LM',  x: 38, y: 57, line: 'mid',   jumpiness: .58, leash: 9 }),
    D({ id: 'opp-rb',  role: 'FB', num: 2,  label: 'RB',  x: 57, y: 11, line: 'back',  jumpiness: .22, leash: 7 }),
    D({ id: 'opp-rcb', role: 'CB', num: 5,  label: 'RCB', x: 62, y: 24, line: 'back',  jumpiness: .18, leash: 6 }),
    D({ id: 'opp-lcb', role: 'CB', num: 4,  label: 'LCB', x: 62, y: 44, line: 'back',  jumpiness: .18, leash: 6 }),
    D({ id: 'opp-lb',  role: 'FB', num: 17, label: 'LB',  x: 57, y: 57, line: 'back',  jumpiness: .22, leash: 7 }),
    D({ id: 'opp-gk',  role: 'GK', num: 1,  label: 'GK',  x: 100, y: 34, line: 'gk',  jumpiness: 0,   leash: 4, traits: { keeping: .82 } }),
  ];
}

// 4-3-3 Gegenpressing
export function build433Gegen() {
  return [
    D({ id: 'opp-st',  role: 'ST', num: 9,  label: 'ST',  x: 10, y: 34, line: 'front', jumpiness: .96, leash: 20, traits: { pace: .90 } }),
    D({ id: 'opp-lw',  role: 'W',  num: 11, label: 'LW',  x: 14, y: 54, line: 'front', jumpiness: .90, leash: 17, traits: { pace: .87 } }),
    D({ id: 'opp-rw',  role: 'W',  num: 7,  label: 'RW',  x: 14, y: 14, line: 'front', jumpiness: .90, leash: 17, traits: { pace: .87 } }),
    D({ id: 'opp-6',   role: 'DM', num: 6,  label: '6',   x: 36, y: 34, line: 'mid',   jumpiness: .78, leash: 14, traits: { pace: .82 } }),
    D({ id: 'opp-l8',  role: '8',  num: 8,  label: 'L8',  x: 24, y: 48, line: 'mid',   jumpiness: .84, leash: 15, traits: { pace: .84 } }),
    D({ id: 'opp-r8',  role: '8',  num: 10, label: 'R8',  x: 24, y: 20, line: 'mid',   jumpiness: .84, leash: 15, traits: { pace: .84 } }),
    D({ id: 'opp-lb',  role: 'FB', num: 3,  label: 'LB',  x: 51, y: 56, line: 'back',  jumpiness: .60, leash: 12 }),
    D({ id: 'opp-lcb', role: 'CB', num: 4,  label: 'LCB', x: 56, y: 43, line: 'back',  jumpiness: .38, leash: 9 }),
    D({ id: 'opp-rcb', role: 'CB', num: 5,  label: 'RCB', x: 56, y: 25, line: 'back',  jumpiness: .38, leash: 9 }),
    D({ id: 'opp-rb',  role: 'FB', num: 2,  label: 'RB',  x: 51, y: 12, line: 'back',  jumpiness: .60, leash: 12 }),
    D({ id: 'opp-gk',  role: 'GK', num: 1,  label: 'GK',  x: 100, y: 34, line: 'gk',  jumpiness: 0,   leash: 4, traits: { keeping: .79 } }),
  ];
}

// 4-2-3-1 Midblock
export function build4231Midblock() {
  return [
    D({ id: 'opp-st',  role: 'ST',  num: 9,  label: 'ST',  x: 26, y: 34, line: 'front', jumpiness: .40, leash: 7 }),
    D({ id: 'opp-lam', role: 'AM',  num: 11, label: 'LAM', x: 40, y: 52, line: 'mid',   jumpiness: .55, leash: 9 }),
    D({ id: 'opp-cam', role: 'AM',  num: 10, label: 'CAM', x: 39, y: 34, line: 'mid',   jumpiness: .48, leash: 8 }),
    D({ id: 'opp-ram', role: 'AM',  num: 7,  label: 'RAM', x: 40, y: 16, line: 'mid',   jumpiness: .55, leash: 9 }),
    D({ id: 'opp-dml', role: 'DM',  num: 6,  label: 'DML', x: 52, y: 41, line: 'mid',   jumpiness: .28, leash: 6 }),
    D({ id: 'opp-dmr', role: 'DM',  num: 8,  label: 'DMR', x: 52, y: 27, line: 'mid',   jumpiness: .28, leash: 6 }),
    D({ id: 'opp-lb',  role: 'FB',  num: 3,  label: 'LB',  x: 62, y: 58, line: 'back',  jumpiness: .25, leash: 6 }),
    D({ id: 'opp-lcb', role: 'CB',  num: 4,  label: 'LCB', x: 67, y: 44, line: 'back',  jumpiness: .16, leash: 5 }),
    D({ id: 'opp-rcb', role: 'CB',  num: 5,  label: 'RCB', x: 67, y: 24, line: 'back',  jumpiness: .16, leash: 5 }),
    D({ id: 'opp-rb',  role: 'FB',  num: 2,  label: 'RB',  x: 62, y: 10, line: 'back',  jumpiness: .25, leash: 6 }),
    D({ id: 'opp-gk',  role: 'GK',  num: 1,  label: 'GK',  x: 100, y: 34, line: 'gk',   jumpiness: 0,   leash: 4, traits: { keeping: .80 } }),
  ];
}

// 5-3-2 Lowblock
export function build532Lowblock() {
  return [
    D({ id: 'opp-st',  role: 'ST',  num: 9,  label: 'ST',  x: 28, y: 28, line: 'front', jumpiness: .38, leash: 7 }),
    D({ id: 'opp-st2', role: 'ST',  num: 11, label: 'ST2', x: 28, y: 40, line: 'front', jumpiness: .38, leash: 7 }),
    D({ id: 'opp-ml',  role: 'M',   num: 8,  label: 'ML',  x: 46, y: 48, line: 'mid',   jumpiness: .35, leash: 7 }),
    D({ id: 'opp-cm',  role: 'DM',  num: 6,  label: 'CM',  x: 48, y: 34, line: 'mid',   jumpiness: .30, leash: 6 }),
    D({ id: 'opp-mr',  role: 'M',   num: 10, label: 'MR',  x: 46, y: 20, line: 'mid',   jumpiness: .35, leash: 7 }),
    D({ id: 'opp-lwb', role: 'FB',  num: 3,  label: 'LWB', x: 58, y: 61, line: 'back',  jumpiness: .32, leash: 9 }),
    D({ id: 'opp-lcb', role: 'CB',  num: 4,  label: 'LCB', x: 66, y: 48, line: 'back',  jumpiness: .14, leash: 4 }),
    D({ id: 'opp-cb',  role: 'CB',  num: 5,  label: 'CB',  x: 69, y: 34, line: 'back',  jumpiness: .12, leash: 4 }),
    D({ id: 'opp-rcb', role: 'CB',  num: 15, label: 'RCB', x: 66, y: 20, line: 'back',  jumpiness: .14, leash: 4 }),
    D({ id: 'opp-rwb', role: 'FB',  num: 2,  label: 'RWB', x: 58, y: 7,  line: 'back',  jumpiness: .32, leash: 9 }),
    D({ id: 'opp-gk',  role: 'GK',  num: 1,  label: 'GK',  x: 100, y: 34, line: 'gk',   jumpiness: 0,   leash: 4, traits: { keeping: .83 } }),
  ];
}

// 4-4-2 man-oriented press
export function build442Man(marks) {
  const m = marks || {};
  return [
    D({ id: 'opp-st', role: 'ST', num: 9,  label: 'ST',  x: 15, y: 28, line: 'front', jumpiness: .85, leash: 13, markId: m.stA ?? 'us-lcb' }),
    D({ id: 'opp-st2',role: 'ST', num: 11, label: 'ST2', x: 15, y: 40, line: 'front', jumpiness: .85, leash: 13, markId: m.stB ?? 'us-rcb' }),
    D({ id: 'opp-rm', role: 'M',  num: 7,  label: 'RM',  x: 33, y: 14, line: 'mid',   jumpiness: .65, leash: 12, markId: m.rm ?? 'us-lb' }),
    D({ id: 'opp-rcm',role: 'M',  num: 8,  label: 'RCM', x: 31, y: 27, line: 'mid',   jumpiness: .7,  leash: 12, markId: m.rcm ?? 'us-6' }),
    D({ id: 'opp-lcm',role: 'M',  num: 6,  label: 'LCM', x: 31, y: 41, line: 'mid',   jumpiness: .7,  leash: 12, markId: m.lcm ?? 'us-l8' }),
    D({ id: 'opp-lm', role: 'M',  num: 17, label: 'LM',  x: 33, y: 54, line: 'mid',   jumpiness: .65, leash: 12, markId: m.lm ?? 'us-rb' }),
    D({ id: 'opp-rb', role: 'FB', num: 2,  label: 'RB',  x: 57, y: 13, line: 'back',  jumpiness: .5,  leash: 10, markId: m.rb ?? 'us-lw' }),
    D({ id: 'opp-rcb',role: 'CB', num: 5,  label: 'RCB', x: 60, y: 26, line: 'back',  jumpiness: .35, leash: 8 }),
    D({ id: 'opp-lcb',role: 'CB', num: 4,  label: 'LCB', x: 60, y: 42, line: 'back',  jumpiness: .35, leash: 8,  markId: m.lcb ?? 'us-st' }),
    D({ id: 'opp-lb', role: 'FB', num: 3,  label: 'LB',  x: 57, y: 55, line: 'back',  jumpiness: .5,  leash: 10, markId: m.lb ?? 'us-rw' }),
    D({ id: 'opp-gk', role: 'GK', num: 1,  label: 'GK',  x: 100, y: 34, line: 'gk',   jumpiness: 0,   leash: 4, traits: { keeping: .8 } }),
  ];
}
