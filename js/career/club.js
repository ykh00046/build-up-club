// 클럽 커리어 상태 + 경제 + 디비전/승격/프레스티지 + 저장.
// idle-football-club(state.js)의 메타 루프를 Beat the Block 전술 코어 위에 이식한 것.
//
// 전술 코어와의 연결(js/career/mods.js):
//   - 공격 레벨(fw/mf) → 우리 선수 traits(pass/shot) 부스트 → 전술 매치가 쉬워짐
//   - 수비 레벨(gk/df) → 실점 억제 (경기 후 실점 시뮬)
//   - 상대 OVR(디비전 램프) → 압박 강도(intensityOverride)
// 그래서 업그레이드가 "전술 모먼트"에 실제로 체감된다 — 이것이 통합의 핵심.

// 공·수 분해: GK·DF = 수비, FW = 공격, MF = 양쪽. DF에 소량 atk(빌드업 기여).
export const POSITIONS = [
  { key: 'gk', baseCost: 25, atk: 0,   def: 1.8 },
  { key: 'df', baseCost: 18, atk: 0.3, def: 2.0 },
  { key: 'mf', baseCost: 18, atk: 1.4, def: 1.0 },
  { key: 'fw', baseCost: 30, atk: 2.6, def: 0 },
];

// 5부 → 1부. oppOVR = 그 디비전 상대 평균 전력, promotePts = 승격 승점.
export const DIVISIONS = [
  // promotePts 단축(105→60, -43%)으로 첫 우승까지 경기 수를 절반 가까이 줄임(반복 부담 완화).
  // 경기 수가 줄어든 만큼 prize를 ~25% 올려 강화 사이클 속도를 유지.
  { tier: 5, oppOVR: 22,  prize: 45,    promotePts: 6 },
  { tier: 4, oppOVR: 52,  prize: 190,   promotePts: 9 },
  { tier: 3, oppOVR: 130, prize: 950,   promotePts: 12 },
  { tier: 2, oppOVR: 330, prize: 5200,  promotePts: 15 },
  { tier: 1, oppOVR: 820, prize: 30000, promotePts: 18 },
];

const SAVE_KEY = 'buc-save-v1';
const SAVE_VERSION = 6;                 // v6: setPieceCoach (E5)
const COST_GROWTH = 1.18;
const SETPIECE_COACH_MAX = 3;           // 세트피스 코치 최대 레벨 (E5)
const SETPIECE_COACH_BASE = 3500;       // 1레벨 고용 비용 (이후 레벨마다 ×1.6)
const STADIUM_BASE = 120;
const STADIUM_GROWTH = 2.2;
const BOOST_MS = 30 * 60 * 1000;
const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
const OFFLINE_RATE = 0.5;
const RECENT_INCOMES = 10;
const LEGACY_INCOME_BASE = 1.15;
const LEGACY_INCOME_CAP = 120;
const LEGACY_DISCOUNT_PER_PT = 0.02;
const LEGACY_DISCOUNT_FLOOR = 0.5;

function freshState() {
  return {
    saveVersion: SAVE_VERSION,
    cash: 120,
    fans: 50,
    stadiumLvl: 1,
    setPieceCoach: 0,       // 세트피스 코치 레벨 0~3 (E5) — 세트피스 득점 확률↑(저분산)
    levels: { gk: 1, df: 1, mf: 1, fw: 1 },
    divIdx: 0,
    points: 0,
    matchday: 0,            // 누적 경기 수 (시나리오 로테이션용)
    clubName: '',
    clubColor: '#5dd6c5',
    legacy: 0,
    champions: 0,
    canPrestige: false,
    isChampion: false,
    totalEarned: 0,
    runEarned: 0,
    boostUntil: 0,
    lastSeen: Date.now(),
    lastMatchIncome: 0,
    recentIncomes: [],
    record: { w: 0, d: 0, l: 0 },
    streakW: 0,
    // ── 변주 시스템 상태 (events.js) ──
    effects: [],            // 일시 효과: 부상/컨디션/감독 폼 { type,pos,dLevel,atkMul,defMul,until,label,tone }
    missionsDone: {},       // 디비전별 미션 달성 여부 (divIdx → true)
    lastEventMatchday: 0,   // 첫 이벤트도 최소 3경기 뒤에 발생
    // ── 철학 분기(장기 성장, philosophy.js) — 프레스티지로도 보존되는 정체성 ──
    philosophy: null,       // 선택한 철학 id (null=미선택)
    perks: {},              // 해금된 퍼크 { perkId: true }
    philoPoints: 0,         // 철학 포인트(승격/우승/프레스티지로 획득)
    identityXp: { positional: 0, direct: 0, wing: 0, pressproof: 0 },
    trainingEffects: [],
    // ── 시즌 목표 추적 (season-goals.js) ──
    identityStreak: { id: null, count: 0 },   // 연속 우세 정체성 { id, count }
    scenarioWins: {},                          // 시나리오 셀별 승 수 { cell: n }
    seasonGoalsDone: {},                       // 시즌 목표 달성 여부 { goalId: true }
    careerHistory: [],                         // 매치 종료 시 {matchday,points,identityXp} 스냅샷 (최근 50)
    firstPlay: true,                           // 첫 매치 전 튜토리얼 표시 여부
  };
}

export const club = freshState();

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function normalizeState(raw = {}) {
  const base = freshState();
  const src = raw && typeof raw === 'object' ? raw : {};
  const next = { ...base, ...src };
  next.saveVersion = SAVE_VERSION;
  next.levels = { ...base.levels, ...(src.levels || {}) };
  next.record = { ...base.record, ...(src.record || {}) };
  next.perks = { ...base.perks, ...(src.perks || {}) };
  next.missionsDone = { ...base.missionsDone, ...(src.missionsDone || {}) };
  next.identityXp = { ...base.identityXp, ...(src.identityXp || {}) };
  for (const key of Object.keys(next.identityXp)) next.identityXp[key] = Math.max(0, finiteOr(next.identityXp[key], 0));
  for (const pos of POSITIONS) next.levels[pos.key] = Math.max(0, finiteOr(next.levels[pos.key], base.levels[pos.key]));
  for (const key of ['cash', 'fans', 'stadiumLvl', 'divIdx', 'points', 'matchday', 'legacy', 'champions', 'totalEarned', 'runEarned', 'boostUntil', 'lastSeen', 'lastMatchIncome', 'streakW', 'philoPoints']) {
    next[key] = finiteOr(next[key], base[key]);
  }
  // 세트피스 코치(E5): 0~SETPIECE_COACH_MAX 정수로 보정(손상/구버전 세이브 방어).
  next.setPieceCoach = Math.max(0, Math.min(SETPIECE_COACH_MAX, Math.floor(finiteOr(next.setPieceCoach, 0))));
  for (const key of ['w', 'd', 'l']) next.record[key] = Math.max(0, finiteOr(next.record[key], 0));
  next.divIdx = Math.max(0, Math.min(DIVISIONS.length - 1, Math.floor(next.divIdx)));
  // 챔피언/프레스티지 플래그는 최상위 디비전에서만 유효. 하위 디비전과 불일치하는
  // 손상·구버전 세이브가 addPoints의 승점 클램프(259)로 영구 소프트락 되는 것을 막는다.
  if (next.divIdx < DIVISIONS.length - 1) { next.isChampion = false; next.canPrestige = false; }
  else { next.isChampion = Boolean(next.isChampion); next.canPrestige = Boolean(next.canPrestige); }
  next.effects = Array.isArray(src.effects) ? src.effects.filter(Boolean) : [];
  // 레거시 철학 id 보정 — counter→direct, gegen→pressproof (Sprint 4 id 정합).
  const LEGACY_PHILO = { counter: 'direct', gegen: 'pressproof' };
  if (next.philosophy && LEGACY_PHILO[next.philosophy]) next.philosophy = LEGACY_PHILO[next.philosophy];
  next.trainingEffects = Array.isArray(src.trainingEffects) ? src.trainingEffects.filter(Boolean) : [];
  // 시즌 목표 추적 필드 보정 — 구 저장(없음) → 기본값, 부분 누락 → 병합.
  const srcStreak = src.identityStreak || {};
  next.identityStreak = {
    id: typeof srcStreak.id === 'string' ? srcStreak.id : null,
    count: Math.max(0, finiteOr(srcStreak.count, 0)),
  };
  next.scenarioWins = { ...(src.scenarioWins || {}) };
  next.seasonGoalsDone = { ...(src.seasonGoalsDone || {}) };
  next.careerHistory = Array.isArray(src.careerHistory) ? src.careerHistory.slice(-50) : [];
  next.firstPlay = src.firstPlay === undefined ? true : Boolean(src.firstPlay);
  next.recentIncomes = Array.isArray(src.recentIncomes)
    ? src.recentIncomes.map((n) => finiteOr(n, 0)).filter((n) => n > 0).slice(-RECENT_INCOMES)
    : [];
  return next;
}

export function division() { return DIVISIONS[club.divIdx]; }

// 경기 매칭용 상대 전력: 디비전 기본값 × 승점 진행도 램프.
// 하한은 깊은 디비전일수록 낮음: 5부 0.55 → 1부 0.35 (승격 직후 할만, 직전 빡빡).
export function oppBaseOVR() {
  const div = division();
  const min = 0.55 - 0.05 * (5 - div.tier);
  const prog = Math.min(1, club.points / div.promotePts);
  return div.oppOVR * (min + (1 - min) * prog);
}

export function legacyIncomeMult() {
  return Math.pow(LEGACY_INCOME_BASE, Math.min(club.legacy, LEGACY_INCOME_CAP));
}
export function legacyDiscount() {
  return Math.max(LEGACY_DISCOUNT_FLOOR, 1 - LEGACY_DISCOUNT_PER_PT * club.legacy);
}

// 부상/컨디션이 반영된 실효 레벨 — effects가 비면 club.levels와 동일.
export function effectiveLevels() {
  const eff = { ...club.levels };
  // 하한 0: 레벨 1 포지션도 부상이 체감되게(해당 포지션 기여를 0까지 깎음). 음수 방지.
  for (const e of club.effects) {
    if (e.pos && e.dLevel) eff[e.pos] = Math.max(0, eff[e.pos] + e.dLevel);
  }
  return eff;
}
// 감독 폼 등 전역 공/수 배율 — effects가 비면 1.
function formMul(kind) {
  let m = 1;
  for (const e of club.effects) {
    if (kind === 'atk' && e.atkMul) m *= e.atkMul;
    if (kind === 'def' && e.defMul) m *= e.defMul;
  }
  return m;
}

export function attackOVR() {
  const lv = effectiveLevels();
  let v = 8;
  for (const p of POSITIONS) v += lv[p.key] * p.atk;
  return v * formMul('atk');
}
export function defenseOVR() {
  const lv = effectiveLevels();
  let v = 8;
  for (const p of POSITIONS) v += lv[p.key] * p.def;
  return v * formMul('def');
}
export function teamOVR() { return attackOVR() + defenseOVR(); }

// 효과 추가/만료/영구 보강 (events.js·main.js가 사용).
export function addEffect(e) { club.effects.push(e); }
export function addTrainingEffect(e) { club.trainingEffects.push(e); }
export function tickEffects() {
  club.effects = club.effects.filter((e) => e.until == null || club.matchday < e.until);
  club.trainingEffects = club.trainingEffects.filter((e) => e.until == null || club.matchday < e.until);
}
export function grantLevels(key, n = 1) { if (club.levels[key] != null) club.levels[key] += n; }

export function activeTrainingEffects() {
  return club.trainingEffects.filter((e) => e && (e.until == null || club.matchday < e.until));
}

export function upgradeCost(key) {
  const p = POSITIONS.find((x) => x.key === key);
  return p.baseCost * Math.pow(COST_GROWTH, club.levels[key]) * legacyDiscount();
}
export function buyUpgrade(key) {
  const cost = upgradeCost(key);
  if (club.cash < cost) return false;
  club.cash -= cost;
  club.levels[key] += 1;
  save();
  return true;
}
export function stadiumCost() {
  return STADIUM_BASE * Math.pow(STADIUM_GROWTH, club.stadiumLvl) * legacyDiscount();
}
export function buyStadium() {
  const cost = stadiumCost();
  if (club.cash < cost) return false;
  club.cash -= cost;
  club.stadiumLvl += 1;
  save();
  return true;
}

// 세트피스 코치 고용(E5) — 자금 소모형 업그레이드. 최대 레벨에서 null 비용.
export function setPieceCoachCost() {
  if (club.setPieceCoach >= SETPIECE_COACH_MAX) return null;
  return SETPIECE_COACH_BASE * Math.pow(1.6, club.setPieceCoach) * legacyDiscount();
}
export function buySetPieceCoach() {
  const cost = setPieceCoachCost();
  if (cost == null || club.cash < cost) return false;
  club.cash -= cost;
  club.setPieceCoach += 1;
  save();
  return true;
}

export function boostActive() { return Date.now() < club.boostUntil; }
export function boostRemainSec() { return Math.max(0, Math.ceil((club.boostUntil - Date.now()) / 1000)); }
export function startBoost() { club.boostUntil = Math.max(Date.now(), club.boostUntil) + BOOST_MS; }

// 경기 결과 정산. result: 'w'|'d'|'l', cleanSheet: 무실점 보너스.
export function settleMatch(result, cleanSheet = false) {
  const div = division();
  const prizeRate = result === 'w' ? 1 : result === 'd' ? 0.4 : 0.15;
  const base = (div.prize * prizeRate + club.fans * 0.3 * club.stadiumLvl)
    * (cleanSheet ? 1.2 : 1)
    * legacyIncomeMult();
  const income = base * (boostActive() ? 2 : 1);
  club.cash += income;
  club.totalEarned += income;
  club.runEarned += income;
  club.lastMatchIncome = income;
  club.recentIncomes.push(base);
  if (club.recentIncomes.length > RECENT_INCOMES) club.recentIncomes.shift();
  club.record[result] += 1;
  club.matchday += 1;
  if (result === 'w') { club.fans += 5 * Math.pow(3, 5 - div.tier); club.streakW += 1; }
  else club.streakW = 0;
  tickEffects();   // 부상/컨디션/폼 만료 처리
  return income;
}

// 커리어 히스토리 스냅샷 기록 — settleMatch + addPoints 완료 후 호출 (차트용, 최근 50).
export function recordCareerSnapshot() {
  club.careerHistory = Array.isArray(club.careerHistory) ? club.careerHistory : [];
  club.careerHistory.push({
    matchday: club.matchday,
    points: club.points,
    identityXp: { ...(club.identityXp || {}) },
  });
  if (club.careerHistory.length > 50) club.careerHistory.shift();
}

// 승점 반영. 반환: null | 'promote' | 'reach-top' | 'champion'
export function addPoints(result) {
  const div = division();
  club.points += result === 'w' ? 3 : result === 'd' ? 1 : 0;
  if (club.isChampion) { club.points = Math.min(club.points, div.promotePts); return null; }
  if (club.points < div.promotePts) return null;
  if (club.divIdx < DIVISIONS.length - 1) {
    club.divIdx += 1;
    club.points = 0;
    club.philoPoints = (club.philoPoints || 0) + 1;   // 승격 보상: 철학 포인트
    if (club.divIdx === DIVISIONS.length - 1) { club.canPrestige = true; return 'reach-top'; }
    return 'promote';
  }
  club.isChampion = true;
  club.points = div.promotePts;
  club.philoPoints = (club.philoPoints || 0) + 1;       // 우승 보상: 철학 포인트
  return 'champion';
}

export function prestigeGain() {
  const base = Math.max(1, Math.floor(8 * Math.log10(1 + club.runEarned / 2500)));
  return club.isChampion ? Math.ceil(base * 1.5) : base;
}
export function startLevel() { return 1 + club.legacy * 2; }
export function startDivIdx() { return Math.min(3, Math.floor(club.legacy / 5)); }

export function prestige() {
  if (!club.canPrestige) return 0;
  const gain = prestigeGain();
  const keep = {
    legacy: club.legacy + gain,
    champions: club.champions + (club.isChampion ? 1 : 0),
    totalEarned: club.totalEarned,
    record: club.record,
    clubName: club.clubName,
    clubColor: club.clubColor,
    fans: Math.max(50, Math.floor(club.fans * 0.40)),
    // 철학(정체성)은 프레스티지로 보존 + 보너스 포인트(장기 분기 심화)
    philosophy: club.philosophy,
    perks: club.perks,
    philoPoints: (club.philoPoints || 0) + 2,
  };
  Object.assign(club, freshState(), keep);
  const lvl = startLevel();
  for (const p of POSITIONS) club.levels[p.key] = lvl;
  club.divIdx = startDivIdx();
  save();
  return gain;
}

export function save() {
  const vitals = [club.cash, club.fans, club.legacy, club.totalEarned,
    club.runEarned, club.points, club.stadiumLvl, ...Object.values(club.levels)];
  if (!vitals.every(Number.isFinite)) return;
  Object.assign(club, normalizeState(club));
  club.lastSeen = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(club)); } catch (e) { /* private mode */ }
}

// 반환: 오프라인 수익 (0이면 모달 생략)
export function load() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return 0; }
  if (!raw) return 0;
  try { Object.assign(club, normalizeState(JSON.parse(raw))); } catch (e) { return 0; }
  return awayGain(Date.now() - club.lastSeen);
}

export function awayGain(deltaMs) {
  const delta = Math.min(Math.max(0, deltaMs), OFFLINE_CAP_MS);
  const inc = club.recentIncomes;
  const avg = inc.length ? inc.reduce((a, b) => a + b, 0) / inc.length : 0;
  const gain = delta / 1000 * (avg / 50) * OFFLINE_RATE;
  if (gain > 0) { club.cash += gain; club.totalEarned += gain; club.runEarned += gain; }
  return gain;
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}
export function hardReset() {
  Object.assign(club, freshState());
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

export function formatNum(n) {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return Math.floor(n).toString();
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u += 1; }
  return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + units[u];
}
