// 상대 지휘자 C단계: 매치데이 페르소나(season) + 상황 반응 지휘(commander) 계약.
// (2026-07 신설 — B단계 setOpponentDisposition 훅의 첫 실사용자 검증.)
import { commandOpponent } from '../js/career/opponent-commander.js';
import { opponentDisposition, divisionPool } from '../js/career/season.js';
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };
const VALID = new Set(['safe', 'balanced', 'aggressive', 'direct']);

console.log('=== 상대 지휘자 (C) ===\n');

// 1) 페르소나 — 모든 디비전×매치데이에서 유효하고 결정적이다.
{
  let allValid = true, deterministic = true;
  for (let div = 0; div < 5; div++) {
    for (let md = 0; md < 12; md++) {
      const d = opponentDisposition(div, md);
      if (!VALID.has(d)) allValid = false;
      if (d !== opponentDisposition(div, md)) deterministic = false;
    }
  }
  ok(allValid, '전 디비전×매치데이 성향 유효(safe|balanced|aggressive|direct)');
  ok(deterministic, '같은 매치데이 = 같은 성향(결정적)');
}

// 2) 페르소나 — 스킴 정체성 매핑: 게겐=직선, 대인=과감, 로우블록=신중.
//    난이도 곡선: 하위 풀엔 safe가 있고, 최상위 풀엔 aggressive/direct가 있다.
{
  const dispSet = (div) => new Set(
    divisionPool(div).map((_, md) => opponentDisposition(div, md)));
  const low = dispSet(0), top = dispSet(4);
  ok(low.has('safe'), '5부 풀에 신중한 상대 존재');
  ok(top.has('aggressive') && top.has('direct'), '1부 풀에 과감/직선 상대 존재');
}

// 3) 지휘 규칙 — 수비 국면 밖에서는 항상 페르소나 유지.
{
  ok(commandOpponent({}, 'balanced') === 'balanced', '수비 국면 없음 → base 유지');
  ok(commandOpponent({ defenseLoop: null }, 'direct') === 'direct', 'defenseLoop null → base 유지');
  ok(commandOpponent(null, null) === null, 'state 없음 → null 관용');
}

// 4) 지휘 규칙 — 신선한 루프는 base, 패턴이 쌓이면 반응한다.
{
  const st = (dl, wins = 0) => ({ defenseLoop: dl, facts: { defensivePressWins: wins } });
  ok(commandOpponent(st({ steps: 0, beaten: 0, contained: 0 }), 'balanced') === 'balanced',
    '신선한 루프 → base 유지');
  ok(commandOpponent(st({ steps: 1, beaten: 0, contained: 1 })) === 'direct',
    '내려서기(contained≥1) → direct(수동 블록 처벌 — v1 ≥2는 발동 0% 죽은 규칙)');
  ok(commandOpponent(st({ steps: 1, beaten: 1, contained: 0 })) === 'aggressive',
    '압박 벗겨냄(beaten≥1) → aggressive(기세)');
  ok(commandOpponent(st({ steps: 0, beaten: 0, contained: 0 }, 2)) === 'safe',
    '경기 중 2회 이상 뺏김 → safe(데인 상대, 국면 내 반응 없을 때 폴백)');
  ok(commandOpponent(st({ steps: 1, beaten: 0, contained: 1 }, 3)) === 'direct',
    '국면 내 반응(내려서기 처벌)이 뺏김 기억보다 우선 — v1 영구 차단 해소');
}

// 5) 엔진 통합 — 지휘자 출력은 항상 setOpponentDisposition이 수락한다.
{
  const e = createEngine(getScenario('A1'), 7, { opponentBuildDisposition: 'direct' });
  const cases = [
    commandOpponent({ defenseLoop: { steps: 0, beaten: 0, contained: 0 } }, 'direct'),
    commandOpponent({ defenseLoop: { steps: 2, beaten: 0, contained: 2 } }, 'direct'),
    commandOpponent({ defenseLoop: { steps: 1, beaten: 1, contained: 0 } }, 'direct'),
    commandOpponent({ defenseLoop: { steps: 1, beaten: 0, contained: 0 }, facts: { defensivePressWins: 5 } }, 'direct'),
  ];
  ok(cases.every((d) => e.setOpponentDisposition(d) === true),
    `지휘자 출력 전부 엔진 수락 (${cases.join(', ')})`);
}

console.log(fail === 0 ? '\n모두 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
