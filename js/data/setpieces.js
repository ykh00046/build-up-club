// 세트피스 딜리버리 (E5, research §3.3). 코너/프리킥 전달 방식과 상대 마킹 상성.
// 세트피스는 저분산 득점원(~전체 골의 27%) — 코치 투자 + 마킹에 맞는 딜리버리가
// 정산의 세트피스 채널 확률을 끌어올린다.
//  - inswing : 골 쪽으로 휘어 GK·대인 마크를 압박 → 대인/게겐에 강함
//  - outswing: 달려드는 공격수에게 맞춰 → 지역/블록 마킹에 강함
//  - short   : 마크를 끌어내 각을 바꿈 → 선택적 점프(하이브리드)에 강함
export const DELIVERIES = {
  inswing: {
    key: 'inswing',
    label: { ko: '인스윙', en: 'Inswing' },
    desc: {
      ko: '골 쪽 회전으로 GK 압박 — 대인·게겐에 강함',
      en: 'Spins toward goal to pressure the keeper — strong vs man-marking and gegenpress',
    },
    strongVs: ['man', 'gegen'],
  },
  outswing: {
    key: 'outswing',
    label: { ko: '아웃스윙', en: 'Outswing' },
    desc: {
      ko: '달려드는 공격수에게 — 지역·블록에 강함',
      en: 'Onto attackers running in — strong vs zonal and block marking',
    },
    strongVs: ['zonal', 'midblock', 'lowblock'],
  },
  short: {
    key: 'short',
    label: { ko: '숏코너', en: 'Short corner' },
    desc: {
      ko: '마크를 끌어내 각 변경 — 하이브리드에 강함',
      en: 'Draws markers out to change the angle — strong vs hybrid',
    },
    strongVs: ['hybrid'],
  },
};

export const DEFAULT_DELIVERY = 'inswing';

// 딜리버리가 상대 마킹(scheme)에 상성으로 맞으면 1, 아니면 0.
export function deliveryBonus(delivery, scheme) {
  const d = DELIVERIES[delivery];
  return d && d.strongVs.includes(scheme) ? 1 : 0;
}

// 이 상대(scheme)에 가장 강한 딜리버리 키 — 브리핑 추천용.
export function bestDeliveryFor(scheme) {
  for (const d of Object.values(DELIVERIES)) if (d.strongVs.includes(scheme)) return d.key;
  return DEFAULT_DELIVERY;
}
