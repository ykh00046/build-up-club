// 상대 빌드업 정책 — dry-run 후보(best/gamble/trap) 중 '성향(disposition)'에 따라 고른다.
//
// best 만 고르면 자기대국이 단조롭다. 성향이 다르면 같은 국면에서도 다른 루트를 택해 다양성이 생긴다.
// 순수: read + disposition (+ 선택적 rng) → 후보 하나. import 없음 → 샌드박스 단독 테스트 가능.
//
// 안전: disposition 미지정이면 결정적 best 를 반환한다(실제 플레이 경로 기본 동작 불변).
// 랜덤은 호출자가 주입(rng) — 정책이 시드를 직접 소유하지 않게.

export const OPP_DISPOSITIONS = {
  safe:       { best: 0.9,  gamble: 0.1,  trap: 0.0,  riskCap: 0.5 },   // 안정 — 거의 best, 위험 회피
  balanced:   { best: 0.6,  gamble: 0.35, trap: 0.05, riskCap: 0.75 },  // 균형
  aggressive: { best: 0.25, gamble: 0.6,  trap: 0.15, riskCap: 1.0 },   // 공격 — 도박 선호, 위험 감수
  direct:     { best: 0.2,  gamble: 0.8,  trap: 0.0,  riskCap: 0.9 },   // 직선 — 전진 큰 도박 위주
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
  // 역할(best/gamble/trap)별 가중치 — riskCap 초과 후보는 제외.
  const lanes = [
    { c: read.best, w: profile.best },
    { c: read.gamble, w: profile.gamble },
    { c: read.trap, w: profile.trap },
  ].filter((l) => l.c && l.w > 0 && (l.c.risk ?? 0) <= profile.riskCap);
  if (!lanes.length) return best;                          // 전부 걸러지면 안전하게 best

  const total = lanes.reduce((s, l) => s + l.w, 0);
  let r = rng() * total;
  for (const l of lanes) { if ((r -= l.w) <= 0) return l.c; }
  return lanes[lanes.length - 1].c;
}
