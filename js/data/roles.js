// 선수 롤 (E8, research §3.5). 같은 포지션의 책임을 변조하는 모디파이어.
// 중원(mf)·전방(fw)에만 의미 있는 롤을 둔다. 각 롤은 트레이드오프를 갖는다.
//  mods: passAdd/shotAdd(트레잇 부스트), xgMul, concedeMul(역습 노출),
//        secondGoalAdd(다득점), setPieceAdd(세트피스 채널).
export const ROLES = {
  mf: {
    none: { key: 'none', label: '기본', desc: '표준 중원 — 보정 없음', mods: {} },
    regista: { key: 'regista', label: '레지스타', desc: '딥라잉 플레이메이커 — 전진 패스↑, 등 뒤 노출(실점↑)', mods: { passAdd: 0.03, concedeMul: 1.06 } },
    mezzala: { key: 'mezzala', label: '메짤라', desc: '박스 늦은 침투 — 다득점↑, 전진 패스 약간↓', mods: { secondGoalAdd: 0.10, passAdd: -0.01 } },
  },
  fw: {
    none: { key: 'none', label: '기본', desc: '표준 전방 — 보정 없음', mods: {} },
    target: { key: 'target', label: '타깃맨', desc: '홀드업·헤더 — 세트피스↑, 발밑 약간↓', mods: { setPieceAdd: 0.035, passAdd: -0.01 } },
    inside: { key: 'inside', label: '인사이드 포워드', desc: '안쪽 침투 마무리 — xG↑, 세트피스 약간↓', mods: { shotAdd: 0.04, xgMul: 1.04, setPieceAdd: -0.02 } },
  },
};

export function roleMods(line, key) {
  return ROLES[line]?.[key]?.mods || {};
}
export function validRole(line, key) {
  return !!ROLES[line]?.[key];
}
