// 경량 리텐션/세션/퍼널 측정 — 외부 서비스·계정 없이 localStorage만 사용.
//
// 왜: HTML5 포털(Poki/CrazyGames) 제출 가치는 "사람들이 다시 오는가 + 얼마나 노는가"로
// 갈린다. 이 모듈은 그 숫자(재방문·세션 길이·load→경기→결과 퍼널)를 직접 보게 해준다.
// 포털에 올리기 전 로컬에서 self-check하고, 원하면 BEACON_URL로 자체 수집기에 보낼 수 있다.
//
// 프라이버시: 개인정보 0. 익명 카운터/타임스탬프만. 모든 저장은 try/catch(시크릿 모드 안전).
// 콘솔에서 `__analytics.report()` 로 요약을 본다.

const NS = 'buc:an';
const EVENT_CAP = 300;     // 이벤트 로그 링버퍼 상한
const DAYS_CAP = 120;      // 방문한 날짜 보관 상한
const IDLE_MS = 30_000;    // 30초 무입력 = 세션 일시정지(활성 시간만 누적)

// 자체 수집기 URL(비워두면 비활성). 나중에 교차사용자 리텐션을 원하면
// sendBeacon으로 POST 받는 간단한 엔드포인트 주소를 넣으면 된다.
const BEACON_URL = '';

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(`${NS}:${key}`);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const write = (key, val) => {
  try {
    localStorage.setItem(`${NS}:${key}`, JSON.stringify(val));
  } catch {
    /* 시크릿 모드 등 — 측정은 best-effort, 게임엔 영향 없음 */
  }
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86_400_000);

// ─── 프로필(영속): 첫 방문·방문 횟수·플레이한 날·총 활성 시간 ──────────────────
function loadProfile() {
  let p = read('profile', null);
  const today = todayStr();
  if (!p) {
    p = { firstDay: today, visits: 0, days: [], totalMs: 0, counters: {} };
  }
  p.visits += 1;
  if (!p.days.includes(today)) {
    p.days.push(today);
    if (p.days.length > DAYS_CAP) p.days = p.days.slice(-DAYS_CAP);
  }
  p.lastDay = today;
  if (!p.counters) p.counters = {};
  write('profile', p);
  return p;
}

const profile = loadProfile();

// ─── 세션(현 방문): 활성 시간 누적 + 이벤트 로그 ──────────────────────────────
let activeMs = 0;
let lastBeat = Date.now();
let visible = document.visibilityState === 'visible';

function beat() {
  const now = Date.now();
  const gap = now - lastBeat;
  if (visible && gap < IDLE_MS) activeMs += gap; // idle/백그라운드 구간은 제외
  lastBeat = now;
}

function flush() {
  beat();
  const p = read('profile', profile);
  p.totalMs = (p.totalMs || 0) + activeMs;
  write('profile', p);
  activeMs = 0;
  if (BEACON_URL) {
    try {
      const payload = JSON.stringify({ day: todayStr(), events: read('events', []) });
      navigator.sendBeacon?.(BEACON_URL, payload);
    } catch {
      /* best-effort */
    }
  }
}

document.addEventListener('visibilitychange', () => {
  beat();
  visible = document.visibilityState === 'visible';
  lastBeat = Date.now();
  if (!visible) flush();
});
window.addEventListener('pagehide', flush);

// ─── 공개 API ────────────────────────────────────────────────────────────────
export function track(name, props = {}) {
  beat();
  // 누적 카운터(영속)
  const p = read('profile', profile);
  p.counters = p.counters || {};
  p.counters[name] = (p.counters[name] || 0) + 1;
  write('profile', p);
  // 이벤트 로그(링버퍼)
  const events = read('events', []);
  events.push({ t: Date.now(), n: name, p: props });
  write('events', events.length > EVENT_CAP ? events.slice(-EVENT_CAP) : events);
}

// 사람이 읽는 요약 — 콘솔에서 __analytics.report().
export function report() {
  const p = read('profile', profile);
  const c = p.counters || {};
  const daysPlayed = p.days.length;
  const sinceFirst = dayDiff(p.firstDay, todayStr());
  const matches = c.match_end || 0;
  const wins = c.match_win || 0;
  const totalMin = Math.round(((p.totalMs || 0) + activeMs) / 60_000);
  const lines = [
    '── Build-Up Club · 측정 요약 ─────────────',
    `첫 방문:        ${p.firstDay} (${sinceFirst}일 전)`,
    `방문 횟수:      ${p.visits}`,
    `플레이한 날 수: ${daysPlayed}  ${daysPlayed >= 2 ? '✓ 재방문 있음' : '· 아직 재방문 없음'}`,
    `총 플레이시간:  ${totalMin}분`,
    '── 퍼널 ─────────────────────────────────',
    `타이틀 진입(load):    ${c.load || 0}`,
    `게임 시작(game_start): ${c.game_start || 0}`,
    `경기 시작(match_start): ${c.match_start || 0}`,
    `경기 종료(match_end):  ${matches}`,
    `  └ 승/무/패: ${wins} / ${c.match_draw || 0} / ${c.match_loss || 0}`,
    `  └ 승격(promote): ${c.promote || 0}`,
    matches > 0
      ? `완주율(게임시작→경기종료): ${Math.round((matches / Math.max(1, c.game_start || 0)) * 100)}%`
      : '아직 완료된 경기 없음',
    '─────────────────────────────────────────',
    BEACON_URL ? `beacon: ${BEACON_URL}` : 'beacon: 꺼짐(로컬 전용)',
  ];
  const text = lines.join('\n');
  // eslint-disable-next-line no-console
  console.log(text);
  return { profile: p, text };
}

// 콘솔 훅 — 로컬에서 바로 숫자 확인.
if (typeof window !== 'undefined') {
  window.__analytics = { track, report };
}
