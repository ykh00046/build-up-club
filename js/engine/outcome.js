// Outcome description (unified_concept_plan §11): no grades, no stars, no
// points. The result of an attempt is a factual, commentary-style record of
// what happened to the opponent.

import { buildTacticalReport } from './report.js';
import { josa } from '../util/josa.js';

function name(p) { return p ? `${p.label}(${p.num})` : '동료'; }

export function buildOutcome(kind, state, detail = {}) {
  const f = state.facts;
  const factsLine = [
    f.baits > 0 ? `압박 유인 ${f.baits}회` : null,
    f.linesBroken > 0 ? `라인 통과 ${f.linesBroken}회` : null,
    f.switches > 0 ? `약측 전환 ${f.switches}회` : null,
    f.runs > 0 ? `침투 지시 ${f.runs}회` : null,
    f.windowsUsed > 0 ? `열린 공간 활용 ${f.windowsUsed}회` : null,
    f.situationsResolved > 0 ? `상황 대응 ${f.situationsResolved}회` : null,
    f.decisionsMade > 0 ? `경기 중 선택 ${f.decisionsMade}회` : null,
  ].filter(Boolean).join(' · ');

  let headline = '';
  let body = '';
  let tone = 'fail';

  switch (kind) {
    case 'goal':
      tone = 'goal';
      headline = `골! ${name(detail.shooter)} — ${detail.zone.ko}`;
      body = `${josa(name(detail.shooter), '이', '가')} ${detail.zone.ko}에서 마무리. 압박을 흔들어 만든 득점입니다.`;
      break;
    case 'saved':
      tone = 'near';
      headline = `선방 — ${name(detail.shooter)}의 ${detail.zone.ko} 슛`;
      body = `${name(detail.shooter)}의 슛이 골키퍼 정면 선방에 막혔습니다. 찬스 메이킹까지는 성공.`;
      break;
    case 'blocked':
      tone = 'near';
      headline = `블록 — ${name(detail.shooter)}의 슛이 몸에 막힘`;
      body = `${detail.zone.ko}에서 때렸지만 수비 블록에 걸렸습니다. 슛 직전 압박이 너무 가까웠습니다.`;
      break;
    case 'off':
      tone = 'near';
      headline = `빗나감 — ${name(detail.shooter)}의 ${detail.zone.ko} 슛`;
      body = `만들어 둔 찬스가 골문을 비껴갔습니다.`;
      break;
    case 'intercepted':
      headline = `차단 — ${josa(name(detail.interceptor), '이', '가')} 읽었습니다`;
      body = detail.reason === 'shadow'
        ? `${name(detail.interceptor)}의 커버 섀도우 안으로 공이 들어갔습니다. 가려진 길은 먼저 상대를 움직여 열어야 합니다.`
        : `${josa(name(detail.interceptor), '이', '가')} 패스 길을 한 발 먼저 끊었습니다.`;
      if (detail.risk != null) body += ` (이 시도의 사전 차단 위험: ${Math.round(detail.risk * 100)}%)`;
      break;
    case 'tackled':
      headline = `탈취 — ${name(detail.interceptor)}의 태클`;
      body = `운반 경로가 압박수의 태클 반경을 지났습니다. 운반은 상대를 끌어내는 도구이지 돌파 기술이 아닙니다.`;
      if (detail.risk != null) body += ` (이 경로의 사전 태클 위험: ${Math.round(detail.risk * 100)}%)`;
      break;
    case 'trapped':
      headline = `고립 — ${josa(name(detail.holder), '이', '가')} 갇혔습니다`;
      body = `받은 위치에 출구가 없었습니다. 패스가 도착한 다음 그림까지 보고 공을 보내세요.`;
      break;
    case 'collapsed':
      headline = `템포 상실 — 블록이 안정화됐습니다`;
      body = `너무 오래 잡고 있는 동안 압박 블록이 자리를 되찾았습니다. 유인은 풀리는 순간 바로 찔러야 합니다.`;
      break;
    default:
      headline = '공격 종료';
      body = '';
  }

  const tacticalWhy = (state.lastTacticalFactors ?? [])
    .map((factor) => `${factor.multiplier > 1 ? '위험↑' : '위험↓'} ${factor.label}`)
    .join(' · ');
  if (tacticalWhy) body += ` 전술 요인: ${tacticalWhy}.`;

  const outcome = {
    kind, tone, headline, body,
    facts: factsLine,
    xg: detail.xg ?? null,
    zoneId: detail.zone?.id ?? null,
  };
  outcome.report = buildTacticalReport(state, outcome);
  return outcome;
}
