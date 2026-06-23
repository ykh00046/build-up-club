// 커리어 셸의 ko/en 사전. 전술 보드(index.html) 라벨은 한국어 고정,
// 커리어 허브/결과/메뉴 문자열만 다국어 토글한다.

const DICT = {
  ko: {
    'app.title': '빌드업 클럽',
    'app.tag': '압박을 깨고, 클럽을 키워라',
    'hub.title': '클럽 허브',
    'hub.cash': '자금',
    'hub.fans': '팬',
    'hub.division': '디비전',
    'hub.points': '승점',
    'hub.promote': '승격까지',
    'hub.record': '전적',
    'hub.squad': '스쿼드 강화',
    'hub.ovr': '팀 전력',
    'hub.atk': '공격',
    'hub.def': '수비',
    'hub.stadium': '스타디움',
    'hub.stadiumLvl': '레벨',
    'hub.upgrade': '강화',
    'hub.max': '최대',
    'hub.play': '다음 경기',
    'hub.prestige': '재창단(프레스티지)',
    'hub.prestigeGain': '레거시 +',
    'hub.boost': '수익 2배 (30분)',
    'hub.lang': 'EN',
    'pos.gk': '골키퍼', 'pos.df': '수비', 'pos.mf': '미드필더', 'pos.fw': '공격수',
    'match.vs': 'vs', 'match.odds': '예상', 'match.win': '승', 'match.draw': '무', 'match.loss': '패',
    'match.kickoff': '킥오프', 'match.scheme': '상대 전술', 'match.press': '압박 강도',
    'press.mid': '중간', 'press.high': '높음', 'press.vhigh': '극강',
    'res.win': '승리', 'res.draw': '무승부', 'res.loss': '패배',
    'res.score': '스코어', 'res.earn': '수익', 'res.points': '승점', 'res.cleanSheet': '무실점',
    'res.back': '클럽으로', 'res.promoted': '승격!', 'res.reachedTop': '1부 도달 — 재창단 해금!',
    'res.champion': '리그 우승!', 'res.streak': '연승',
    'res.goalDesc': '결정적 모먼트를 성공시켰습니다',
    'res.nearDesc': '기회를 만들었지만 마무리가 아쉬웠습니다',
    'res.failDesc': '압박에 갇혀 공을 잃었습니다',
    'offline.title': '자리 비움 수익', 'offline.body': '돌아온 사이 클럽이 벌어둔 금액',
    'prestige.confirm': '재창단하면 스쿼드·디비전이 초기화되지만 영구 레거시 보너스를 얻습니다. 진행할까요?',
    'newgame.welcome': '동네 클럽을 1부 우승까지. 첫 경기를 시작하세요.',
  },
  en: {
    'app.title': 'Build-Up Club',
    'app.tag': 'Break the press, grow your club',
    'hub.title': 'Club Hub',
    'hub.cash': 'Cash',
    'hub.fans': 'Fans',
    'hub.division': 'Division',
    'hub.points': 'Points',
    'hub.promote': 'To promotion',
    'hub.record': 'Record',
    'hub.squad': 'Squad upgrades',
    'hub.ovr': 'Team OVR',
    'hub.atk': 'ATK',
    'hub.def': 'DEF',
    'hub.stadium': 'Stadium',
    'hub.stadiumLvl': 'Level',
    'hub.upgrade': 'Upgrade',
    'hub.max': 'MAX',
    'hub.play': 'Next match',
    'hub.prestige': 'Refound (Prestige)',
    'hub.prestigeGain': 'Legacy +',
    'hub.boost': '2× income (30 min)',
    'hub.lang': '한국어',
    'pos.gk': 'Keeper', 'pos.df': 'Defense', 'pos.mf': 'Midfield', 'pos.fw': 'Attack',
    'match.vs': 'vs', 'match.odds': 'Odds', 'match.win': 'W', 'match.draw': 'D', 'match.loss': 'L',
    'match.kickoff': 'Kick off', 'match.scheme': 'Opponent', 'match.press': 'Press',
    'press.mid': 'Mid', 'press.high': 'High', 'press.vhigh': 'Extreme',
    'res.win': 'WIN', 'res.draw': 'DRAW', 'res.loss': 'LOSS',
    'res.score': 'Score', 'res.earn': 'Earned', 'res.points': 'Points', 'res.cleanSheet': 'Clean sheet',
    'res.back': 'Back to club', 'res.promoted': 'Promoted!', 'res.reachedTop': 'Reached Div 1 — prestige unlocked!',
    'res.champion': 'League champions!', 'res.streak': 'win streak',
    'res.goalDesc': 'You executed the decisive moment',
    'res.nearDesc': 'Created the chance but couldn\'t finish',
    'res.failDesc': 'Trapped by the press and lost the ball',
    'offline.title': 'While you were away', 'offline.body': 'Your club earned',
    'prestige.confirm': 'Refounding resets your squad and division but grants a permanent legacy bonus. Continue?',
    'newgame.welcome': 'Take a local club to a Div 1 title. Play your first match.',
  },
};

let lang = detectLang();
function detectLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && DICT[q]) return q;
    const saved = localStorage.getItem('buc-lang');
    if (saved && DICT[saved]) return saved;
  } catch (e) { /* ignore */ }
  const n = ((typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase();
  return n.startsWith('ko') ? 'ko' : 'en';
}

export function t(key) { return DICT[lang][key] ?? DICT.ko[key] ?? key; }
export function getLang() { return lang; }
export function toggleLang() {
  lang = lang === 'ko' ? 'en' : 'ko';
  try { localStorage.setItem('buc-lang', lang); } catch (e) { /* ignore */ }
  return lang;
}
