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

export const OPP_DISPOSITIONS = {
  //          best   gamble trap  calm  burst  capDelta(best.risk 대비 허용 추가 위험)
  safe:       { best: 0.3,  gamble: 0.0,  trap: 0.0,  calm: 0.7,  burst: 0.0,  capDelta: 0.02 },
  balanced:   { best: 0.55, gamble: 0.3,  trap: 0.0,  calm: 0.15, burst: 0.0,  capDelta: 0.12 },
  aggressive: { best: 0.25, gamble: 0.55, trap: 0.2,  calm: 0.0,  burst: 0.0,  capDelta: 0.45 },
  direct:     { best: 0.15, gamble: 0.45, trap: 0.0,  calm: 0.0,  burst: 0.4,  capDelta: 0.35 },
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
  const calm = cands.reduce((a, c) => (((c.risk ?? 1) < (a?.risk ?? 1)) ? c : a), null);
  const burst = cands.reduce((a, c) => (((c.progress ?? -1) > (a?.progress ?? -1)) ? c : a), null);
  const cap = (best?.risk ?? 0) + profile.capDelta;
  const lanes = [
    { c: best, w: profile.best },
    { c: read.gamble, w: profile.gamble },
    { c: read.trap, w: profile.trap },
    { c: calm, w: profile.calm },
    { c: burst, w: profile.burst },
  ].filter((l) => l.c && l.w > 0 && (l.c.risk ?? 0) <= cap);
  if (!lanes.length) return best;                          // 전부 걸러지면 안전하게 best
  // 전진 불가(정체) 레인은 대안이 있으면 스스로 피한다 — 상대 AI 수준(자기대국
  // 감사: D2 safe가 prog=0 레인을 골라 국면의 49%를 자멸, 수비가 무이벤트).
  // 진짜 출구가 없을 때만 정체 = 회수는 상대 실수가 아니라 세운 블록의 몫.
  const viable = lanes.filter((l) => (l.c.progress ?? 0) >= 1);
  const pool = viable.length ? viable : lanes;

  const total = pool.reduce((s, l) => s + l.w, 0);
  let r = rng() * total;
  for (const l of pool) { if ((r -= l.w) <= 0) return l.c; }
  return pool[pool.length - 1].c;
}
