// 보드 읽기(추천 플랜)의 다국어 표시 — 엔진을 건드리지 않고 표시 계층에서 처리.
//
// 한국어는 엔진 원본(evaluator.formatBoardRead)을 그대로 재사용(바이트 동일).
// 영어는 같은 구조체 데이터(best/gamble/trap candidate: target.label·action·
// risk·safety·progress·shot.xg)로 여기서 새로 조립한다. 엔진의 ACTION_KO는
// 한국어 고정이라 영어용 라벨만 별도로 둔다.

import { getLang } from '../career/i18n.js';
import { formatBoardRead } from '../engine/evaluator.js';

const ACTION_EN = {
  to_feet: 'to feet',
  pass_space: 'into space',
  hold: 'hold',
  carry: 'carry',
  shoot: 'shot',
};

const pctEn = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

function candidateEn(c, mode) {
  if (!c) return '';
  const label = `${c.target?.label ?? 'teammate'} ${ACTION_EN[c.action] ?? c.action}`;
  if (c.type === 'shot') return `${label} - xG ${pctEn(c.shot?.xg ?? c.safety)}`;
  const progress = c.progress >= 1 ? `, +${Math.round(c.progress)}m` : '';
  if (mode === 'trap') {
    const read = c.opponentRead >= 0.2 ? ', pattern read' : '';
    return `${label} - block risk ${pctEn(c.risk)}${read}`;
  }
  if (mode === 'gamble') return `${label} - high reward, risk ${pctEn(c.risk)}${progress}`;
  return `${label} - safe ${pctEn(c.safety)}${progress}`;
}

function formatBoardReadEn(read) {
  if (!read?.best) return 'Best: reset or hold to draw the press out again.';
  const parts = [`Best: ${candidateEn(read.best, 'best')}`];
  if (read.gamble) parts.push(`Gamble: ${candidateEn(read.gamble, 'gamble')}`);
  if (read.trap) parts.push(`Trap: ${candidateEn(read.trap, 'trap')}`);
  return parts.join(' / ');
}

// 브리핑의 추천 플랜 한 줄.
export function boardReadText(read) {
  return getLang() === 'ko' ? formatBoardRead(read) : formatBoardReadEn(read);
}

// 경기 중 CURRENT OBJECTIVE의 "최선: …" 한 줄(짧은 CTA).
export function bestObjectiveText(best) {
  if (!best) return null;
  if (getLang() === 'ko') {
    const a = best.action === 'shoot' ? '슛' : best.action === 'pass_space' ? '공간 패스' : '발밑 연결';
    return `최선: ${best.target?.label ?? '볼 소유자'} ${a}`;
  }
  return `Best: ${best.target?.label ?? 'ball carrier'} ${ACTION_EN[best.action] ?? best.action}`;
}
