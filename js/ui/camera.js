// 3D 카메라(2026-07-08, 기반 전환) — 세계(피치 m, z=높이 m) → 화면 투영.
//
// 브로드캐스트 시점: 남쪽 사이드라인 뒤 상공에서 피치를 내려다보는 핀홀 카메라.
// 게임 로직·밸런스는 평면(x,y)이 본질이라 불변 — 표현 기반만 3D로 전환한다
// (로드맵 비목표였던 3D는 사용자 지시로 확정 오버라이드).
//
// 계약:
//   setupCamera(viewW, viewH)   — 리사이즈마다 호출. 피치 4코너를 화면에 자동 피팅.
//   proj(wx, wy, wz=0) → {x, y, s}   — 화면 px 좌표 + 그 지점의 로컬 스케일(px/m).
//   unprojGround(sx, sy) → {x, y}    — 화면 → 지면(z=0) 역변환(클릭 입력용).
//   groundScale() — 피치 중심의 s(폰트 등 평균 크기 용도).
// 직선 보존: 진짜 투영이라 세계의 직선(패스 레인·라인)은 화면에서도 직선 — 끝점만
// 투영해 이으면 된다. 원(센터서클 등)은 타원이 되므로 샘플 폴리라인으로 그린다.

import { PITCH_W, PITCH_H } from '../data/pitch.js';

// 상황별 카메라(2026-07-09, 사용자 제안 채택) — 고정각은 '판독'과 '깊이'를 동시에
// 못 잡는다(28→39→44→54° 4회 반복이 그 증거). 두 포즈 사이를 z 하나로 보간:
//   FLOW  z=86  (~44°) — 관전·자동 진행: 방송각의 원근 깊이(몸통·볼 아크·멋)
//   READ  z=200 (~66°) — 조준·슬로우·결정 창: 전술 보드에 가까운 간격 판독
// "시간이 느려지는 모든 순간 = 카메라가 선다" — P1(결정의 게임)의 시각 문법.
// 렌더러가 매 프레임 setCameraMode(read)+updateCamera()로 구동, ~300ms 지수 이징.
// 부속 원칙: 패스 레인·링은 항상 지면 평면에 그려져(renderer) 각도 무관 판독 불변.
const Z_FLOW = 86;
const Z_READ = 200;
const CAM = { x: PITCH_W / 2, y: PITCH_H + 52, z: Z_FLOW };
const LOOK = { x: PITCH_W / 2, y: 30, z: 0 };

let camBlend = 0;      // 0=FLOW … 1=READ (현재)
let camTarget = 0;     // 목표
let camLastTs = 0;
let readReq = false;       // 이번 프레임의 READ 요청(원시값)
let readHoldUntil = 0;     // 플래핑 방지 — READ 최소 체류 만료 시각
let viewW0 = 0, viewH0 = 0;

export function setCameraMode(read) { readReq = !!read; }

// 매 프레임 호출(렌더러) — 목표를 향해 지수 접근. snap=접근성(reduced-motion) 즉시 전환.
// 플래핑 방지(리뷰 반영): 유인 창이 300ms 만에 닫히는 류의 짧은 깜빡임에 카메라가
// 위아래로 펌핑하지 않도록, 한번 READ면 최소 450ms 체류 후에만 내려온다(올라가는
// 건 즉시). 이징도 비대칭 — 일어설 땐 τ=100ms(기민), 앉을 땐 τ=250ms(느긋) —
// "감독이 일어선다/앉는다"의 연출 문법이자 추가 완충. 이동 중에만 재피팅(정지 비용 0).
export function updateCamera(now, snap = false) {
  if (!viewW0) return;
  const dt = Math.min(100, now - (camLastTs || now));
  camLastTs = now;
  if (readReq) readHoldUntil = now + 450;
  camTarget = (readReq || now < readHoldUntil) ? 1 : 0;
  const d = camTarget - camBlend;
  if (Math.abs(d) < 0.002) {
    if (camBlend !== camTarget) { camBlend = camTarget; applyCamPose(); }
    return;
  }
  const tau = d > 0 ? 100 : 250;
  camBlend = snap ? camTarget : camBlend + d * (1 - Math.exp(-dt / tau));
  applyCamPose();
}

function applyCamPose() {
  CAM.z = Z_FLOW + (Z_READ - Z_FLOW) * camBlend;
  setupCamera(viewW0, viewH0);
}

let F = { x: 0, y: -1, z: 0 }, U = { x: 0, y: 0, z: 1 };   // 기저(우측 R은 +x 고정)
let focal = 10, cx0 = 0, cy0 = 0, centerS = 6;

function norm(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }

export function setupCamera(viewW, viewH) {
  viewW0 = viewW; viewH0 = viewH;   // 상황별 카메라의 재피팅용 기억
  F = norm({ x: LOOK.x - CAM.x, y: LOOK.y - CAM.y, z: LOOK.z - CAM.z });
  // R = (1,0,0) 고정(롤 없음) → U = R × F.
  U = norm({ x: 0, y: -F.z, z: F.y });
  // 정규화 투영(focal=1)으로 피치 코너들을 재보고 화면에 피팅.
  const pts = [
    [0, 0], [PITCH_W, 0], [0, PITCH_H], [PITCH_W, PITCH_H],
    [-3.5, PITCH_H / 2], [PITCH_W + 3.5, PITCH_H / 2],   // 골 뒤 여유
  ].map(([wx, wy]) => rawProj(wx, wy, 0));
  // 골대 크로스바(높이) 여유 — 화면 위로 안 잘리게.
  pts.push(rawProj(0, PITCH_H / 2, 3.2), rawProj(PITCH_W, PITCH_H / 2, 3.2));
  const xs = pts.map((p) => p.nx), ys = pts.map((p) => p.ny);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const m = 24;
  focal = Math.min((viewW - m * 2) / (maxX - minX || 1), (viewH - m * 2) / (maxY - minY || 1));
  cx0 = viewW / 2 - ((minX + maxX) / 2) * focal;
  cy0 = viewH / 2 + ((minY + maxY) / 2) * focal;
  centerS = proj(PITCH_W / 2, PITCH_H / 2, 0).s;
}

// 정규화(포컬 1) 카메라 좌표 — 피팅 계산용.
function rawProj(wx, wy, wz) {
  const vx = wx - CAM.x, vy = wy - CAM.y, vz = wz - CAM.z;
  const zc = vy * F.y + vz * F.z;
  const yc = vy * U.y + vz * U.z;
  return { nx: vx / zc, ny: yc / zc, zc };
}

export function proj(wx, wy, wz = 0) {
  const vx = wx - CAM.x, vy = wy - CAM.y, vz = wz - CAM.z;
  const zc = vy * F.y + vz * F.z;               // 깊이(카메라 전방 +)
  const yc = vy * U.y + vz * U.z;
  const s = focal / zc;
  return { x: cx0 + vx * s, y: cy0 - yc * s, s };
}

export function unprojGround(sx, sy) {
  // 픽셀 → 카메라 광선 → 지면(z=0) 교차.
  const ndx = (sx - cx0) / focal;
  const ndy = (cy0 - sy) / focal;
  const dir = {
    x: F.x + 1 * ndx + U.x * ndy,
    y: F.y + 0 * ndx + U.y * ndy,
    z: F.z + 0 * ndx + U.z * ndy,
  };
  const t = -CAM.z / dir.z;
  return { x: CAM.x + dir.x * t, y: CAM.y + dir.y * t };
}

export function groundScale() { return centerS; }
