// Outcome description (unified_concept_plan §11): no grades, no stars, no
// points. The result of an attempt is a factual, commentary-style record of
// what happened to the opponent.

import { buildTacticalReport } from './report.js';
import { josa } from '../util/josa.js';
import { t, getLang } from '../career/i18n.js';

function name(p) { return p ? `${p.label}(${p.num})` : t('out.name.teammate'); }

// Localize a value-bearing outcome string: look up the key, then substitute
// {token} placeholders. Each template uses each token at most once.
function fill(key, tokens) {
  let s = t(key);
  for (const [k, v] of Object.entries(tokens)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function buildOutcome(kind, state, detail = {}) {
  const f = state.facts;
  // Shot-zone name in the current language (zones carry .ko/.en; fall back ko).
  const zoneName = detail.zone
    ? (getLang() === 'en' ? (detail.zone.en ?? detail.zone.ko) : detail.zone.ko)
    : '';
  const factsLine = [
    f.baits > 0 ? fill('out.facts.baits', { n: f.baits }) : null,
    f.linesBroken > 0 ? fill('out.facts.lines', { n: f.linesBroken }) : null,
    f.switches > 0 ? fill('out.facts.switches', { n: f.switches }) : null,
    f.runs > 0 ? fill('out.facts.runs', { n: f.runs }) : null,
    f.windowsUsed > 0 ? fill('out.facts.windows', { n: f.windowsUsed }) : null,
    f.situationsResolved > 0 ? fill('out.facts.situations', { n: f.situationsResolved }) : null,
    f.decisionsMade > 0 ? fill('out.facts.decisions', { n: f.decisionsMade }) : null,
  ].filter(Boolean).join(' · ');

  let headline = '';
  let body = '';
  let tone = 'fail';

  switch (kind) {
    case 'goal':
      tone = 'goal';
      headline = fill('out.goal.headline', { name: name(detail.shooter), zone: zoneName });
      body = getLang() === 'en'
        ? fill('out.goal.body', { name: name(detail.shooter), zone: zoneName })
        : `${josa(name(detail.shooter), '이', '가')} ${detail.zone.ko}에서 마무리. 압박을 흔들어 만든 득점입니다.`;
      break;
    case 'own_goal':
      tone = 'goal';
      headline = getLang() === 'en'
        ? fill('out.ownGoal.headline', { name: name(detail.interceptor) })
        : `자책골! — ${josa(name(detail.interceptor), '이', '가')} 컷백에 걸렸습니다`;
      body = getLang() === 'en'
        ? fill('out.ownGoal.body', { name: name(detail.interceptor) })
        : `${josa(name(detail.interceptor), '이', '가')} 낮게 깔린 컷백을 걷어내려다 자기 골문으로. 바이라인 침투가 만든 득점입니다.`;
      break;
    case 'conceded':
      tone = 'fail';
      headline = getLang() === 'en'
        ? fill('out.conceded.headline', { name: name(detail.shooter) })
        : `실점 — ${josa(name(detail.shooter), '이', '가')} 마무리했습니다`;
      body = getLang() === 'en'
        ? fill('out.conceded.body', { n: Math.round((detail.xg ?? 0) * 100) })
        : fill('out.conceded.body', { n: Math.round((detail.xg ?? 0) * 100) });
      break;
    case 'saved':
      tone = 'near';
      headline = fill('out.saved.headline', { name: name(detail.shooter), zone: zoneName });
      body = fill('out.saved.body', { name: name(detail.shooter) });
      break;
    case 'blocked':
      tone = 'near';
      headline = fill('out.blocked.headline', { name: name(detail.shooter) });
      body = fill('out.blocked.body', { zone: zoneName });
      break;
    case 'off':
      tone = 'near';
      headline = fill('out.off.headline', { name: name(detail.shooter), zone: zoneName });
      body = t('out.off.body');
      break;
    case 'intercepted':
      headline = getLang() === 'en'
        ? fill('out.intercepted.headline', { name: name(detail.interceptor) })
        : `차단 — ${josa(name(detail.interceptor), '이', '가')} 읽었습니다`;
      if (detail.reason === 'shadow') {
        body = fill('out.intercepted.shadow', { name: name(detail.interceptor) });
      } else {
        body = getLang() === 'en'
          ? fill('out.intercepted.body', { name: name(detail.interceptor) })
          : `${josa(name(detail.interceptor), '이', '가')} 패스 길을 한 발 먼저 끊었습니다.`;
      }
      if (detail.risk != null) body += ' ' + fill('out.intercepted.risk', { risk: Math.round(detail.risk * 100) });
      break;
    case 'tackled':
      headline = fill('out.tackled.headline', { name: name(detail.interceptor) });
      body = t('out.tackled.body');
      if (detail.risk != null) body += ' ' + fill('out.tackled.risk', { risk: Math.round(detail.risk * 100) });
      break;
    case 'trapped':
      headline = getLang() === 'en'
        ? fill('out.trapped.headline', { name: name(detail.holder) })
        : `고립 — ${josa(name(detail.holder), '이', '가')} 갇혔습니다`;
      body = t('out.trapped.body');
      break;
    case 'collapsed':
      headline = t('out.collapsed.headline');
      body = t('out.collapsed.body');
      break;
    case 'press_broken':
      headline = fill('out.press_broken.headline', { name: name(detail.carrier) });
      body = detail.choiceId === 'dp_cut'
        ? t('out.press_broken.cut')
        : t('out.press_broken.press');
      break;
    default:
      headline = t('out.end.headline');
      body = '';
  }

  const tacticalWhy = (state.lastTacticalFactors ?? [])
    .map((factor) => `${factor.multiplier > 1 ? t('out.factor.up') : t('out.factor.down')} ${factor.label}`)
    .join(' · ');
  if (tacticalWhy) body += ' ' + fill('out.factor.line', { x: tacticalWhy });

  const outcome = {
    kind, tone, headline, body,
    facts: factsLine,
    xg: detail.xg ?? null,
    zoneId: detail.zone?.id ?? null,
  };
  outcome.report = buildTacticalReport(state, outcome);
  return outcome;
}
