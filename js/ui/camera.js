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

// 카메라 자세(튜닝 노브) — 남쪽 뒤 상공. 틸트 ~44°: 원근 깊이는 살리되 세로 판독
// (간격·라인)이 눌리지 않는 균형. 이력: 28°(납작) → 39° → 44°(기울기 살짝 축소,
// 2026-07-08 사용자 지시 — 피치가 덜 눕고 간격 판독이 조금 더 선다).
const CAM = { x: PITCH_W / 2, y: PITCH_H + 52, z: 86 };
const LOOK = { x: PITCH_W / 2, y: 30, z: 0 };

let F = { x: 0, y: -1, z: 0 }, U = { x: 0, y: 0, z: 1 };   // 기저(우측 R은 +x 고정)
let focal = 10, cx0 = 0, cy0 = 0, centerS = 6;

function norm(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }

export function setupCamera(viewW, viewH) {
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
