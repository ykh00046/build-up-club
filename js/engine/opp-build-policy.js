// 상대 빌드업 정책 — dry-run 후보(best/gamble/trap) 중 '성향(disposition)'에 따라 고른다.
//
// best 만 고르면 자기대국이 단조롭다. 성향이 다르면 같은 국면에서도 다른 루트를 택해 다양성이 생긴다.
// 순수: read + disposition (+ 선택적 rng) → 후보 하나. import 없음 → 샌드박스 단독 테스트 가능.
//
// 안전: disposition 미지정이면 결정적 best 를 반환한다(실제 플레이 경로 기본 동작 불변).
// 랜덤은 호출자가 주입(rng) — 정책이 시드를 직접 소유하지 않게.
//
// v2 (자기대국 감사): 절대 riskCap은 후보 risk가 전부 0.55+인 국면에서 safe/balanced의
// 모든 레인을 걸러 결정적 best로 붕괴시켰다(성향 4종 → 체감 2종). 캡을 best 대비
// 상대값(capDelta)으로 바꾸고, 역할 레인 외에 파생 레인 2개를 추가한다:
//   calm  = 후보 중 최저 risk (safe의 정체성 — best가 위험하면 덜 위험한 우회로)
//   burst = 후보 중 최대 progress (direct의 정체성 — 한 방에 전진 크게)

// aim   = 목표 전진도(0=최단 유지 ~ 1=최대 전진). 위험이 포화(수비 조밀 → 모든
//         레인 risk≈0.95)돼 저위험 옵션이 없을 때도 '전진 정도' 축으로 성향을 가른다.
// riskW  = 위험 회피 계수(위험이 유의미하게 다를 때 추가 분화 — safe는 크게 회피).
// capDelta = best.risk 대비 허용 추가 위험(위험 캡 — 비포화 국면에서 safe가 고위험
//         레인을 원천 배제하는 정체성; 포화 국면에선 사실상 무력화돼 aim이 주도).
export const OPP_DISPOSITIONS = {
  safe:       { aim: 0.20, riskW: 0.50, capDelta: 0.02 },
  balanced:   { aim: 0.50, riskW: 0.30, capDelta: 0.12 },
  aggressive: { aim: 0.85, riskW: 0.12, capDelta: 0.45 },
  direct:     { aim: 1.00, riskW: 0.05, capDelta: 0.35 },
};

export function isDisposition(name) {
  return Object.prototype.hasOwnProperty.call(OPP_DISPOSITIONS, name);
}

// read: oppBuildDryRun 결과 { best, gamble, trap, candidates }. disposition: 위 키 또는 미지정.
export function chooseOppBuild(read, disposition, rng = Math.random) {
  if (!read) return null;
  const cands = read.candidates ?? [];
  const best = read.best ?? cands[0] ?? null;
  if (!disposition || !isDisposition(disposition) || !cands.length) return best;

  const profile = OPP_DISPOSITIONS[disposition];
  // 스텝 전진 캡(4R 플랜 A-1) — 한 패스로 32m 넘게 못 건너뛴다(대안이 있을 때).
  // direct만 1.5배(직선 역습이 캡을 뚫는 질감).
  const STEP_CAP = 32;
  const stepCap = disposition === 'direct' ? STEP_CAP * 1.5 : STEP_CAP;
  const cap = (best?.risk ?? 0) + profile.capDelta;   // 위험 캡(best 대비 상대값)

  // 도달 가능 후보 = 전진(≥1) + 스텝 캡 안 + 위험 캡 안. 성향 레인을 이 위에서
  // 구성해야 캡에 걸린 원거리 타깃이 빠진 뒤에도 성향이 서로 다른 도달 가능
  // 타깃을 고른다(8R D3: 위험 포화 + 캡 필터가 role 레인을 전부 걷어내
  // safe/balanced/aggressive가 같은 최단 출구로 붕괴하던 수렴 해소).
  let pool = cands.filter((c) => (c.progress ?? 0) >= 1 && (c.progress ?? 99) <= stepCap && (c.risk ?? 0) <= cap);
  if (!pool.length) pool = cands.filter((c) => (c.progress ?? 0) >= 1 && (c.progress ?? 99) <= stepCap);
  if (!pool.length) {
    // 스텝 캡 안 전진 출구 전무 — 최단 전진 출구 하나로(1결정 슛 누수 방지, 원 shortOutlet).
    const shortOutlet = cands
      .filter((c) => (c.progress ?? 0) >= 1)
      .reduce((a, c) => (a === null || (c.progress ?? 99) < (a.progress ?? 99) ? c : a), null);
    return shortOutlet ?? best;
  }
  if (pool.length === 1) return pool[0];

  // 성향 점수 = 목표 전진도(aim)에 가까울수록 + 위험 낮을수록↑. softmax 샘플로
  // 결정성(시드 고정)·다양성(여러 루트) 동시 확보. safe=짧게 유지, direct=길게 직선.
  const maxP = Math.max(...pool.map((c) => c.progress ?? 0), 1);
  const TEMP = 0.25;
  const weights = pool.map((c) =>
    Math.exp((-Math.abs((c.progress ?? 0) / maxP - profile.aim) - profile.riskW * (c.risk ?? 0)) / TEMP));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) { if ((r -= weights[i]) <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
