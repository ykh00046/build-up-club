// 상대 스카우팅 메타데이터 — design-direction.md §5.2/§5.3.
// 각 scheme의 추천/주의 actionId는 js/engine/tactics.js 의 scheme factor와
// 일치해야 한다 (scouting-consistency-test.mjs 가 이를 검증).
//
// - recommendActions: 엔진이 해당 scheme에서 유리(위험도 ≤ 1.0)하게 만드는 행동
// - cautionActions:   엔진이 불리(위험도 ≥ 1.0)하게 만드는 행동.
//                     hybrid는 엔진에 페널티 factor가 없으므로 빈 배열 —
//                     서술형 caution 문구로만 주의를 전달한다.
// - recommendLine:    플레이어에게 보여줄 추천 라인 의도(서술형, advisory).

export const SCOUTING = {
  man: {
    label: { ko: '대인 압박', en: 'Man-marking press' },
    style: {
      ko: '따라붙는 대인 압박. 마크가 빠르게 따라붙습니다.',
      en: 'A tight man-marking press — markers track you quickly.',
    },
    weakness: {
      ko: '등 뒤 공간으로 패스를 보내면 따라붙던 마크가 벗겨집니다.',
      en: 'Passing into the space behind shakes off the markers tracking you.',
    },
    caution: {
      ko: '같은 발밑 연결을 반복하면 추적당합니다.',
      en: 'Repeating the same to-feet links lets them track you down.',
    },
    recommendActions: ['pass_space'],
    cautionActions: ['to_feet'],
    recommendLine: {
      ko: '등 뒤 공간 패스 + 빠른 원터치 발밑',
      en: 'Passes into the space behind + quick one-touch to feet',
    },
    trap: {
      ko: '백패스 덫 — 마크를 떼려 뒤로 빼면 즉시 달려듭니다. 등 뒤 공간으로 빠르게 빼 마커를 벗기세요.',
      en: 'Back-pass trap — drop the ball back to lose your marker and they pounce instantly. Move it quickly into the space behind to shake the marker off.',
    },
  },
  zonal: {
    label: { ko: '지역 블록', en: 'Zonal block' },
    style: {
      ko: '공간을 닫는 지역 블록. 중앙은 좁지만 반대 전환에 약합니다.',
      en: 'A zonal block that closes space. Compact centrally, but vulnerable to a switch of play.',
    },
    weakness: {
      ko: '빠른 측면 공간 패스로 블록을 가로로 움직이면 반대편 하프스페이스가 열립니다.',
      en: 'A quick wide pass into space drags the block across, opening the far-side half-space.',
    },
    caution: {
      ko: '무리한 중앙 침투는 밀집 수비에 막힙니다.',
      en: 'Forcing it through the middle runs into the packed defence.',
    },
    recommendActions: ['pass_space'],
    cautionActions: [],
    recommendLine: {
      ko: '풀백 후방 안정 + 빠른 측면 공간 패스',
      en: 'Full-backs holding the back + quick wide passes into space',
    },
    trap: {
      ko: '중앙 미끼 덫 — 중앙을 열어두고 들어오면 협공합니다. 측면 공간 패스로 블록을 가로로 흔든 뒤 약측을 치세요.',
      en: 'Central-bait trap — they leave the middle open and swarm you when you enter. Shift the block across with wide passes into space, then attack the weak side.',
    },
  },
  gegen: {
    label: { ko: '게겐프레스', en: 'Gegenpress' },
    style: {
      ko: '즉시 달려드는 게겐프레스. 오래 끌면 위험합니다.',
      en: 'An instant gegenpress that swarms the ball — dwelling on it is dangerous.',
    },
    weakness: {
      ko: '첫 압박 파도를 빠른 원터치 발밑 연결로 넘기면 등 뒤가 비어 있습니다.',
      en: 'Beat the first pressing wave with quick one-touch to-feet links and the space behind is wide open.',
    },
    caution: {
      ko: '기다리기·운반으로 시간을 끌면 즉시 압살당합니다.',
      en: 'Holding or carrying to buy time gets you swarmed instantly.',
    },
    recommendActions: ['to_feet'],
    cautionActions: ['hold', 'carry'],
    recommendLine: {
      ko: '전방 내려 빠른 원터치 발밑 + 중원 지원',
      en: 'Drop the forward, quick one-touch to feet + midfield support',
    },
    trap: {
      ko: '즉시 스웜 — 공을 받는 순간 떼로 달려듭니다. 받기 전에 다음 그림을 정하고 원터치 발밑으로 첫 파도를 넘기세요.',
      en: 'Instant swarm — they pile onto you the moment you receive. Decide your next move before the ball arrives and beat the first wave with a one-touch pass to feet.',
    },
  },
  hybrid: {
    label: { ko: '하이브리드 압박', en: 'Hybrid press' },
    style: {
      ko: '선택적으로 덫을 놓는 하이브리드 압박. 점프 시점을 읽어야 합니다.',
      en: 'A hybrid press that sets selective traps — you have to read when they jump.',
    },
    weakness: {
      ko: '커버 섀도우 바깥 공간으로 패스해 압박을 빗나가게 합니다.',
      en: 'Pass into the space outside their cover shadow to bypass the press.',
    },
    caution: {
      ko: '정직하게 전진하면 점프 타이밍에 걸립니다.',
      en: 'Progressing predictably gets you caught on their pressing trigger.',
    },
    recommendActions: ['pass_space'],
    cautionActions: [],
    recommendLine: {
      ko: '중원 지원 + 커버 섀도우 바깥 공간 패스',
      en: 'Midfield support + passes into the space outside the cover shadow',
    },
    trap: {
      ko: '하프스페이스 채널 덫 — 커버 섀도우 바깥으로 유인한 뒤 점프합니다. 그 바깥 공간으로 패스해 점프를 빗나가게 하세요.',
      en: 'Half-space channel trap — they lure you outside the cover shadow, then jump. Pass into that outside space to make their jump miss.',
    },
  },
  midblock: {
    label: { ko: '미드블록', en: 'Mid-block' },
    style: {
      ko: '중앙 3선에 컴팩트하게 서서 기다리는 미드블록. 함부로 나오지 않습니다.',
      en: 'A compact mid-block that waits in three central lines and won\'t step out rashly.',
    },
    weakness: {
      ko: '블록 앞 공간이 넓습니다. 운반으로 끌어낸 뒤 라인 사이를 노리세요.',
      en: 'There\'s plenty of space in front of the block. Carry to draw them out, then attack between the lines.',
    },
    caution: {
      ko: '압축된 중앙으로 무리한 공간 패스는 막힙니다.',
      en: 'Forcing passes into space through the compact centre gets blocked.',
    },
    recommendActions: ['carry'],
    cautionActions: ['pass_space'],
    recommendLine: {
      ko: '후방 안정 + 운반으로 유인',
      en: 'Hold the back + carry to bait them out',
    },
    trap: {
      ko: '인내 덫 — 미끼를 물지 않고 버팁니다. 앞 공간을 운반으로 잠식해 점프를 강제한 뒤 등 뒤를 치세요.',
      en: 'Patience trap — they refuse the bait and hold their shape. Eat up the space in front by carrying to force a jump, then attack in behind.',
    },
  },
  lowblock: {
    label: { ko: '로우블록', en: 'Low block' },
    style: {
      ko: '박스 앞에 깊게 내려앉는 로우블록. 영역을 내주고 골문을 지킵니다.',
      en: 'A low block that sits deep in front of the box — it cedes territory to protect the goal.',
    },
    weakness: {
      ko: '좌우 공간 패스로 블록을 흔들면 약측이 열립니다. 앞 공간도 넓습니다.',
      en: 'Side-to-side passes into space rock the block and open the weak side. There\'s also plenty of space in front.',
    },
    caution: {
      ko: '깊은 라인 뒤로는 공간이 없어 침투 패스가 죽습니다.',
      en: 'There\'s no room behind their deep line, so through-balls die.',
    },
    recommendActions: ['carry', 'pass_space'],
    cautionActions: [],
    recommendLine: {
      ko: '풀백 전진 + 빠른 좌우 공간 패스',
      en: 'Full-backs forward + quick side-to-side passes into space',
    },
    trap: {
      ko: '밀집 덫 — 박스 앞을 인원으로 채웁니다. 측면 공간 패스로 블록을 좌우로 끌고 다니며 약측 하프스페이스를 여세요.',
      en: 'Congestion trap — they pack bodies in front of the box. Drag the block side to side with wide passes into space to open the weak-side half-space.',
    },
  },
};

export function getScouting(scheme) {
  return SCOUTING[scheme] || null;
}
