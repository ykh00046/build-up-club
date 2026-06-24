// prefers-reduced-motion 감지 (접근성). 캔버스·JS 애니메이션이 OS 모션 설정을
// 존중하도록 단일 진실원을 제공한다. 값은 OS 설정 변경 시 실시간 갱신된다.
// 헤드리스(node)에는 matchMedia가 없어 false로 폴백 → 기존 동작 유지.
let reduced = false;
try {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced = !!mq.matches;
  const onChange = (e) => { reduced = !!e.matches; };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);   // 구형 Safari
} catch { /* node/구형 환경 */ }

export function prefersReducedMotion() { return reduced; }
