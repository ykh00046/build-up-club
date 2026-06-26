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
    label: '대인 압박',
    style: '따라붙는 대인 압박. 마크가 빠르게 따라붙습니다.',
    weakness: '등 뒤 공간으로 패스를 보내면 따라붙던 마크가 벗겨집니다.',
    caution: '같은 발밑 연결을 반복하면 추적당합니다.',
    recommendActions: ['pass_space'],
    cautionActions: ['to_feet'],
    recommendLine: '등 뒤 공간 패스 + 빠른 원터치 발밑',
    trap: '백패스 덫 — 마크를 떼려 뒤로 빼면 즉시 달려듭니다. 등 뒤 공간으로 빠르게 빼 마커를 벗기세요.',
  },
  zonal: {
    label: '지역 블록',
    style: '공간을 닫는 지역 블록. 중앙은 좁지만 반대 전환에 약합니다.',
    weakness: '빠른 측면 공간 패스로 블록을 가로로 움직이면 반대편 하프스페이스가 열립니다.',
    caution: '무리한 중앙 침투는 밀집 수비에 막힙니다.',
    recommendActions: ['pass_space'],
    cautionActions: [],
    recommendLine: '풀백 후방 안정 + 빠른 측면 공간 패스',
    trap: '중앙 미끼 덫 — 중앙을 열어두고 들어오면 협공합니다. 측면 공간 패스로 블록을 가로로 흔든 뒤 약측을 치세요.',
  },
  gegen: {
    label: '게겐프레스',
    style: '즉시 달려드는 게겐프레스. 오래 끌면 위험합니다.',
    weakness: '첫 압박 파도를 빠른 원터치 발밑 연결로 넘기면 등 뒤가 비어 있습니다.',
    caution: '기다리기·운반으로 시간을 끌면 즉시 압살당합니다.',
    recommendActions: ['to_feet'],
    cautionActions: ['hold', 'carry'],
    recommendLine: '전방 내려 빠른 원터치 발밑 + 중원 지원',
    trap: '즉시 스웜 — 공을 받는 순간 떼로 달려듭니다. 받기 전에 다음 그림을 정하고 원터치 발밑으로 첫 파도를 넘기세요.',
  },
  hybrid: {
    label: '하이브리드 압박',
    style: '선택적으로 덫을 놓는 하이브리드 압박. 점프 시점을 읽어야 합니다.',
    weakness: '커버 섀도우 바깥 공간으로 패스해 압박을 빗나가게 합니다.',
    caution: '정직하게 전진하면 점프 타이밍에 걸립니다.',
    recommendActions: ['pass_space'],
    cautionActions: [],
    recommendLine: '중원 지원 + 커버 섀도우 바깥 공간 패스',
    trap: '하프스페이스 채널 덫 — 커버 섀도우 바깥으로 유인한 뒤 점프합니다. 그 바깥 공간으로 패스해 점프를 빗나가게 하세요.',
  },
  midblock: {
    label: '미드블록',
    style: '중앙 3선에 컴팩트하게 서서 기다리는 미드블록. 함부로 나오지 않습니다.',
    weakness: '블록 앞 공간이 넓습니다. 운반으로 끌어낸 뒤 라인 사이를 노리세요.',
    caution: '압축된 중앙으로 무리한 공간 패스는 막힙니다.',
    recommendActions: ['carry'],
    cautionActions: ['pass_space'],
    recommendLine: '후방 안정 + 운반으로 유인',
    trap: '인내 덫 — 미끼를 물지 않고 버팁니다. 앞 공간을 운반으로 잠식해 점프를 강제한 뒤 등 뒤를 치세요.',
  },
  lowblock: {
    label: '로우블록',
    style: '박스 앞에 깊게 내려앉는 로우블록. 영역을 내주고 골문을 지킵니다.',
    weakness: '좌우 공간 패스로 블록을 흔들면 약측이 열립니다. 앞 공간도 넓습니다.',
    caution: '깊은 라인 뒤로는 공간이 없어 침투 패스가 죽습니다.',
    recommendActions: ['carry', 'pass_space'],
    cautionActions: [],
    recommendLine: '풀백 전진 + 빠른 좌우 공간 패스',
    trap: '밀집 덫 — 박스 앞을 인원으로 채웁니다. 측면 공간 패스로 블록을 좌우로 끌고 다니며 약측 하프스페이스를 여세요.',
  },
};

export function getScouting(scheme) {
  return SCOUTING[scheme] || null;
}
