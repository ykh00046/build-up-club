// Bootstrap: engine lifecycle, input model, render loop.
//
// Input model — "click a teammate to pass" first:
//   1. An action chip arms the next click (default: 발밑 패스).
//   2. Hovering a teammate previews the lane with the SAME evaluator the
//      engine rolls, so what you see is what you risk.
//   3. 운반 takes a pitch point; 기다리기/슈팅 fire immediately.

import { getScenario, SCENARIOS } from './data/scenarios.js';
import { SCOUTING } from './data/scouting.js';
import { ACTION_LABELS, tacticalFactors } from './engine/tactics.js';
import { createEngine } from './engine/engine.js';
import { applyRealtimePress } from './engine/realtime.js';
import { evaluateBoard } from './engine/evaluator.js';
import { boardReadText } from './util/board-read-i18n.js';
import { initRenderer, render, resize, toPitch, toggles, pickActionAt } from './ui/renderer.js';
import {
  bindScenarioPanels, renderHudState, renderLog,
  showOutcome, hideOutcome, recordAttempt, renderArchive, initArchiveControls,
  renderTacticalReport,
} from './ui/hud.js';
import { dist, clamp, PITCH_W, PITCH_H, carryRange } from './data/pitch.js';
import { initAudio, unlockAudio, setSoundEnabled, soundEnabled, setPressureLevel, sfx } from './ui/audio.js';
import { openModal, closeModal } from './ui/modal.js';
import { prefersReducedMotion } from './util/motion.js';
import * as analytics from './util/analytics.js';
// ─── Career layer (idle-football-club 메타 + 통합 글루) ───────────────────────
import * as Club from './career/club.js';
import { applyClubBoost, resolveScoreline, BUILD_SHAPES, applyFormationMods, applySetPiece } from './career/mods.js';
import { FORMATION_BUILDERS, FORMATION_MODS, FORMATION_ARCHETYPE, FORMATION_UNLOCKS, isFormationUnlocked } from './data/formations.js';
import { DELIVERIES, DEFAULT_DELIVERY, bestDeliveryFor, deliveryBonus } from './data/setpieces.js';
import { initHub, renderHub, nextMatchInfo } from './career/hub.js';
import { divisionPool } from './career/season.js';
import { t, loc, applyStaticI18n } from './career/i18n.js';
import {
  checkMission, maybeCareerEvent, applyEventChoice, rollPostMatchCondition,
} from './career/events.js';
import {
  PHILOSOPHIES, currentPhilosophy, getPhilosophy, isPerkUnlocked,
  nextPerkIndex, choosePhilosophy, unlockNextPerk,
} from './career/philosophy.js';
import {
  addIdentityXp, applyTrainingChoice, inferIdentityFromMatch, trainingOptionsFromReport,
  updateIdentityStreak, addScenarioWin, dominantIdentityFromGains,
  activeIdentityLevel,
} from './career/identity.js';
import { checkSeasonGoal } from './career/season-goals.js';
import { commandOpponent } from './career/opponent-commander.js';


const canvas = document.getElementById('pitch');
initRenderer(canvas);
initArchiveControls();
initAudio();
// Audio needs one user gesture; any first click anywhere unlocks it.
document.addEventListener('pointerdown', unlockAudio, { capture: true });

// Touch sessions get tap-to-preview: first tap shows the lane read, second
// tap on the same target executes. (Hover doesn't exist on touch — #6.)
let isTouchSession = false;
let lastTapTargetId = null;
let pendingCarry = null; // U2: touch carry = two-tap (preview → confirm)
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') isTouchSession = true;
}, { capture: true });

const params = new URLSearchParams(window.location.search);
let scenario = getScenario(params.get('scenario'));
let engine = createEngine(engineScenario(scenario));
let selectedAction = 'to_feet';
// 수동 슬로우(Space) — 시도당 1회, 시간을 15%로 늦춰 침착하게 읽기. 액션 실행 시 해제.
const manualSlow = { charges: 1, active: false };
// 키다운 핸들러 안에서 i18n t가 지역변수(e.target)에 섀도잉되므로 톱레벨에서 캡처.
const manualSlowHint = () => t('hint.manualSlow');
// 수동 슬로우 트리거(공용 — Space 키·모바일 길게누르기 C1). 성공 시 true.
function tryManualSlow() {
  if (engine.state.status === 'live' && !engine.busy && engine.holder()?.side === 'us'
      && manualSlow.charges > 0 && !manualSlow.active) {
    manualSlow.active = true; manualSlow.charges--;
    setHint(manualSlowHint());
    sfx.slowmo();
    try { navigator.vibrate?.(30); } catch (_) {}
    return true;
  }
  return false;
}
// 길게 누르기(C1 모바일) — 480ms 홀드 = Space와 동일한 수동 슬로우. 발동하면 이어지는
// click(패스)을 한 번 삼킨다(의도치 않은 패스 방지).
let longPressTimer = null, longPressAt = null, suppressNextClick = false;
let hover = null;
let kbTargetId = null;   // 키보드로 선택한 동료(없으면 null)
let outcomeShown = false;
let chosenDifficulty = 'high'; // set by tactics overlay, persists across retries
let chosenShape = 'balanced';  // 빌드업 아키타입(공/수 mods) — 포메이션 선택이 설정
let chosenFormation = 'f433';  // 포메이션(포지션 빌더) — 허브 보드에서 선택, 8종 전용 빌더
let chosenDelivery = DEFAULT_DELIVERY;  // 세트피스 딜리버리 (E5) — 브리핑 선택
const tacticsIntents = { front: 'pin', mid: 'between', back: 'hold' };

// FORMATION_BUILDERS / FORMATION_MODS / FORMATION_ARCHETYPE 는 formations.js로 이관
// (importable — 테스트가 라이브 설정을 검증). 여기선 import해서 사용만 한다.

// 선택한 셰이프의 빌더로 buildOurs를 덮어쓴 시나리오(공유 SCENARIOS는 변형하지 않음).
// builder=null(균형)이면 시나리오 고유 셰이프 그대로.
function shapedScenario() {
  const b = FORMATION_BUILDERS[chosenFormation];
  return b ? { ...scenario, buildOurs: b } : scenario;
}

// 엔진이 만드는 보드 큐/리포트 문장은 이 단계에서 한국어 유지(engine/ 미수정).
// 시나리오의 다국어 hint/targetShot 데이터를 엔진에 넘기기 전에 ko 문자열로 평탄화해
// 엔진이 객체를 문자열에 끼워 넣어 "[object Object]" 가 되는 것을 막는다.
function engineScenario(scn) {
  return { ...scn, hint: loc(scn.hint), targetShot: loc(scn.targetShot) };
}

// ─── Career state ────────────────────────────────────────────────────────────
// 한 경기 = 한 번의 전술 빌드업 모먼트. 그 결과로 클럽이 자란다.
let currentSetup = null;   // mods.matchSetup — 이번 경기의 압박강도/트레잇 부스트/수비
let careerActive = false;  // 전술 매치가 커리어 경기로 진행 중인가
let oppDisposition = null;      // 이번 상대의 전개 성향 페르소나 (season, C단계)
let lastCommanded = null;       // 지휘자가 마지막으로 지시한 성향 — 전환 통지 중복 방지
const careerRng = () => Math.random();
const offlineGain = Club.load();   // 저장 불러오기 + 자리비움 수익

bindScenarioPanels(scenario);

// ─── scenario switching (card select) ───────────────────────────────────────
const selectOverlay = document.getElementById('select-overlay');
const selectGrid = document.getElementById('select-grid');

// 시나리오 선택 카드 — 방송 디자인 + buc-moment 전술 아트(셀별 안정 매핑).
const ALL_CELLS = Object.keys(SCENARIOS);
const momentImg = (cell) => `assets/buc-moment${((ALL_CELLS.indexOf(cell) % 6) + 6) % 6}.png`;
let selectingForCareer = false;

function buildSelectGrid(cells = Object.values(SCENARIOS)) {
  selectGrid.innerHTML = cells.map((s) => {
    const isCur = s.cell === scenario.cell;
    return `
    <button type="button" class="moment-card ${isCur ? 'current' : ''}" data-cell="${s.cell}"
         aria-label="${t('moment.aria').replace('{cell}', s.cell).replace('{title}', loc(s.title)).replace('{shot}', loc(s.targetShot))}"
         style="background-image: url('${momentImg(s.cell)}')">
      <span class="mc-cell">${s.cell}</span>
      ${isCur ? `<span class="mc-sel">${t('moment.selected')}</span>` : ''}
      <div class="mc-info">
        <div class="mc-title">${loc(s.title)}</div>
        <div class="mc-plan">${loc(s.oppPlan) ?? ''}</div>
        <div class="mc-shot">⌖ ${loc(s.targetShot)}</div>
      </div>
    </button>
  `;
  }).join('');
  for (const card of selectGrid.querySelectorAll('.moment-card')) {
    card.addEventListener('click', () => {
      if (selectingForCareer) pickMomentCareer(card.dataset.cell);
      else { switchScenario(card.dataset.cell); closeModal(selectOverlay); }
    });
  }
}

// 커리어 플로우: 허브 "다음 경기" → 디비전 시나리오 풀에서 오늘의 모먼트를 고른다.
function openMomentSelect() {
  selectingForCareer = true;
  const cells = [...new Set(divisionPool(Club.club.divIdx))].map((c) => getScenario(c));
  buildSelectGrid(cells);
  openModal(selectOverlay, selectGrid.querySelector('.current') || selectGrid.querySelector('.moment-card'));
}

// 모먼트 선택 → 그 시나리오로 전술 브리핑.
function pickMomentCareer(cell) {
  selectingForCareer = false;
  scenario = getScenario(cell);
  bindScenarioPanels(scenario);
  const cc = document.getElementById('current-cell');
  if (cc) cc.textContent = scenario.cell;
  populateScorebug();
  closeModal(selectOverlay, false);
  showTacticsOverlay();
}

// 매치 스코어버그(방송 매치업 바) — us/opp 방패·이름·킷색·셀.
function deriveInitials(name, fallback) {
  if (!name) return fallback;
  const words = String(name).trim().split(/\s+/);
  const pick = words.length >= 2 ? words[0][0] + words[1][0] : String(name).replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 2);
  return (pick || fallback).toUpperCase();
}
function populateScorebug() {
  const sb = document.getElementById('scorebug');
  if (!sb) return;
  const usName = Club.club.clubName || t('club.defaultName');
  const oppName = lastMatch?.oppName || t('opp.fallback');
  setText('sb-us-name', usName);
  setText('sb-us-init', deriveInitials(usName, 'BC'));
  setText('sb-opp-name', oppName);
  setText('sb-opp-init', deriveInitials(oppName, 'OP'));
  setText('sb-vs', scenario?.cell ? `VS · ${scenario.cell}` : 'VS');
  sb.style.setProperty('--us-kit', Club.club.clubColor || '#4d8bff');
  sb.hidden = false;
}

// 모먼트 선택 취소 → 허브로 복귀(커리어), 단판이면 단순 닫기.
function cancelSelect() {
  const wasCareer = selectingForCareer;
  selectingForCareer = false;
  closeModal(selectOverlay, false);
  if (wasCareer) enterHub();
}

document.getElementById('btn-select-moment')?.addEventListener('click', () => {
  selectingForCareer = false;
  buildSelectGrid();
  openModal(selectOverlay, selectGrid.querySelector('.current'));
});
document.getElementById('btn-select-close')?.addEventListener('click', cancelSelect);
selectOverlay?.addEventListener('click', (e) => { if (e.target === selectOverlay) cancelSelect(); });

function switchScenario(cell) {
  scenario = getScenario(cell);
  const url = new URL(window.location.href);
  url.searchParams.set('scenario', scenario.cell);
  history.replaceState(null, '', url);
  bindScenarioPanels(scenario);
  const cc = document.getElementById('current-cell');
  if (cc) cc.textContent = scenario.cell;
  showTacticsOverlay();
}
{
  const cc = document.getElementById('current-cell');
  if (cc) cc.textContent = scenario.cell;
}

function newAttempt() {
  hideOutcome();
  // 커리어에선 상대 페르소나가 수비 국면 전개 성향의 기본값 (자유 플레이는 기존 결정적 best).
  engine = createEngine(engineScenario(shapedScenario()), undefined, {
    intensityOverride: chosenDifficulty,
    opponentBuildDisposition: careerActive ? oppDisposition : null,
    // 상실 지점 진입(4R 플랜 A): 커리어에선 어디서 뺏겼는지가 수비 국면의 위험을
    // 결정한다 — 깊은 상실 = 위험한 진입. 자유 플레이는 기존 GK 리셋 유지.
    defenseEntry: careerActive ? 'loss' : 'reset',
    // 유인–3자 콤비(갈래 1 — 플레이어 전술 도구): 마커를 향한 캐리로 유인→릴리스.
    // 항상 켜 사람이 읽고 실행하게(AI 최적수 아님 — 자기대국 측정과 무관).
    baitCombo: true,
  });
  lastCommanded = careerActive ? oppDisposition : null;
  manualSlow.charges = 1; manualSlow.active = false;   // 수동 슬로우 시도당 1회 리셋
  replayRec.frames.length = 0; replayRec.lastAt = 0; lastGoalReplay = null; replayState = null;   // 리플레이 리셋(C3)
  // 통합 글루: 클럽 업그레이드를 'us' 선수 traits로 반영 → 강해질수록 전술이 쉬워짐.
  if (currentSetup) applyClubBoost(engine, currentSetup);
  outcomeShown = false;
  hover = null;
  selectAction('to_feet');
  applyIntentsToEngine(true);
  renderLog(engine);
}

// 커리어 재도전 게이트(감사 H1): 무제한 R 리셋은 "골 날 때까지 재시도 → 승리만 정산"
// 경제 익스플로잇이자, 정산 후 R로 같은 매치데이를 재정산하는 이중 보상 통로였다.
// 커리어 경기당 재도전 1회 — 학습 루프는 남기고 파밍은 막는다. 자유 플레이는 무제한.
let careerRetriesLeft = 1;
let careerSettled = false;   // 이번 매치데이 정산 여부 — 유예 정산의 단일 진실
function retryAttempt() {
  if (careerActive) {
    // 정산 후 재도전 금지: 재도전하면 정산된 결과 카드가 남아 렌더가 멈추는
    // "유령 경기" + 이중 정산이 된다. (유예 정산 도입으로 정산 전 재도전은 허용.)
    if (careerSettled) { toast(t('match.settled')); return false; }
    if (careerRetriesLeft <= 0) { toast(t('match.retryOut')); return false; }
    careerRetriesLeft--;
  }
  newAttempt();
  return true;
}

function nextCell() {
  const order = Object.keys(SCENARIOS);
  const idx = order.indexOf(scenario.cell);
  switchScenario(order[(idx + 1) % order.length]);
}

// ─── tactics briefing overlay ────────────────────────────────────────────────
const tacticsOverlay = document.getElementById('tactics-overlay');

// 액션 id → 표시 이름(다국어). 키가 없으면 raw id로 폴백.
function actionName(id) { const k = 'actko.' + id; const v = t(k); return v === k ? id : v; }
// 상대 scheme → 라벨(다국어). 키가 없으면 raw scheme로 폴백.
function schemeLabel(scheme) { const k = 'scheme.' + scheme; const v = t(k); return v === k ? scheme : v; }

// 첫 경기 전 인터랙티브 튜토리얼 단계 — roadmap 고도화(온보딩).
// 4단계: 스카우팅 읽기 → 행동 선택 → 위험도 factor → 결과 설명. (카피는 i18n DICT)
const TUTORIAL_STEPS = ['tut.s1', 'tut.s2', 'tut.s3', 'tut.s4'];

function showTacticsOverlay() {
  populateTacticsOverlay(scenario);
  // 커리어에선 "← 모먼트"로 모먼트 선택으로 돌아갈 수 있다.
  const back = document.getElementById('btn-tactics-back');
  if (back) back.hidden = !careerActive;
  openModal(tacticsOverlay, document.getElementById('btn-tactics-kickoff'));
}

document.getElementById('btn-tactics-back')?.addEventListener('click', () => {
  closeModal(tacticsOverlay, false);
  enterHub();
});

function populateTacticsOverlay(scn) {
  const el = (id) => document.getElementById(id);
  el('tactics-cell').textContent = scn.cell;
  el('tactics-scenario-title').textContent = loc(scn.title);
  el('tactics-formation').innerHTML = buildFormationSvg(shapedScenario(), { ...tacticsIntents });
  el('tactics-our-shape').textContent = loc(scn.ourShapeName);
  el('tactics-opp-shape').textContent = loc(scn.oppShapeName);
  el('tactics-scheme-line').textContent = schemeLabel(scn.scheme);
  el('tactics-opp-plan-text').textContent = loc(scn.oppPlan) ?? '';
  el('tactics-edge-text').textContent = loc(scn.primaryEdge) ?? '—';
  el('tactics-target-shot').textContent = loc(scn.targetShot) ?? '—';
  populateScoutingCard(scn);
  el('tactics-hint').textContent = `${t('brief.hintPrefix')} ${loc(scn.hint) ?? ''}`;
  updateDifficultyUI();
  updateShapeUI();
  updateDeliveryUI();
  updateTacticsIntentUI();
  // 추천 플랜 한 줄 — 스카우팅 추천 액션 + 우위. 첫 경기엔 이것만, 나머지는 접는다.
  const scoutP = SCOUTING[scn.scheme];
  const planActs = scoutP ? actionLabels(scoutP.recommendActions) : (loc(scn.targetShot) ?? '');
  const edgeKo = loc(scn.primaryEdge) ?? '';
  const boardRead = evaluateBoard(engine);
  el('tactics-plan-text').textContent = boardRead?.best
    ? boardReadText(boardRead)
    : `${schemeLabel(scn.scheme)}${t('brief.vsSuffix')}${edgeKo}${planActs ? ' → ' + planActs : ''}`;
  applyBriefingMode();
}

// 첫 경기 브리핑 단순화 — 추천 플랜만 노출, 고급(난이도·셰이프·세트피스·시작대형·스카우팅)은 접기.
// 첫 경기만 자동 접힘. 사용자가 토글하면 그 선택을 기억한다.
let briefingPref = null; // null=자동, true=펼침, false=접힘
try { const v = localStorage.getItem('btb:brief'); if (v === 'exp') briefingPref = true; else if (v === 'col') briefingPref = false; } catch { /* private */ }
function briefingExpanded() {
  if (briefingPref !== null) return briefingPref;
  const mp = Club.club.record.w + Club.club.record.d + Club.club.record.l;
  return mp > 0;
}
function applyBriefingMode() {
  const exp = briefingExpanded();
  tacticsOverlay.classList.toggle('simplified', !exp);
  const btn = document.getElementById('btn-tactics-adv');
  if (btn) { btn.textContent = exp ? t('brief.advClose') : t('brief.adv'); btn.setAttribute('aria-expanded', exp ? 'true' : 'false'); }
}
document.getElementById('btn-tactics-adv')?.addEventListener('click', () => {
  briefingPref = tacticsOverlay.classList.contains('simplified');
  try { localStorage.setItem('btb:brief', briefingPref ? 'exp' : 'col'); } catch { /* private */ }
  applyBriefingMode();
});

// 상대 스카우팅 카드 — design-direction.md §5.3.
// SCOUTING[scheme] 의 추천/주의 actionId 를 한국어로 보여주고, 활성 훈련 효과가
// 어떤 행동을 돕는지 chip 으로 표시. 엔진 보정과의 일치는
// scripts/scouting-consistency-test.mjs 가 보장한다.
function actionLabels(ids) {
  return ids.map((id) => ACTION_LABELS[id] ?? id).join(' · ');
}
function populateScoutingCard(scn) {
  const el = (id) => document.getElementById(id);
  const scout = SCOUTING[scn.scheme];
  if (!scout) {
    el('tactics-scout').hidden = true;
    return;
  }
  el('tactics-scout').hidden = false;
  el('tactics-scout-style').textContent = loc(scout.style);
  el('tactics-scout-weak').textContent = loc(scout.weakness);
  el('tactics-scout-caution').textContent = loc(scout.caution);
  el('tactics-scout-trap').textContent = loc(scout.trap) ?? '—';   // 압박 덫 유형 + 회피법 (E9)
  el('tactics-scout-rec').textContent =
    `${actionLabels(scout.recommendActions)}${scout.recommendLine ? ` · ${loc(scout.recommendLine)}` : ''}`;

  const effects = Club.activeTrainingEffects();
  const trainWrap = el('tactics-scout-train');
  const trainList = el('tactics-scout-train-list');
  if (effects.length === 0) {
    trainWrap.hidden = true;
    return;
  }
  trainWrap.hidden = false;
  trainList.innerHTML = effects.map((e) => {
    const left = e.until == null ? '' : ` (${t('unit.matchesLeft').replace('{n}', Math.max(0, e.until - Club.club.matchday))})`;
    return `<span class="ts-chip">${loc(e.label)}${left}</span>`;
  }).join('');
}

// x 오프셋만 필요 — engine.js의 INTENT_OFFSET에서 off 값만 미러링
const INTENT_X_OFFSET = {
  front: { pin: 0, drop: -11 },
  mid: { between: 0, support: -8 },
  back: { overlap: 14, hold: 0 },
};
function lineGroupForRole(role) {
  if (role === 'ST' || role === 'W') return 'front';
  if (role === '8' || role === '10' || role === 'DM') return 'mid';
  if (role === 'FB' || role === 'IFB') return 'back';
  return null;
}

// intents = { front, mid, back } — 선택한 인텐트에 따라 대형을 미리 보여줌.
// homeX(ghost 점선) → 인텐트 적용 위치(solid)로 변하는 것을 한눈에 확인.
function buildFormationSvg(scn, intents = { front: 'pin', mid: 'between', back: 'hold' }) {
  const W = 320, H = 208, PW = 105, PH = 68;
  const mx = (x) => ((clamp(x, 1, PW - 1) / PW) * W).toFixed(1);
  const my = (y) => ((y / PH) * H).toFixed(1);
  const ours = scn.buildOurs();
  const opps = scn.buildOpp();
  let d = '';
  // Pitch
  d += `<rect width="${W}" height="${H}" fill="#091510"/>`;
  d += `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="#183020" stroke-width="1"/>`;
  d += `<line x1="${mx(52.5)}" y1="0" x2="${mx(52.5)}" y2="${H}" stroke="#183020" stroke-width="0.8"/>`;
  d += `<ellipse cx="${mx(52.5)}" cy="${my(34)}" rx="11" ry="11" fill="none" stroke="#183020" stroke-width="0.7"/>`;
  // Penalty areas
  const paH = (Number(my(54.15)) - Number(my(13.85))).toFixed(1);
  d += `<rect x="1.5" y="${my(13.85)}" width="${mx(16.5)}" height="${paH}" fill="none" stroke="#183020" stroke-width="0.7"/>`;
  d += `<rect x="${(W - Number(mx(16.5)) - 1.5).toFixed(1)}" y="${my(13.85)}" width="${mx(16.5)}" height="${paH}" fill="none" stroke="#183020" stroke-width="0.7"/>`;
  // Opp players (red) — 먼저 그려서 우리 선수가 위에 오도록
  for (const p of opps) {
    if (p.line === 'gk') continue;
    const cx = mx(p.x), cy = my(p.y);
    d += `<circle cx="${cx}" cy="${cy}" r="8.5" fill="#ff5a6e" fill-opacity="0.83"/>`;
    d += `<text x="${cx}" y="${(Number(cy) + 3.5).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#fff" font-weight="700" font-family="system-ui,sans-serif">${p.num}</text>`;
  }
  // 우리 선수: ghost(homeX) + 인텐트 적용 위치(adjusted)
  for (const p of ours) {
    const grp = lineGroupForRole(p.role);
    const off = (grp && intents[grp]) ? (INTENT_X_OFFSET[grp]?.[intents[grp]] ?? 0) : 0;
    const adjX = p.x + off;
    const moved = Math.abs(off) >= 1;
    // Ghost: 기본 위치 (점선 원, 인텐트로 움직이는 경우만)
    if (moved) {
      const gx = mx(p.x), gy = my(p.y);
      d += `<circle cx="${gx}" cy="${gy}" r="8" fill="none" stroke="#4d8bff" stroke-opacity="0.22" stroke-width="1.2" stroke-dasharray="3 2"/>`;
      // 화살표 선
      const tx = mx(adjX), ty = my(p.y);
      d += `<line x1="${gx}" y1="${gy}" x2="${tx}" y2="${ty}" stroke="#4d8bff" stroke-opacity="0.30" stroke-width="1" marker-end="url(#arr)"/>`;
    }
    // Solid: 인텐트 적용 위치
    const cx = mx(adjX), cy = my(p.y);
    d += `<circle cx="${cx}" cy="${cy}" r="8.5" fill="#4d8bff" fill-opacity="${moved ? '1' : '0.88'}"/>`;
    d += `<text x="${cx}" y="${(Number(cy) + 3.5).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#062018" font-weight="800" font-family="system-ui,sans-serif">${p.num}</text>`;
  }
  // 화살표 마커 정의
  const arrowDef = `<defs><marker id="arr" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="#4d8bff" fill-opacity="0.45"/></marker></defs>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${arrowDef}${d}</svg>`;
}

function updateDifficultyUI() {
  for (const btn of document.querySelectorAll('.diff-btn')) {
    const on = btn.dataset.difficulty === chosenDifficulty;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  const desc = document.getElementById('tactics-diff-desc');
  if (desc) desc.textContent = t('brief.diffDesc.' + chosenDifficulty);
}

// 세트피스 딜리버리 UI 동기화 (E5) — active + 설명 + 이 상대 상성 표시.
function updateDeliveryUI() {
  for (const btn of document.querySelectorAll('.sp-btn')) {
    const on = btn.dataset.delivery === chosenDelivery;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  const desc = document.getElementById('tactics-sp-desc');
  if (desc) {
    const base = loc(DELIVERIES[chosenDelivery]?.desc) ?? '';
    const strong = deliveryBonus(chosenDelivery, scenario.scheme) === 1;
    const rec = loc(DELIVERIES[bestDeliveryFor(scenario.scheme)]?.label);
    desc.textContent = strong ? `${base} · ${t('sp.strongVs')}` : `${base} · ${t('sp.recommend').replace('{x}', rec)}`;
  }
}

// 빌드업 셰이프 표시 동기화 — 셰이프는 포메이션 선택(FORMATION_ARCHETYPE)이 결정하는
// 읽기 전용 정보다. (구 셰이프 버튼은 게임플레이 무효과 죽은 컨트롤이라 제거, 감사 C5.)
function updateShapeUI() {
  const desc = document.getElementById('tactics-shape-desc');
  const shape = BUILD_SHAPES[chosenShape];
  if (desc && shape) desc.textContent = `${loc(shape.label)} — ${loc(shape.desc)}`;
}

function updateTacticsIntentUI() {
  for (const row of document.querySelectorAll('.tactics-intent-row')) {
    const group = row.dataset.tgroup;
    for (const btn of row.querySelectorAll('button')) {
      const on = tacticsIntents[group] === btn.dataset.tintent;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }
}

for (const btn of document.querySelectorAll('.diff-btn')) {
  btn.addEventListener('click', () => {
    chosenDifficulty = btn.dataset.difficulty;
    updateDifficultyUI();
  });
}
for (const btn of document.querySelectorAll('.sp-btn')) {
  btn.addEventListener('click', () => {
    chosenDelivery = btn.dataset.delivery;
    updateDeliveryUI();
  });
}
for (const row of document.querySelectorAll('.tactics-intent-row')) {
  const group = row.dataset.tgroup;
  for (const btn of row.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      tacticsIntents[group] = btn.dataset.tintent;
      updateTacticsIntentUI();
      // 인텐트 선택 즉시 미니맵 갱신 — 고른 대형이 어떤 모습인지 바로 확인
      const fEl = document.getElementById('tactics-formation');
      if (fEl) fEl.innerHTML = buildFormationSvg(scenario, { ...tacticsIntents });
    });
  }
}

document.getElementById('btn-tactics-kickoff')?.addEventListener('click', () => {
  Object.assign(chosenIntents, tacticsIntents);
  careerRetriesLeft = 1;   // 커리어 재도전은 경기당 1회(감사 H1)
  careerSettled = false;   // 새 매치데이 — 유예 정산 리셋
  // 난이도 오버라이드를 셋업에도 반영 — 엔진(intensityOverride)과 저장/정산 데이터가
  // 서로 다른 강도를 기록하던 이중화 해소(감사 F3.6).
  if (currentSetup) currentSetup.intensity = chosenDifficulty;
  // 포메이션별 고유 트레이드오프를 이번 경기 셋업에 반영(커리어 정산·엔진 부스트 공유).
  if (currentSetup) applyFormationMods(currentSetup, FORMATION_MODS[chosenFormation]);
  // 세트피스 딜리버리를 셋업에 반영(상대 마킹 상성 → 정산 세트피스 채널). E5.
  if (currentSetup) applySetPiece(currentSetup, chosenDelivery, scenario.scheme);
  closeModal(tacticsOverlay);
  newAttempt();
  updateGuide();
  canvas.focus();
});

document.getElementById('btn-retry')?.addEventListener('click', retryAttempt);

// ─── line intents (우리 전략) ─────────────────────────────────────────────────
// The player's chosen strategy survives retries and scenario switches.
const chosenIntents = { front: 'pin', mid: 'between', back: 'hold' };

function applyIntentsToEngine(silent) {
  for (const [group, intent] of Object.entries(chosenIntents)) {
    engine.setLineIntent(group, intent, { silent });
  }
  refreshIntentButtons();
}

function refreshIntentButtons() {
  for (const row of document.querySelectorAll('.intent-row')) {
    const group = row.dataset.group;
    for (const btn of row.querySelectorAll('button')) {
      const on = engine.state.lineIntents[group] === btn.dataset.intent;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }
}

for (const row of document.querySelectorAll('.intent-row')) {
  const group = row.dataset.group;
  for (const btn of row.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      chosenIntents[group] = btn.dataset.intent;
      engine.setLineIntent(group, btn.dataset.intent);
      refreshIntentButtons();
      renderLog(engine);
    });
  }
}
refreshIntentButtons();

// ─── title screen ────────────────────────────────────────────────────────────
const titleOverlay = document.getElementById('title-overlay');
const kickoffButton = document.getElementById('btn-kickoff');
function dismissTitle() {
  closeModal(titleOverlay, false);
  analytics.track('game_start'); // "킥오프" — 실제 플레이 진입
  enterHub();
}
titleOverlay?.addEventListener('click', dismissTitle);
titleOverlay?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    dismissTitle();
  }
});
openModal(titleOverlay, kickoffButton);
analytics.track('load'); // 타이틀 화면 도달 — 퍼널 시작점
applyStaticI18n(); // 정적 라벨(보드·액션바·드로어·브리핑·튜토리얼·모먼트 선택) 다국어 채움

// ─── action chips ────────────────────────────────────────────────────────────
const TARGETED = new Set(['to_feet']);            // 선수 선택(발밑)
const POINTED = new Set(['carry', 'pass_space']); // 지점 클릭(운반·공간 패스)
const actionButtons = [...document.querySelectorAll('[data-action]')];
const GUIDE_KEY = 'beat-the-block:guide:v1';
const coachCard = document.getElementById('coach-card');
let guideDismissed = false;
let renderedGuideKey = null;
try { guideDismissed = localStorage.getItem(GUIDE_KEY) === 'done'; } catch { /* private mode */ }
// Short labels for the in-board ring around the holder — 링이 유일한 조작면이므로
// 압박(press_mode)도 포함(액션바 삭제, 2026-07).
// 조작면 정리(2026-07 실시간): 발밑/공간은 피치 클릭 자동판별로 이미 하나(칩 불필요),
// 기다리기는 실시간에선 "안 누르면 기다림"이라 명시 버튼이 중복 → Space=수동 슬로우로
// 재해석(아래). 링에는 의도 액션만: 운반(유인 몰기)·슈팅·압박. hold 액션 자체는 엔진·
// AI·게이지 붕괴용으로 유지(플레이어 표면에서만 제거).
const RING_LABELS = {
  carry: 'ring.carry', shoot: 'ring.shoot', press_mode: 'ring.press',
};
let ringHover = null;

const actionbarEl = document.querySelector('.actionbar');
// (구 "고급 접기/More" 토글은 액션바 삭제와 함께 제거 — 링은 항상 전체 액션 노출.)

function activateAction(id) {
  if (engine.state.status !== 'live' || engine.busy) return;
  if (id === 'press_mode') {
    const r = engine.openPressingMode();
    if (r.ok) {
      sfx.tick();
      renderedSituationActionKey = '';
      renderLog(engine);
      updateTacticalHud(engine.state);
      refreshActionAvailability();
      setHint(t('hint.pressPick'));
    }
    return;
  }
  if (id === 'hold' || id === 'shoot' || id === 'release') {
    const r = engine.dispatch(id);
    if (r.ok) (id === 'shoot' ? sfx.kick(0.95) : id === 'release' ? sfx.releaseChime() : sfx.tick());
    afterDispatch();
    return;
  }
  selectAction(id);
}

function dismissGuide() {
  guideDismissed = true;
  try { localStorage.setItem(GUIDE_KEY, 'done'); } catch { /* private mode */ }
  updateGuide();
}

function updateGuide() {
  if (!coachCard) return;
  const titleVisible = titleOverlay?.classList.contains('visible');
  // 결정 창(전환·수비 국면·압박)이 열리면 코치 카드를 숨긴다 — 그 카드는 공격
  // 빌드업 기본기 팁이라 수비 상황줄과 무관하고, 같은 좌상단에서 겹친다.
  // (첫 경기에서 볼을 잃으면 코치가 "짧은 패스로 유인" 팁을 수비 결정 위에 덮었음.)
  const decisionActive = !!engine.state.matchDecision || !!engine.state.baited;   // 유인 창도 결정으로 취급(코치 카드 숨김)
  const stage = engine.state.phase === 'FINAL_THIRD' || engine.state.phase === 'SHOT'
    ? 3
    : engine.state.turn > 0 || engine.state.phase !== 'BUILDUP' ? 2 : 1;
  const renderKey = `${guideDismissed}:${titleVisible}:${decisionActive}:${stage}`;
  if (renderKey === renderedGuideKey) return;
  renderedGuideKey = renderKey;
  const copy = {
    1: [t('coach.s1.title'), t('coach.s1.copy')],
    2: [t('coach.s2.title'), t('coach.s2.copy')],
    3: [t('coach.s3.title'), t('coach.s3.copy')],
  }[stage];
  coachCard.hidden = guideDismissed || titleVisible || decisionActive;
  coachCard.querySelector('.coach-step').textContent = `${t('coach.step')} · ${stage}/3`;
  coachCard.querySelector('.coach-title').textContent = copy[0];
  coachCard.querySelector('.coach-copy').textContent = copy[1];
  for (const btn of actionButtons) {
    const locked = !guideDismissed && stage === 1 && btn.dataset.guideTier === 'advanced';
    btn.classList.toggle('guide-locked', locked);
  }
  // 첫 플레이 1단계에선 '고급' 토글도 숨겨 기본기에 집중시킨다.
  actionbarEl?.classList.toggle('guide-stage1', !guideDismissed && stage === 1);
}

document.getElementById('btn-guide-dismiss')?.addEventListener('click', dismissGuide);
document.getElementById('btn-guide')?.addEventListener('click', () => {
  guideDismissed = false;
  updateGuide();
});

const ACTION_SFX = {
  to_feet: () => sfx.kick(0.55),
  pass_space: () => sfx.kick(0.7),
  carry: () => sfx.kick(0.3),
};

for (const btn of actionButtons) {
  btn.addEventListener('click', () => activateAction(btn.dataset.action));
  // U5: long-press (contextmenu) surfaces the explanation — tooltips don't
  // exist on touch.
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (btn.title) setHint(btn.title);
  });
}

// U1: keyboard play. Space = 기다리기, 1..9 = action in bar order, R = retry,
// Esc = disarm. ←/→(또는 ↑/↓) = 받을 동료 선택, Enter = 실행 — 마우스 없이 완주.
document.addEventListener('keydown', (e) => {
  if (e.repeat && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (document.querySelector('#title-overlay.visible, #outcome-overlay.visible, #select-overlay.visible, #tactics-overlay.visible, #hub-overlay.visible, #career-result.visible')) return;
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
  // QA Major 3: never hijack a focused control — Space/Enter on a button,
  // summary, link or editable element must keep its native behaviour.
  if (t instanceof HTMLElement && (t.isContentEditable || t.closest('button, summary, a, [contenteditable]'))) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); kbCycleTarget(-1); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); kbCycleTarget(1); return; }
  if (e.key === 'Enter') { e.preventDefault(); kbExecute(); return; }
  // 유인 창이 열려 있으면 E(또는 Space)로 릴리스 — 뒷공간 3자 콤비 완성.
  if (engine.state.baited && (e.key === 'e' || e.key === 'E' || e.code === 'Space')) {
    e.preventDefault(); activateAction('release'); return;
  }
  // Space = 수동 슬로우(프로토 검증 개념) — 시간을 늦추고 침착하게 레인을 읽는다.
  // 시도당 1회, 다음 액션 실행 시 해제. (구 '기다리기' 디스패치는 실시간에선 중복 —
  // 진짜 기다림은 안 누르는 것이고, 그 비용은 시계가 문다.)
  if (e.code === 'Space') {
    e.preventDefault();
    tryManualSlow();
    return;
  }
  if (e.key === 'r' || e.key === 'R') { retryAttempt(); return; }
  if (e.key === 'Escape') { selectAction('to_feet'); return; }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9) {
    // 키→액션은 aria-keyshortcuts로 매핑(1 발밑 · 2 공간 · 3 기다리기 · 4 운반 · 9 슛).
    const btn = actionButtons.find((b) => (b.getAttribute('aria-keyshortcuts') || '').split(' ').includes(String(n)));
    if (btn && !btn.disabled && !btn.classList.contains('guide-locked')) activateAction(btn.dataset.action);
  }
});
selectAction('to_feet'); // visible armed state matches the default from turn 0 (#22)

function selectAction(id) {
  selectedAction = id;
  hover = null;
  kbTargetId = null;
  lastTapTargetId = null;
  pendingCarry = null;
  for (const btn of actionButtons) btn.classList.toggle('armed', btn.dataset.action === id);
  // 패스 모드(발밑/공간)는 패스 버튼에 반영하고 서브메뉴는 닫는다.
  const passBtn = document.getElementById('btn-pass');
  if (passBtn) {
    const isPass = id === 'to_feet' || id === 'pass_space';
    passBtn.classList.toggle('armed', isPass);
    passBtn.textContent = t('act.pass');   // 단일 패스 — 유형은 피치 클릭으로 판별
  }
  const hints = {
    to_feet: t('hint.toFeet'),
    pass_space: t('hint.passSpace'),
    carry: t('hint.carry'),
  };
  setHint(hints[id] || '');
  // 공간 패스 무장 시 즉시 범위 그라데이션이 보이도록 기본 조준을 잡아둔다.
  if (id === 'pass_space') {
    const h = engine.holder();
    if (h) hover = buildSpaceHover({ x: Math.min(h.x + 22, PITCH_W - 3), y: h.y });
  }
  updateTacticalFactors(id);
}

// (구 패스 서브메뉴 setPassMenu는 액션바 삭제와 함께 제거 — 유형은 피치 클릭이 판별.)
document.getElementById('btn-pass')?.addEventListener('click', () => {
  selectAction('to_feet');   // 패스 모드 arm — 유형은 피치 클릭으로 자동 판별(동료=발밑/빈 공간=공간)
});

// 매치 중 factor 툴팁 — roadmap P5. 선택한 action 의 위험도에 영향을 주는
// 요소(scheme/정체성/적응 등)를 HUD 에 표시. tacticalFactors 라벨을 chip 으로.
function updateTacticalFactors(actionId) {
  const row = document.getElementById('tactic-factors-row');
  const val = document.getElementById('tactic-factors');
  if (!row || !val) return;
  if (!engine || engine.state.status !== 'live' || !actionId) { row.hidden = true; return; }
  const factors = tacticalFactors(engine.state, actionId);
  if (factors.length === 0) { row.hidden = true; return; }
  row.hidden = false;
  val.innerHTML = factors.map((f) => {
    const cls = f.multiplier < 1 ? 'up' : 'down';
    const sign = f.multiplier < 1 ? '↑' : f.multiplier > 1 ? '↓' : '';
    return `<span class="tf-tag ${cls}">${f.label}${sign ? ' ' + sign : ''}</span>`;
  }).join('');
}

function setHint(text) {
  const el = document.querySelector('.actionbar .hint');
  if (el) el.textContent = text;
}

// Availability per state: shoot only with a live zone, switch needs the kick.
function refreshActionAvailability() {
  const live = engine.state.status === 'live' && !engine.busy;
  const decisionActive = !!engine.state.matchDecision;  // 전환 국면 — 상황 선택이 우선
  const zone = engine.shotZoneNow();
  for (const btn of actionButtons) {
    const id = btn.dataset.action;
    let enabled = live && !decisionActive;
    if (id === 'shoot') enabled = live && !!zone;
    if (decisionActive) enabled = false;
    btn.disabled = !enabled;
  }
  // U3: the glow means "this is a GOOD shot", not "a shot exists" — low-xG
  // zones (midRange/centralD) stay shootable but don't beg to be taken.
  const shootBtn = actionButtons.find((b) => b.dataset.action === 'shoot');
  if (shootBtn) {
    // 전환 국면에선 슛을 강조하지 않는다 — "버튼은 켜졌는데 왜 안 되지?" 혼란 제거.
    shootBtn.classList.toggle('shot-ready', !decisionActive && !!zone && zone.baseXg >= 0.24);
    const sp = engine.previewShot();
    shootBtn.textContent = sp ? `${t('act.shoot')} ${Math.round(sp.xg * 100)}%` : t('act.shoot');
  }
  // 전환 국면: 일반 액션을 흐리게 — 카운터프레스/후퇴(상황 선택)가 주 액션이 되도록.
  actionbarEl?.classList.toggle('decision-active', decisionActive);
}

// ─── canvas input ────────────────────────────────────────────────────────────
canvas.addEventListener('mousemove', (e) => {
  if (engine.state.status !== 'live' || engine.busy) { hover = null; ringHover = null; return; }
  // In-board ring pills take hover priority over teammates.
  const pill = pickActionAt(e.clientX, e.clientY);
  ringHover = pill;
  canvas.style.cursor = pill ? 'pointer' : 'crosshair';
  if (pill) {
    hover = null;
    const btn = actionButtons.find((b) => b.dataset.action === pill);
    if (btn?.title) setHint(btn.title);
    return;
  }
  const p = toPitch(e.clientX, e.clientY);
  if (POINTED.has(selectedAction)) {
    hover = buildPointHover(selectedAction, p);
    return;
  }
  if (!TARGETED.has(selectedAction)) { hover = null; return; }
  const target = nearestTeammate(p);
  // 동료 근처 → 발밑 미리보기, 빈 공간 → 공간 패스 미리보기 (클릭 대상 자동 판별)
  hover = target
    ? { kind: 'preview', targetId: target.id, preview: engine.preview(selectedAction, target.id) }
    : buildPointHover('pass_space', p);
});

canvas.addEventListener('mouseleave', () => { hover = null; });

// C1 모바일 — 캔버스 길게 누르기(터치 480ms) = 수동 슬로우.
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  longPressAt = { x: e.clientX, y: e.clientY };
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    if (tryManualSlow()) suppressNextClick = true;   // 발동 → 릴리스 click 삼킴
  }, 480);
}, { passive: true });
canvas.addEventListener('pointermove', (e) => {
  if (!longPressAt) return;
  if (Math.hypot(e.clientX - longPressAt.x, e.clientY - longPressAt.y) > 14) {
    clearTimeout(longPressTimer); longPressAt = null;   // 드래그면 취소
  }
}, { passive: true });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  canvas.addEventListener(ev, () => { clearTimeout(longPressTimer); longPressAt = null; }, { passive: true });
}

canvas.addEventListener('click', (e) => {
  if (suppressNextClick) { suppressNextClick = false; return; }   // 길게누르기 발동 직후 클릭 무시
  if (engine.state.status !== 'live' || engine.busy) return;
  // Ring pill click = same as the matching bottom-bar button.
  const pill = pickActionAt(e.clientX, e.clientY);
  if (pill) { activateAction(pill); return; }
  const p = toPitch(e.clientX, e.clientY);
  // Clicking the holder disarms any special action back to the basic pass.
  const h = engine.holder();
  if (h && dist({ x: h.rx ?? h.x, y: h.ry ?? h.y }, p) < 2.6 && selectedAction !== 'to_feet') {
    selectAction('to_feet');
    return;
  }
  if (POINTED.has(selectedAction)) {
    // U2: on touch, first tap previews the path/landing; a second tap near the
    // same spot executes — same contract as the teammate two-tap.
    if (isTouchSession && (!pendingCarry || dist(pendingCarry, p) > 2.5)) {
      pendingCarry = { x: p.x, y: p.y };
      hover = buildPointHover(selectedAction, p);
      setHint(selectedAction === 'carry' ? t('hint.carryTap') : t('hint.spaceTap'));
      return;
    }
    const point = pendingCarry ?? p;
    pendingCarry = null;
    const _h0 = engine.holder();
    const r = engine.dispatch(selectedAction, null, point);
    if (r.ok) {
      // 킥 강도 = 패스 거리 비례(볼 물리와 쌍) — 짧은 패스는 톡, 긴 대각은 뻥.
      if (selectedAction === 'pass_space' && _h0) sfx.kick(Math.min(0.9, 0.3 + dist(_h0, point) / 60));
      else ACTION_SFX[selectedAction]?.();
      // 유인 사운드(A4) — 물었다(상승 2음) / 안 물었다(무딘 톡, F2 로그와 쌍).
      if (selectedAction === 'carry' && r.bait) {
        if (r.bait.baited) sfx.baitPull();
        else if (r.bait.commitP != null) sfx.baitMiss();
      }
    }
    afterDispatch();
    return;
  }
  if (!TARGETED.has(selectedAction)) return;
  const target = nearestTeammate(p);
  if (!target) {
    // 빈 공간 클릭 → 공간 패스. 패스 유형을 클릭 대상으로 자동 판별(동료=발밑/공간=공간).
    // 별도 드롭다운·메뉴 없이 피치 안에서 다 됨.
    if (isTouchSession && (!pendingCarry || dist(pendingCarry, p) > 2.5)) {
      pendingCarry = { x: p.x, y: p.y };
      hover = buildPointHover('pass_space', p);
      setHint(t('hint.spaceTap'));
      return;
    }
    const point = pendingCarry ?? p;
    pendingCarry = null;
    const _h0 = engine.holder();
    const r = engine.dispatch('pass_space', null, point);
    if (r.ok) sfx.kick(_h0 ? Math.min(0.9, 0.3 + dist(_h0, point) / 60) : 0.7);   // 거리 비례
    afterDispatch();
    return;
  }
  // 동료 근처 → 발밑. Touch: first tap previews, second tap on the same target executes.
  if (isTouchSession && lastTapTargetId !== target.id) {
    lastTapTargetId = target.id;
    hover = { kind: 'preview', targetId: target.id, preview: engine.preview(selectedAction, target.id) };
    setHint(t('hint.tapExecute'));
    return;
  }
  executeTargetedAction(target.id);
});

// 패스/특수 액션 실행 — 클릭과 키보드(Enter)가 공유하는 단일 실행 경로.
function executeTargetedAction(targetId) {
  lastTapTargetId = null;
  const _h0 = engine.holder();
  const _t0 = engine.state.players.find((pp) => pp.id === targetId);
  const result = engine.dispatch(selectedAction, targetId);
  if (!result.rejected) {
    if (result.ok) {
      if (selectedAction === 'to_feet' && _h0 && _t0) sfx.kick(Math.min(0.9, 0.3 + dist(_h0, _t0) / 60));   // 거리 비례
      else ACTION_SFX[selectedAction]?.();
    }
    hover = null;
    kbTargetId = null;
    // After a special action resolves, fall back to the basic pass.
    if (selectedAction !== 'to_feet') selectAction('to_feet');
  }
  afterDispatch();
  return result;
}

function nearestTeammate(p) {
  let best = null, bestD = Infinity;
  for (const m of engine.state.players) {
    if (m.side !== 'us' || m.id === engine.state.holderId) continue;
    const d = dist({ x: m.rx ?? m.x, y: m.ry ?? m.y }, p);
    if (d < bestD) { bestD = d; best = m; }
  }
  return bestD < 4.5 ? best : null;
}

// ─── Keyboard play: ←/→ 동료 선택, Enter 실행 (마우스 없이 완주 가능) ──────────
function selectableTeammates() {
  const s = engine.state;
  return s.players
    .filter((m) => m.side === 'us' && m.id !== s.holderId && m.role !== 'GK')
    .sort((a, b) => (a.x - b.x) || (a.y - b.y));
}

function kbCycleTarget(dir) {
  if (engine.state.status !== 'live' || engine.busy) return;
  if (!TARGETED.has(selectedAction)) { // hold/shoot/carry는 대상이 없음
    announce(`${actionName(selectedAction)}: ${t('ann.noTarget')}`);
    return;
  }
  const list = selectableTeammates();
  if (!list.length) return;
  let idx = list.findIndex((m) => m.id === kbTargetId);
  idx = idx < 0 ? (dir > 0 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
  kbTargetId = list[idx].id;
  const preview = engine.preview(selectedAction, kbTargetId);
  hover = { kind: 'preview', targetId: kbTargetId, preview };
  announceTarget(list[idx], preview);
}

function announceTarget(player, preview) {
  const lane = preview?.lane ?? preview?.landing;
  let risk = '';
  if (lane && typeof lane.risk === 'number') {
    const pct = Math.round(lane.risk * 100);
    const word = lane.risk < 0.34 ? t('ann.safe') : lane.risk < 0.6 ? t('ann.caution') : t('ann.danger');
    risk = ` — ${t('ann.blockRisk')} ${pct}% (${word})`;
  } else if (lane?.status === 'offside') {
    risk = ` — ${t('ann.offside')}`;
  }
  announce(t('ann.targetSelected')
    .replace('{label}', player.label)
    .replace('{risk}', risk)
    .replace('{action}', actionName(selectedAction)));
}

function kbExecute() {
  if (engine.state.status !== 'live' || engine.busy) return;
  if (selectedAction === 'hold' || selectedAction === 'shoot') { activateAction(selectedAction); return; }
  if (selectedAction === 'carry') { setHint(t('hint.carryPoint')); announce(t('ann.carryNeedsPoint')); return; }
  if (!TARGETED.has(selectedAction)) return;
  if (!kbTargetId) { kbCycleTarget(1); return; } // 첫 Enter는 선택부터
  const label = selectableTeammates().find((m) => m.id === kbTargetId)?.label ?? '';
  const r = executeTargetedAction(kbTargetId);
  if (r && !r.rejected) announce(t('ann.executed').replace('{label}', label).replace('{action}', actionName(selectedAction)));
}

function announce(text) {
  const el = document.getElementById('kb-announce');
  if (el) el.textContent = text;
}

function distPointSeg(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(pt.x - a.x, pt.y - a.y);
  const t = clamp(((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(pt.x - (a.x + dx * t), pt.y - (a.y + dy * t));
}

// Shared carry preview (mouse hover + touch two-tap) — same numbers the
// engine rolls: 11m cap, path threat, box-converge penalty.
function buildCarryHover(point) {
  const h = engine.holder();
  const d = dist(h, point);
  const maxCarry = carryRange(h.traits);   // 엔진 carry와 동일한 물리(공 보유 시 느림)
  const to = d > maxCarry
    ? { x: h.x + (point.x - h.x) / d * maxCarry, y: h.y + (point.y - h.y) / d * maxCarry }
    : { x: point.x, y: point.y };
  to.x = clamp(to.x, 2, PITCH_W - 2); to.y = clamp(to.y, 2, PITCH_H - 2);
  const threat = engine.state.players.filter((d2) => d2.side === 'opp' && d2.line !== 'gk')
    .some((d2) => distPointSeg(d2, h, to) < 3.2);
  const boxRush = to.x > 85 && Math.abs(to.y - PITCH_H / 2) < 14;
  return { kind: 'carryPath', to, status: threat || boxRush ? 'risky' : 'safe' };
}

function buildPointHover(action, point) {
  return action === 'carry' ? buildCarryHover(point) : buildSpaceHover(point);
}

// 공간 패스 프리뷰 — 조준 지점, 도달 가능 여부, 가장 가까운 수신자, 거리·능력치
// 비례 위험(그라데이션 진하기). 엔진 pass_space와 같은 직관(능력치가 위험을 낮춤).
function buildSpaceHover(point) {
  const h = engine.holder();
  const s = engine.state;
  const aim = { x: clamp(point.x, 2, PITCH_W - 2), y: clamp(point.y, 2, PITCH_H - 2) };
  const d = dist(h, aim);
  const lofted = d > 28;
  const reachable = !(lofted && (h.traits?.longPass ?? 0) < 0.5) && d >= 4;
  let nu = null, du = Infinity;
  for (const p of s.players) {
    if (p.side !== 'us' || p.role === 'GK' || p.id === s.holderId) continue;
    const dd = dist(p, aim);
    if (dd < du) { du = dd; nu = p; }
  }
  const pass = h.traits?.pass ?? 0.7;
  const longPass = h.traits?.longPass ?? 0.5;
  const reachPenalty = clamp((du - 6) / 16, 0, 0.4);
  // 몸 방향(orientation) — 정면이면 앞(+x)으로, 등지면 뒤로 향한다. 향한 쪽은
  // 멀리/정확, 반대(특히 등 뒤)는 짧고 위험. 범위가 원이 아니라 방향성 로브.
  const facingAngle = h.orientation === 'BACK' ? Math.PI : 0;
  const baseFrac = h.orientation === 'BACK' ? 0.32 : h.orientation === 'HALF' ? 0.45 : 0.6;
  const passAngle = Math.atan2(aim.y - h.y, aim.x - h.x);
  const lobe = baseFrac + (1 - baseFrac) * (1 + Math.cos(passAngle - facingAngle)) / 2; // 0.32~1
  const risk = clamp((d / 70 + reachPenalty) * (1.15 - pass * 0.3) * (1 + (1 - lobe) * 0.8), 0.05, 0.95);
  // 도달 프로필 — 포지션/능력치로 다르게. 롱패스 < 0.5는 로빙 불가(지상 28m).
  const maxR = longPass < 0.5 ? 28 : 28 + (longPass - 0.5) * 58;
  const safeR = clamp(14 + pass * 22, 12, maxR);
  // 수신 자세 예측 — "이 패스를 주면 어떤 몸으로 받나"(결정적, RNG 아님). 착지점
  // 최근접 수비수가 골 사이드(전방을 막음)·근접이면 등지고 갇힘, 멀면 자유 전진.
  let dno = Infinity, ndef = null;
  for (const o of s.players) {
    if (o.side !== 'opp' || o.line === 'gk') continue;
    const od = dist(o, aim);
    if (od < dno) { dno = od; ndef = o; }
  }
  const goalSide = ndef && ndef.x > aim.x - 1.5;          // 수비수가 전방(골 쪽)을 막음
  const reception = (dno <= 3.5 && goalSide) ? 'trapped' : dno <= 6 ? 'pressured' : 'free';
  return { kind: 'spaceAim', aim, lofted, reachable, receiver: nu ? { x: nu.x, y: nu.y } : null, du, risk, maxR, safeR, facingAngle, baseFrac, reception };
}

function afterDispatch() {
  manualSlow.active = false;   // 액션 실행 → 수동 슬로우 해제(1회성)
  renderLog(engine);
  updateGuide();
}

// ─── view toggles ────────────────────────────────────────────────────────────
hookToggle('toggle-channels', (v) => { toggles.channels = v; });
hookToggle('toggle-labels', (v) => { toggles.labels = v; });
hookToggle('toggle-shadows', (v) => { toggles.shadows = v; });
hookToggle('toggle-superiority', (v) => { toggles.superiority = v; });
const soundToggle = document.getElementById('toggle-sound');
if (soundToggle) {
  soundToggle.checked = soundEnabled();
  soundToggle.addEventListener('change', () => setSoundEnabled(soundToggle.checked));
}
function hookToggle(id, fn) {
  const el = document.getElementById(id);
  if (el) { fn(el.checked); el.addEventListener('change', () => fn(el.checked)); }
}
// The view-options popover closes on any outside press (native <details> won't).
const viewMenu = document.querySelector('.view-menu');
document.addEventListener('pointerdown', (e) => {
  if (viewMenu?.open && !viewMenu.contains(e.target)) viewMenu.removeAttribute('open');
});

// ─── Career flow: Hub ↔ Match ↔ Result ───────────────────────────────────────
const hubOverlay = document.getElementById('hub-overlay');
const careerResult = document.getElementById('career-result');
let offlineShown = false;
let lastMatch = null; // { oppName, setup, scenario } — 정산용 컨텍스트
let pendingCareerEvent = null;
let pendingTrainingOptions = [];
let trainingTaken = false;

function enterHub() {
  careerActive = false;
  const sb = document.getElementById('scorebug');
  if (sb) sb.hidden = true;   // 매치 스코어버그는 매치에서만 노출
  renderHub();
  syncFormationBoard();   // 다음 상대 셰이프 + 포메이션 해금 상태 갱신
  openModal(hubOverlay);
  if (!offlineShown && offlineGain > 1) {
    offlineShown = true;
    toast(`${t('offline.body')} <b>${Club.formatNum(offlineGain)}</b>`);
  }
  if (Club.club.firstPlay) showTutorial();
}

// ── 온보딩 튜토리얼 (roadmap 고도화) ──
let tutorialStep = 0;
const tutorialOverlay = document.getElementById('tutorial-overlay');

function renderTutorialStep() {
  const stepKey = TUTORIAL_STEPS[tutorialStep];
  setText('tutorial-step-tag', `${tutorialStep + 1} / ${TUTORIAL_STEPS.length}`);
  setText('tutorial-title', t(`${stepKey}.title`));
  setText('tutorial-body', t(`${stepKey}.body`));
  const dotsEl = document.getElementById('tutorial-dots');
  dotsEl.innerHTML = TUTORIAL_STEPS.map((_, i) => `<span class="tut-dot ${i === tutorialStep ? 'on' : ''}"></span>`).join('');
  const nextBtn = document.getElementById('tutorial-next');
  nextBtn.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? t('tut.start') : t('tut.next');
}

function showTutorial() {
  tutorialStep = 0;
  renderTutorialStep();
  tutorialOverlay.classList.add('visible');
  tutorialOverlay.setAttribute('aria-hidden', 'false');
  // 접근성: 튜토리얼이 허브 위에 뜨므로 뒤 허브를 inert 처리(탭 누수 방지) +
  // 포커스를 튜토리얼 버튼으로 이동(키보드·스크린리더 사용자를 다이얼로그에 배치).
  hubOverlay.inert = true;
  requestAnimationFrame(() => document.getElementById('tutorial-next')?.focus());
}

function closeTutorial() {
  tutorialOverlay.classList.remove('visible');
  tutorialOverlay.setAttribute('aria-hidden', 'true');
  hubOverlay.inert = false;
  Club.club.firstPlay = false;
  Club.save();
  // 포커스를 허브로 복귀.
  requestAnimationFrame(() => {
    hubOverlay.querySelector('button:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
  });
}

document.getElementById('tutorial-next').addEventListener('click', () => {
  if (tutorialStep < TUTORIAL_STEPS.length - 1) { tutorialStep++; renderTutorialStep(); }
  else closeTutorial();
});
document.getElementById('tutorial-skip').addEventListener('click', closeTutorial);

// 튜토리얼은 managed modal이 아니므로(허브를 가린 채 떠 있음) Tab 트랩을 직접 건다.
// 캡처 단계로 modal.js(허브 기준) 핸들러보다 먼저 처리해 포커스를 튜토리얼 안에 가둔다.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !tutorialOverlay.classList.contains('visible')) return;
  const items = [...tutorialOverlay.querySelectorAll('button:not([disabled])')].filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1], a = document.activeElement;
  if (!tutorialOverlay.contains(a)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
}, true);

// 허브의 "다음 경기" → 이번 매치데이의 시나리오/상대/셋업을 잡고 전술 매치로.
function startMatch() {
  const info = nextMatchInfo();           // { oppName, oppOVR, setup, scenario, disposition }
  currentSetup = info.setup;
  lastMatch = info;
  chosenDifficulty = info.setup.intensity; // 압박 강도 = 클럽 vs 상대 전력
  oppDisposition = info.disposition ?? null; // 상대 전개 성향 페르소나 (C단계)
  careerActive = true;
  analytics.track('match_start', { div: Club.club.divIdx }); // 경기 시작(디비전 기록)
  closeModal(hubOverlay);
  // 모먼트 카드 제거(2026-07): 결정된 다음 상대 시나리오로 바로 셋업 브리핑 직행.
  // 상대를 보고 포메이션·지침을 대응 선택 → START. 카드 고르는 단계 없음.
  scenario = getScenario(info.scenario.cell);
  bindScenarioPanels(scenario);
  const cc = document.getElementById('current-cell');
  if (cc) cc.textContent = scenario.cell;
  populateScorebug();
  showTacticsOverlay();
}

// 전술 모먼트 종료 → 스코어라인 시뮬 → 정산 → 결과 카드.
function settleCareerMatch() {
  careerSettled = true;   // 유예 정산: 이 매치데이는 이제 확정 — 재도전 차단
  const out = engine.state.outcome;
  const f = engine.state.facts || {};
  const tone = out?.tone ?? 'fail';   // goal | near | fail
  const setup = currentSetup || lastMatch?.setup;
  if (!setup) { showOutcome(engine, retryAttempt, () => enterHub()); return; }
  const seasonGoalCtx = { divIdx: Club.club.divIdx };
  // 수행 품질(압박 유인·라인통과·전환·침투·열린공간 활용 + 슛 xG)을 스코어로.
  const perf = {
    tone,
    baits: f.baits, linesBroken: f.linesBroken, switches: f.switches,
    runs: f.runs, windowsUsed: f.windowsUsed,
    situationsResolved: f.situationsResolved, decisionsMade: f.decisionsMade,
    fouls: f.fouls ?? 0,   // 전술 파울 누적 → 3회부터 정산 실점 가중
    xg: out?.xg ?? 0,
    concededLive: out?.kind === 'conceded' ? 1 : 0,   // 수비 국면 실점 → 스코어라인 반영
    // 게임스테이트 (E4): 전술 모먼트의 모멘텀·피로가 정산 스코어라인으로 흘러든다.
    momentum: engine.state.momentum, fatigue: engine.state.fatigue,
  };
  const score = resolveScoreline(perf, setup, careerRng);
  const lockedBefore = Object.keys(FORMATION_UNLOCKS).filter((k) => !isFormationUnlocked(k, Club.club));
  const income = Club.settleMatch(score.result, score.cleanSheet);
  // 라이벌전(B3 더비) — 이긴 더비는 판이 컸던 만큼 +50% 보너스. 결과 노트로 표기.
  let rivalBonus = 0;
  if (lastMatch?.rival && score.result === 'w') {
    rivalBonus = Math.round(income * 0.5);
    Club.club.cash += rivalBonus;
    Club.club.totalEarned += rivalBonus;
    Club.club.runEarned += rivalBonus;
  }
  // 컵 런(B3) — 컵 매치데이는 스트릭이 걸린다: 이길수록 보상 상승(×1~×2.5), 4연승=
  // 우승(트로피+대박), 패배·무승부는 스트릭 리셋("컵 탈락 — 다음 대회").
  let cupNote = null;
  if (lastMatch?.cup) {
    if (score.result === 'w') {
      const stk = (Club.club.cupStreak ?? 0) + 1;
      let cupBonus = Math.round(income * (0.5 + 0.5 * stk));
      if (stk >= 4) {
        Club.club.cupsWon = (Club.club.cupsWon ?? 0) + 1;
        Club.club.cupStreak = 0;
        cupBonus += Math.round(income * 3);
        cupNote = t('cr.note.cupWonAll').replace('{amt}', Club.formatNum(cupBonus));
        toast('🏆 ' + t('hub.cupTrophy'));
      } else {
        Club.club.cupStreak = stk;
        cupNote = t('cr.note.cupWin').replace('{n}', String(stk)).replace('{amt}', Club.formatNum(cupBonus));
      }
      Club.club.cash += cupBonus; Club.club.totalEarned += cupBonus; Club.club.runEarned += cupBonus;
    } else {
      if ((Club.club.cupStreak ?? 0) > 0) Club.club.cupStreak = 0;
      cupNote = t('cr.note.cupOut');
    }
  }
  // 포메이션 해금 체크 — 이번 정산(승수/경기수 증가)으로 새로 열린 포메이션 축하.
  const newlyUnlocked = lockedBefore.filter((k) => isFormationUnlocked(k, Club.club));
  for (const k of newlyUnlocked) {
    toast(`🔓 ${t('hub.unlocked').replace('{x}', FORMATIONS[k]?.shape ?? k)}`);
  }
  const mission = checkMission({ ...score, tone });
  const cond = rollPostMatchCondition({ ...score, tone }, careerRng);
  const prog = Club.addPoints(score.result);
  // 경기 종료 측정 — 퍼널 끝점 + 결과/승격(리텐션 신호).
  analytics.track('match_end', { result: score.result, tone, prog });
  analytics.track(score.result === 'w' ? 'match_win' : score.result === 'd' ? 'match_draw' : 'match_loss');
  if (prog === 'promote') analytics.track('promote');
  const gains = inferIdentityFromMatch(engine.state, out);
  const identity = addIdentityXp(gains);
  Club.recordCareerSnapshot();
  // 시즌 목표 추적 갱신 — 우세 정체성 streak + 시나리오 승(승일 때만).
  updateIdentityStreak(dominantIdentityFromGains(gains));
  if (score.result === 'w') addScenarioWin(scenario.cell);
  const seasonGoals = ['identity_streak', 'scenario_win'].map((id) => checkSeasonGoal(id, seasonGoalCtx)).filter(Boolean);
  pendingTrainingOptions = trainingOptionsFromReport(out?.report, engine.state).slice(0, 2);
  trainingTaken = false;
  pendingCareerEvent = maybeCareerEvent(careerRng);
  Club.save();
  showCareerResult({ tone, score, income, prog, oppName: lastMatch?.oppName ?? '', mission, seasonGoals, cond, report: out?.report, identity, training: pendingTrainingOptions, rivalBonus, cupNote });
}

// 색종이 파티클 — Web Animations API로 자체 낙하/회전(추가 CSS 불필요).
function spawnConfetti(host, n = 42) {
  if (!host || prefersReducedMotion()) return;   // 접근성: 모션 최소화 시 색종이 생략
  const colors = ['#4d8bff', '#ffc24b', '#ff5a6e', '#5aa9f0', '#c8a0e8', '#ffffff'];
  const h = host.clientHeight || 600;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    const sz = 5 + Math.random() * 6;
    p.style.cssText = `position:absolute;top:-14px;left:${Math.random() * 100}%;width:${sz.toFixed(1)}px;height:${(sz * 0.5).toFixed(1)}px;background:${colors[(Math.random() * colors.length) | 0]};pointer-events:none;z-index:1000;border-radius:1px;`;
    host.appendChild(p);
    const dx = (Math.random() - 0.5) * 180;
    const dur = 1100 + Math.random() * 1000;
    const rot = Math.random() * 720 - 360;
    const anim = p.animate?.([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx.toFixed(0)}px, ${(h + 50).toFixed(0)}px) rotate(${rot.toFixed(0)}deg)`, opacity: 0.85 },
    ], { duration: dur, easing: 'cubic-bezier(0.25, 0.6, 0.4, 1)' });
    if (anim) anim.onfinish = () => p.remove(); else setTimeout(() => p.remove(), dur);
  }
}

function showCareerResult({ tone, score, income, prog, oppName, mission, seasonGoals = [], cond, report, identity, training = [], rivalBonus = 0, cupNote = null }) {
  const r = score.result;
  careerResult.dataset.tone = r;
  setText('cr-result', 'FULL TIME · ' + (r === 'w' ? t('res.win') : r === 'd' ? t('res.draw') : t('res.loss')));
  setText('cr-opp', `${t('match.vs')} ${oppName}`);
  setText('cr-desc', tone === 'goal' ? t('res.goalDesc') : tone === 'fail' ? t('res.failDesc') : t('res.nearDesc'));
  setText('cr-earn-k', t('res.earn'));
  setText('cr-pts-k', t('res.points'));
  setText('cr-earn', '+' + Club.formatNum(income));
  setText('cr-pts', '+' + (r === 'w' ? 3 : r === 'd' ? 1 : 0));

  const banner = document.getElementById('cr-banner');
  let bannerText = '';
  if (prog === 'promote') bannerText = '⬆ ' + t('res.promoted');
  else if (prog === 'reach-top') bannerText = '🏆 ' + t('res.reachedTop');
  else if (prog === 'champion') bannerText = '🏆 ' + t('res.champion');
  else if (mission) bannerText = t('cr.banner.mission').replace('{title}', loc(mission.title)).replace('{reward}', Club.formatNum(mission.reward));
  else if (r === 'w' && Club.club.streakW >= 2) bannerText = `🔥 ${Club.club.streakW} ${t('res.streak')}`;
  else if (score.cleanSheet && r !== 'l') bannerText = '🛡 ' + t('res.cleanSheet');
  if (banner) { banner.hidden = !bannerText; banner.textContent = bannerText; }
  if (banner && !bannerText && seasonGoals.length) {
    bannerText = t('cr.banner.seasonGoal').replace('{title}', loc(seasonGoals[0].title)).replace('{reward}', Club.formatNum(seasonGoals[0].reward));
    banner.hidden = false;
    banner.textContent = bannerText;
  }

  const reportEl = document.getElementById('cr-report');
  if (reportEl) {
    reportEl.innerHTML = renderTacticalReport(report);
    reportEl.hidden = !report;
  }

  const identityEl = document.getElementById('cr-identity');
  if (identityEl && identity) {
    identityEl.style.setProperty('--idc', identity.color);
    identityEl.innerHTML = `<span>${t('cr.identity.growth')}</span><strong>${loc(identity.label)}</strong><b class="xp-pop">${Math.round(identity.value)} XP</b>`;
    identityEl.hidden = false;
  }

  const trainingEl = document.getElementById('cr-training');
  if (trainingEl) {
    trainingEl.hidden = training.length === 0;
    trainingEl.innerHTML = training.length ? `
      <div class="ct-k">${t('cr.training.title')}</div>
      <div class="ct-list">${training.map((opt) => `
        <button type="button" class="ct-choice" data-training="${opt.id}">
          <b>${loc(opt.label)}</b><span>${loc(opt.desc)}</span>
          ${opt.nextEffect ? `<em class="ct-next">${t('cr.training.next').replace('{x}', opt.nextEffect)}</em>` : ''}
        </button>`).join('')}</div>` : '';
    for (const btn of trainingEl.querySelectorAll('.ct-choice')) {
      btn.addEventListener('click', () => {
        if (trainingTaken) return;
        const opt = pendingTrainingOptions.find((x) => x.id === btn.dataset.training);
        const id = applyTrainingChoice(opt);
        trainingTaken = true;
        for (const b of trainingEl.querySelectorAll('.ct-choice')) b.disabled = true;
        btn.classList.add('picked');
        if (identityEl && id) {
          identityEl.style.setProperty('--idc', id.color);
          identityEl.innerHTML = `<span>${t('cr.identity.trained')}</span><strong>${loc(id.label)}</strong><b>${Math.round(id.value)} XP</b>`;
          identityEl.hidden = false;
        }
      });
    }
  }

  // 부상/컨디션(+배너에 못 실은 미션) 노트
  const notes = document.getElementById('cr-notes');
  if (notes) {
    const parts = [];
    // 수행 요약 — "내 전술이 결과를 바꿨다"를 체감
    if (score.ourGoals >= 3) parts.push(t('cr.note.dominate').replace('{n}', score.ourGoals));
    else if (score.ourGoals >= 2) parts.push(t('cr.note.multi'));
    else if (tone === 'goal' && score.dominance >= 0.5) parts.push(t('cr.note.decisive'));
    else if (tone === 'fail') parts.push(t('cr.note.lost'));
    if (score.setPieceGoal) parts.push(t('cr.note.setpiece'));
    if (rivalBonus > 0) parts.push(t('cr.note.rival').replace('{amt}', Club.formatNum(rivalBonus)));
    if (cupNote) parts.push(cupNote);
    if (mission && !bannerText.includes(loc(mission.title))) parts.push(t('cr.note.mission').replace('{title}', loc(mission.title)).replace('{reward}', Club.formatNum(mission.reward)));
    if (cond) parts.push((cond.tone === 'bad' ? '⚠ ' : '✨ ') + loc(cond.text));
    for (const goal of seasonGoals) {
      if (!bannerText.includes(loc(goal.title))) parts.push(t('cr.banner.seasonGoal').replace('{title}', loc(goal.title)).replace('{reward}', Club.formatNum(goal.reward)));
    }
    notes.hidden = parts.length === 0;
    notes.innerHTML = parts.join('<br>');
  }

  setText('cr-continue', t('res.back'));
  if (prog === 'promote' || prog === 'reach-top' || prog === 'champion') sfx.chime();
  openModal(careerResult);

  // Win: brief green flash overlay. (접근성: 모션 최소화 시 생략)
  if (r === 'w' && !prefersReducedMotion()) {
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:rgba(77, 139, 255,0.18);pointer-events:none;z-index:999;transition:opacity 0.6s ease-out;';
    // (careerResult는 CSS상 position:fixed라 absolute 플래시가 그대로 덮는다.
    //  여기서 inline position을 건드리면 fixed가 덮여 오버레이가 흐름으로 떨어지는 버그.)
    careerResult.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '0'; });
    setTimeout(() => flash.remove(), 700);
  }

  // 승리 색종이 — 승격/우승은 더 화려하게.
  if (r === 'w') {
    const big = prog === 'promote' || prog === 'reach-top' || prog === 'champion';
    spawnConfetti(careerResult, big ? 84 : 42);
  }

  // Animate score count-up. (접근성: 모션 최소화 시 최종 스코어 즉시 표시)
  const scoreEl = document.getElementById('cr-score');
  if (scoreEl && prefersReducedMotion()) {
    scoreEl.textContent = `${score.ourGoals} : ${score.oppGoals}`;
  } else if (scoreEl) {
    const finalOur = score.ourGoals, finalOpp = score.oppGoals;
    const duration = 800;
    const startTime = performance.now();
    scoreEl.textContent = '0 : 0';
    function animateScore(now) {
      const elapsed = now - startTime;
      const t2 = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t2, 3); // ease-out cubic
      const curOur = Math.round(eased * finalOur);
      const curOpp = Math.round(eased * finalOpp);
      scoreEl.textContent = `${curOur} : ${curOpp}`;
      if (t2 < 1) requestAnimationFrame(animateScore);
    }
    requestAnimationFrame(animateScore);
  }
}

document.getElementById('cr-continue')?.addEventListener('click', () => {
  closeModal(careerResult);
  afterResult();
});

// 결과 → 허브.
function afterResult() {
  pendingTrainingOptions = [];
  trainingTaken = false;
  if (pendingCareerEvent) showCareerEvent(pendingCareerEvent);
  else enterHub();
}

function showCareerEvent(event) {
  const overlay = document.getElementById('event-overlay');
  const choices = document.getElementById('event-choices');
  if (!overlay || !choices) { pendingCareerEvent = null; enterHub(); return; }
  overlay.dataset.type = event.type || 'manager';
  setText('event-kicker', loc(event.kicker) || t('event.kicker.default'));
  setText('event-title', loc(event.title) || t('event.title.default'));
  setText('event-desc', loc(event.desc) || t('event.desc.default'));
  choices.innerHTML = '';
  event.choices.forEach((choice, index) => {
    const cost = typeof choice.cost === 'function' ? choice.cost.call(choice) : Number(choice.cost || 0);
    const affordable = !cost || Club.club.cash >= cost;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `event-choice ${affordable ? '' : 'no'}`;
    button.disabled = !affordable;
    button.innerHTML = `<span class="ec-label">${loc(choice.label)}${cost ? ` <em>${Club.formatNum(cost)}</em>` : ''}</span><span class="ec-desc">${loc(choice.desc) || ''}</span>`;
    button.addEventListener('click', () => {
      if (!applyEventChoice(event, index)) return;
      pendingCareerEvent = null;
      closeModal(overlay, false);
      enterHub();
    });
    choices.appendChild(button);
  });
  openModal(overlay, choices.querySelector('button:not([disabled])'));
}

// 헤더 "← 클럽 허브": 진행 중 경기를 접고 허브로.
// 유예 정산과 짝: 시도가 끝났는데(결과를 봤는데) 정산 없이 이탈하면 패배를 지우고
// 같은 매치데이를 다시 사는 익스플로잇이 된다 → 종료 상태에서의 이탈은 먼저 정산.
document.getElementById('btn-hub')?.addEventListener('click', () => {
  if (careerActive && !careerSettled && engine?.state?.status === 'over') {
    hideOutcome();
    settleCareerMatch();   // 정산 카드가 뜨고, 거기서 허브로 이어진다
    return;
  }
  closeModal(careerResult);
  enterHub();
});

function toast(html) {
  const el = document.getElementById('hub-toast');
  if (!el) return;
  el.innerHTML = html;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

initHub({ onPlay: startMatch, onLang: () => {
  applyStaticI18n();
  bindScenarioPanels(scenario);
  syncFormationBoard();   // 허브 포메이션 보드(칩 설명/잠금/상대 라벨)도 새 언어로 재구성 (감사 U5)
}, onUpgrade: () => {} });

// ─── Mobile drawer: 상대 정보·전술 (접이식 하단 시트, ISSUE-003) ───────────────
const asidePanel = document.getElementById('aside-panel');
const drawerBackdrop = document.getElementById('drawer-backdrop');
function setDrawer(open) {
  if (!asidePanel) return;
  asidePanel.classList.toggle('drawer-open', open);
  drawerBackdrop?.classList.toggle('show', open);
  document.getElementById('btn-drawer')?.setAttribute('aria-expanded', String(open));
}
document.getElementById('btn-drawer')?.addEventListener('click', () => setDrawer(!asidePanel?.classList.contains('drawer-open')));
document.getElementById('btn-drawer-close')?.addEventListener('click', () => setDrawer(false));
document.getElementById('read-chip')?.addEventListener('click', () => setDrawer(true));
drawerBackdrop?.addEventListener('click', () => setDrawer(false));

// ─── 포메이션 보드 (허브 = 전술실) — 3개 셰이프를 분필 피치 위에 시각화 ───────────
const FORMATIONS = {
  f433: { shape: '4-3-3', desc: { ko: '균형', en: 'Balanced' }, dots: [
    { x: 50, y: 90, gk: 1 }, { x: 18, y: 72 }, { x: 39, y: 75 }, { x: 61, y: 75 }, { x: 82, y: 72 },
    { x: 28, y: 50 }, { x: 50, y: 48 }, { x: 72, y: 50 }, { x: 24, y: 23 }, { x: 50, y: 18 }, { x: 76, y: 23 } ] },
  f442: { shape: '4-4-2', desc: { ko: '클래식', en: 'Classic' }, dots: [
    { x: 50, y: 90, gk: 1 }, { x: 18, y: 72 }, { x: 39, y: 74 }, { x: 61, y: 74 }, { x: 82, y: 72 },
    { x: 18, y: 48 }, { x: 40, y: 50 }, { x: 60, y: 50 }, { x: 82, y: 48 }, { x: 38, y: 22 }, { x: 62, y: 22 } ] },
  f4231: { shape: '4-2-3-1', desc: { ko: '모던', en: 'Modern' }, dots: [
    { x: 50, y: 90, gk: 1 }, { x: 18, y: 73 }, { x: 39, y: 75 }, { x: 61, y: 75 }, { x: 82, y: 73 },
    { x: 38, y: 57 }, { x: 62, y: 57 }, { x: 24, y: 38 }, { x: 50, y: 36 }, { x: 76, y: 38 }, { x: 50, y: 18 } ] },
  f352: { shape: '3-5-2', desc: { ko: '윙백', en: 'Wing-backs' }, dots: [
    { x: 50, y: 90, gk: 1 }, { x: 30, y: 74 }, { x: 50, y: 76 }, { x: 70, y: 74 },
    { x: 12, y: 52 }, { x: 88, y: 52 }, { x: 34, y: 50 }, { x: 50, y: 48 }, { x: 66, y: 50 }, { x: 40, y: 20 }, { x: 60, y: 20 } ] },
  f343: { shape: '3-4-3', desc: { ko: '하이프레스', en: 'High press' }, dots: [
    { x: 50, y: 90, gk: 1 }, { x: 28, y: 74 }, { x: 50, y: 76 }, { x: 72, y: 74 },
    { x: 16, y: 50 }, { x: 40, y: 52 }, { x: 60, y: 52 }, { x: 84, y: 50 }, { x: 26, y: 22 }, { x: 50, y: 18 }, { x: 74, y: 22 } ] },
  f4312: { shape: '4-3-1-2', desc: { ko: '다이아몬드', en: 'Diamond' }, dots: [
    { x: 50, y: 90, gk: 1 }, { x: 18, y: 73 }, { x: 39, y: 75 }, { x: 61, y: 75 }, { x: 82, y: 73 },
    { x: 50, y: 58 }, { x: 30, y: 46 }, { x: 70, y: 46 }, { x: 50, y: 34 }, { x: 40, y: 18 }, { x: 60, y: 18 } ] },
  f532: { shape: '5-3-2', desc: { ko: '로우블록', en: 'Low block' }, dots: [
    { x: 50, y: 90, gk: 1 }, { x: 12, y: 70 }, { x: 32, y: 74 }, { x: 50, y: 76 }, { x: 68, y: 74 }, { x: 88, y: 70 },
    { x: 34, y: 50 }, { x: 50, y: 48 }, { x: 66, y: 50 }, { x: 40, y: 22 }, { x: 60, y: 22 } ] },
  f451: { shape: '4-5-1', desc: { ko: '컴팩트', en: 'Compact' }, dots: [
    { x: 50, y: 90, gk: 1 }, { x: 18, y: 72 }, { x: 39, y: 74 }, { x: 61, y: 74 }, { x: 82, y: 72 },
    { x: 16, y: 50 }, { x: 35, y: 52 }, { x: 50, y: 50 }, { x: 65, y: 52 }, { x: 84, y: 50 }, { x: 50, y: 20 } ] },
};
let currentFormation = 'f433';
// 다음 상대의 압박 scheme → 보드 표시용 포메이션 키(시나리오 buildOpp와 동일 계보).
const SCHEME_FORMATION = { hybrid: 'f433', gegen: 'f433', man: 'f442', zonal: 'f442', midblock: 'f4231', lowblock: 'f532' };
let oppFormation = 'f442';
let oppShapeLabel = null;    // 시나리오의 oppShapeName(풀 텍스트) — 보드 상단 라벨
// 한 팀의 dots를 절반에 매핑: us=하단(자기 골 아래), opp=상단(미러, 서로 마주봄).
function fbDots(f, side) {
  return f.dots.map((d) => {
    const y = side === 'us' ? 52 + ((d.y - 18) / 72) * 42 : 6 + ((90 - d.y) / 72) * 42;
    return `<span class="fb-dot ${side}${d.gk ? ' gk' : ''}" style="left:${d.x}%;top:${y.toFixed(1)}%"></span>`;
  }).join('');
}
function renderFormationBoard(key) {
  if (!isFormationUnlocked(key, Club.club)) return;   // 잠긴 포메이션은 선택 불가
  const f = FORMATIONS[key];
  const opp = FORMATIONS[oppFormation];
  const pitch = document.getElementById('fb-pitch');
  if (!f || !opp || !pitch) return;
  currentFormation = key;
  // 선택 → 전용 포지션 빌더(chosenFormation) + 공/수 트레이드오프 mods(아키타입) 둘 다 반영.
  chosenFormation = key;
  chosenShape = FORMATION_ARCHETYPE[key] || 'balanced';
  pitch.innerHTML =
    `<span class="fb-side-label opp">${loc({ ko: '상대', en: 'OPPONENT' })} · ${oppShapeLabel ?? (opp.shape + ' ' + loc(opp.desc))}</span>` +
    `<span class="fb-side-label us">${loc({ ko: '우리', en: 'YOU' })} · ${f.shape}</span>` +
    fbDots(opp, 'opp') + fbDots(f, 'us');
  const nameEl = document.getElementById('fb-shape-name');
  if (nameEl) nameEl.textContent = `${f.shape} · ${loc(f.desc)}`;
  setText('fb-mods', formationModsSummary(key));   // 선택 효과(공격/실점) 즉시 표시
  for (const c of document.querySelectorAll('.fb-chip')) c.classList.toggle('on', c.dataset.formation === key);
}
function initFormationBoard() {
  const chips = document.getElementById('fb-chips');
  if (!chips) return;
  chips.innerHTML = Object.entries(FORMATIONS).map(([k, f]) => {
    const cond = FORMATION_UNLOCKS[k];
    const locked = !isFormationUnlocked(k, Club.club);
    // 잠금 칩도 조건을 보여준다 — "무엇을 하면 열리는가"가 진행 동기(해금 요소).
    const sub = locked ? `🔒 ${loc({ ko: cond.ko, en: cond.en })}` : loc(f.desc);
    return `<button type="button" class="fb-chip${locked ? ' locked' : ''}" data-formation="${k}" ${locked ? 'aria-disabled="true"' : ''}><span>${f.shape}</span><span class="fb-chip-sub">${sub}</span></button>`;
  }).join('');
  for (const c of chips.querySelectorAll('.fb-chip')) c.addEventListener('click', () => renderFormationBoard(c.dataset.formation));
  // 선택 중이던 포메이션이 (새 세이브 등으로) 잠겨 있으면 기본으로 폴백.
  if (!isFormationUnlocked(currentFormation, Club.club)) currentFormation = 'f433';
  renderFormationBoard(currentFormation);
}
// 선택 포메이션의 공/수 트레이드오프 요약 — "이 선택이 뭘 바꾸나"를 숫자로.
function formationModsSummary(key) {
  const m = FORMATION_MODS[key] || {};
  const atk = Math.round(((m.passAdd || 0) + (m.shotAdd || 0) + ((m.shotMul || 1) - 1) + ((m.xgMul || 1) - 1)) * 100);
  const con = Math.round(((m.concedeMul || 1) - 1) * 100);
  const sign = (v) => (v > 0 ? '+' : '') + v + '%';
  return `${t('hub.modAtk')} ${sign(atk)} · ${t('hub.modCon')} ${sign(con)}`;
}
// 허브 진입 시 동기화: 다음 상대의 실제 압박 셰이프 + 해금 상태(경기/승수 갱신 반영)
// + 매치 프로그램 스트립(상대명·셰이프·공략 포인트).
function syncFormationBoard() {
  const info = nextMatchInfo();
  oppFormation = SCHEME_FORMATION[info?.scenario?.scheme] ?? 'f442';
  oppShapeLabel = info?.scenario?.oppShapeName ? loc(info.scenario.oppShapeName) : null;
  setText('hs-name', info?.oppName ?? '—');
  setText('hs-shape', oppShapeLabel ?? '');
  // 전개 성향 필 — "뺏기면 이 상대는 이렇게 나온다"를 경기 전에 읽게(C단계).
  setText('hs-disp', info?.disposition ? t('disp.' + info.disposition) : '');
  const sc = SCOUTING[info?.scenario?.scheme];
  setText('hs-weak', sc?.weakness ? loc(sc.weakness) : '—');
  initFormationBoard();
}
initFormationBoard();

// ─── 클럽 철학 모달 (장기 분기 선택·퍼크 해금) ────────────────────────────────
const philoOverlay = document.getElementById('philo-overlay');
function openPhilo() { renderPhiloModal(); openModal(philoOverlay); }
function renderPhiloModal() {
  setText('philo-points', `${Club.club.philoPoints || 0} P`);
  const cur = currentPhilosophy();
  const list = document.getElementById('philo-list');
  if (list) {
    list.innerHTML = PHILOSOPHIES.map((p) => `
      <button type="button" class="philo-card ${cur?.id === p.id ? 'current' : ''}" data-philo="${p.id}" style="--pc:${p.color}">
        <span class="pc-name">${loc(p.name)}</span><span class="pc-kicker">${loc(p.kicker)}</span><span class="pc-desc">${loc(p.desc)}</span>
      </button>`).join('');
    for (const b of list.querySelectorAll('.philo-card')) {
      b.addEventListener('click', () => {
        const targetId = b.dataset.philo;
        const prev = Club.club.philosophy;
        // 정체성 전환 비용 안내 — 이전 철학과 다르면 확인 절차 (roadmap P4 전환 비용).
        if (prev && prev !== targetId) {
          const prevXp = Club.club.identityXp?.[prev] ?? 0;
          const cost = Math.floor(prevXp * 0.2);
          const prevName = loc(getPhilosophy(prev)?.name) ?? prev;
          const targetName = loc(getPhilosophy(targetId)?.name) ?? targetId;
          const msg = t('philo.switch.confirm')
            .replaceAll('{prev}', prevName)
            .replace('{target}', targetName)
            .replace('{cost}', cost);
          if (!window.confirm(msg)) return;
        }
        choosePhilosophy(targetId);
        Club.save();
        renderPhiloModal();
        renderHub();
      });
    }
  }
  const perksEl = document.getElementById('philo-perks');
  if (!perksEl) return;
  if (!cur) { perksEl.innerHTML = `<div class="philo-empty">${t('philo.empty')}</div>`; return; }
  const nextIdx = nextPerkIndex(cur.id);
  const idLevel = activeIdentityLevel()?.level ?? 0;
  perksEl.innerHTML = `<div class="philo-perks-title" style="--pc:${cur.color}">${t('philo.tree').replace('{x}', loc(cur.name))}</div>`
    + cur.perks.map((perk, i) => {
      const unlocked = isPerkUnlocked(perk.id);
      const isNext = i === nextIdx;
      const t4 = perk.tier === 4;
      // T4 고유 퍽은 정체성 Lv4 게이트. 미달 시 잠금 + 사유 표시.
      const t4Locked = t4 && idLevel < 4;
      const cls = unlocked ? 'on' : (isNext && !t4Locked) ? 'next' : 'locked';
      const t4Tag = t4 ? ` <span class="pp-unique">${t('philo.unique')}</span>` : '';
      const right = unlocked ? `<span class="pp-state">${t('philo.unlocked')}</span>`
        : (isNext && !t4Locked) ? `<button type="button" class="pp-unlock"${(Club.club.philoPoints || 0) < 1 ? ' disabled' : ''}>${t('philo.unlock1p')}</button>`
        : t4Locked ? `<span class="pp-state">${t('philo.needLv4')}</span>`
        : `<span class="pp-state">${t('philo.locked')}</span>`;
      return `<div class="philo-perk ${cls}${t4 ? ' perk-t4' : ''}"><span class="pp-tier">T${i + 1}</span><span class="pp-info"><b>${loc(perk.name)}${t4Tag}</b><small>${loc(perk.desc)}</small></span>${right}</div>`;
    }).join('');
  const unlockBtn = perksEl.querySelector('.pp-unlock');
  if (unlockBtn) unlockBtn.addEventListener('click', () => { if (unlockNextPerk()) { Club.save(); renderPhiloModal(); renderHub(); } });
}
document.getElementById('hub-philo')?.addEventListener('click', openPhilo);
// 철학 모달은 허브 위에서 열리는데 openModal이 허브를 교체(단일 activeModal)하므로,
// 닫을 때 closeModal만 하면 아무 화면도 안 남는다 — 반드시 허브로 복귀.
document.getElementById('philo-close')?.addEventListener('click', enterHub);
philoOverlay?.addEventListener('click', (e) => { if (e.target === philoOverlay) enterHub(); });

// 전술 깊이 HUD — 모멘텀·피로 게이지 + 적응(읽힘) 경고.
let renderedSituationActionKey = '';
function renderSituationActions(container, situation) {
  if (!container) return;
  container.innerHTML = '';
  container.dataset.kind = situation?.id || '';
  for (const choice of situation?.choices || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.situationChoice = choice.id;
    btn.title = choice.desc;
    btn.textContent = choice.label;
    btn.addEventListener('click', () => {
      // 상대 지휘자(C단계): 수비 국면이면 이번 스텝의 상대 성향을 상황 반응으로
      // 교체한다. 성향은 이 선택의 resolveDefendStep 내부 전개 스텝에서 읽힌다.
      // 지금까지 쌓인 패턴(내려서기 반복·압박 벗겨짐·회수 횟수)에만 반응 — 이번
      // 클릭 자체는 못 본다(즉발 카운터 방지, 읽고 대응하는 듀얼 감각).
      if (careerActive && engine.state.defenseLoop) {
        const next = commandOpponent(engine.state, oppDisposition);
        if (next !== lastCommanded && engine.setOpponentDisposition(next)) {
          // 페르소나 이탈만 통지(복귀는 조용히) — 전환 카피가 '변화' 어조라서.
          if (next && next !== oppDisposition) toast(t('defcmd.' + next));
          lastCommanded = next;
        }
      }
      const result = engine.chooseSituationOption(choice.id);
      if (result.ok) {
        renderedSituationActionKey = '';
        renderLog(engine);
        updateTacticalHud(engine.state);
        refreshActionAvailability();
      }
    });
    container.appendChild(btn);
  }
}
function updateTacticalHud(s) {
  const mf = document.getElementById('momentum-fill');
  if (mf) { const v = s.momentum ?? 50; mf.style.width = v + '%'; mf.classList.toggle('high', v >= 80); }
  const ff = document.getElementById('fatigue-fill');
  if (ff) { const v = s.fatigue ?? 0; ff.style.width = v + '%'; ff.classList.toggle('high', v >= 65); }
  const aw = document.getElementById('adapt-warn');
  if (aw) {
    if (s.adaptRead) { aw.hidden = false; aw.textContent = `⚠ ${actionName(s.adaptRead)} ${t('hud.adaptRead')}`; }
    else aw.hidden = true;
  }
  const situationEl = document.getElementById('match-situation');
  const transitionActions = document.getElementById('transition-actions');
  const situation = s.matchDecision || s.situations?.active?.at(-1);
  if (situationEl) {
    situationEl.hidden = !situation;
    if (situation) {
      // 상단 스트립은 맥락(제목+설명)만 — 선택 버튼은 피치 오버레이(#transition-actions)
      // 한 곳에만 그린다(중복 버튼 정리, 2026-07).
      situationEl.dataset.kind = situation.id;
      document.getElementById('situation-title').textContent = situation.title;
      document.getElementById('situation-detail').textContent = situation.detail;
      const key = s.matchDecision
        ? `${s.matchDecision.id}:${s.matchDecision.choices.map((choice) => choice.id).join('|')}`
        : '';
      if (key !== renderedSituationActionKey) {
        renderedSituationActionKey = key;
        renderSituationActions(transitionActions, s.matchDecision);
      }
    } else {
      delete situationEl.dataset.kind;
      if (transitionActions) {
        transitionActions.innerHTML = '';
        delete transitionActions.dataset.kind;
      }
      renderedSituationActionKey = '';
    }
  }
}

// ─── render loop ─────────────────────────────────────────────────────────────
let lastTs = performance.now();
let lastWindowKey = null;
let lastDefendKey = null;      // A3 프리즈 연출 — defend 결정 신규 오픈 감지
const frameCache = { key: '', at: 0, shotZoneNow: null, shotPreview: null, boardRead: null, passOptions: null };   // 프레임 예산(C2)
// 골 리플레이(C3) — 라이브 중 최근 ~9초를 저해상도(약 11fps)로 기록, 골이면 보관.
const replayRec = { frames: [], lastAt: 0 };
let lastGoalReplay = null;
let replayState = null;   // { frames, t0, dur, done } — 재생 중이면 루프가 이걸 그림
let defenseFreezeAt = 0;
// 피치를 가리는 풀스크린 오버레이가 떠 있으면 매치는 상호작용 불가 — 그동안
// engine.update + 전체 렌더 + 프레임당 프리뷰 계산을 건너뛴다(배터리/CPU 절약).
const PITCH_COVER_SEL = '#title-overlay.visible, #outcome-overlay.visible, #select-overlay.visible, #tactics-overlay.visible, #hub-overlay.visible, #career-result.visible, #event-overlay.visible, #tutorial-overlay.visible, #philo-overlay.visible';
function renderPaused() {
  return document.hidden || !!document.querySelector(PITCH_COVER_SEL);
}
// 실시간 압박 레이어 — js/engine/realtime.js로 추출(헤드리스 테스트 가능, 게이트:
// scripts/realtime-press-test.mjs). 여기선 active 판정만: 결정 대기(ringLive)·us 공격·
// 첫 플레이 가이드-락 중이 아닐 때(가이드 읽는 동안 시계가 차는 함정 방지 — 검토 R5).
function realtimeActive(s, ringLive) {
  if (!ringLive || engine.holder()?.side !== 'us') return false;
  if (document.querySelector('[data-action].guide-locked')) return false;   // 첫 플레이 가이드 중
  return true;
}

// ─── 골 리플레이 재생(C3) ────────────────────────────────────────────────────
// 기록 프레임을 0.8배속으로 보간 재생 — 선수 rx/ry(렌더 좌표)와 합성 볼만 움직이고
// 엔진 상태는 불변. 끝나면 done 콜백(결과 카드 재오픈).
function startReplay(done) {
  if (!lastGoalReplay || lastGoalReplay.length < 5) { done?.(); return; }
  replayState = { frames: lastGoalReplay, t0: performance.now(), start: lastGoalReplay[0].t, done };
  sfx.whoosh();
}
function stepReplay(ts, dt) {
  const R = replayState;
  const speed = 0.8;
  const tRec = R.start + (performance.now() - R.t0) * speed;
  const fs = R.frames;
  let k = 0;
  while (k < fs.length - 1 && fs[k + 1].t <= tRec) k++;
  if (k >= fs.length - 1) {
    replayState = null;
    const done = R.done; done?.();
    return;
  }
  const A = fs[k], B = fs[k + 1];
  const f = Math.min(1, Math.max(0, (tRec - A.t) / Math.max(1, B.t - A.t)));
  const byId = new Map(B.ps.map((r) => [r[0], r]));
  for (const rec of A.ps) {
    const p = engine.state.players.find((q) => q.id === rec[0]);
    const nb = byId.get(rec[0]);
    if (!p || !nb) continue;
    const nx = rec[1] + (nb[1] - rec[1]) * f, ny = rec[2] + (nb[2] - rec[2]) * f;
    p._vx = (nx - (p.rx ?? nx)) / Math.max(0.016, dt / 1000);   // 노치용 근사 속도
    p._vy = (ny - (p.ry ?? ny)) / Math.max(0.016, dt / 1000);
    p.rx = nx; p.ry = ny;
  }
  let ball = null;
  if (A.ball && B.ball) {
    ball = {
      x: A.ball[0] + (B.ball[0] - A.ball[0]) * f,
      y: A.ball[1] + (B.ball[1] - A.ball[1]) * f,
      lofted: !!A.ball[2], flying: !!A.ball[3],
      flightT: A.ball[4] + (B.ball[4] - A.ball[4]) * f,
    };
  }
  render({
    players: engine.state.players,
    holderId: null, presserId: null, freezeFlash: 0,
    holder: null, ball,
    usColor: Club.club.clubColor,
    pressureExpr: { level: 0, ring: 0, vignette: 0, shout: null },
    phase: engine.state.phase,
    cue: '🎬 ' + t('oc.replay'), cueTone: 'success',
    hover: null, keyboardTargetId: null, passOptions: null, runDestinations: null,
    defenseRoute: null, baitArmed: null, shotZone: null, shotXg: null,
    rewardWindow: null, superiorityZones: null, actionRing: null,
  }, dt);
}

function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(50, ts - lastTs);
  lastTs = ts;
  // 오버레이가 피치를 덮는 동안은 무거운 작업을 멈춘다(루프는 살아있어 닫히면 자동 재개).
  if (renderPaused()) return;
  // 골 리플레이 재생(C3) — 기록 프레임 보간으로 피치를 되돌린다(엔진은 건드리지 않음).
  if (replayState) { stepReplay(ts, dt); return; }
  engine.update(dt);

  const s = engine.state;
  const ringLive = s.status === 'live' && !engine.busy && !s.matchDecision;
  // A3(비대칭 정체성) — 수비 판독 진입 프리즈 연출: 공격은 시간이 흐르고, 볼을 잃으면
  // 세상이 멈춘다. defend 결정이 새로 열리는 순간 낮은 '썸' + 파란 플래시(렌더러).
  const defendKey = s.matchDecision?.id === 'defend' ? `${s.turn}:${s.holderId}` : null;
  if (defendKey && defendKey !== lastDefendKey) { defenseFreezeAt = performance.now(); sfx.freeze(); }
  lastDefendKey = defendKey;
  // 실시간 압박 — us 공격 대기 중일 때만 상대가 볼로 조여온다(수비/애니/가이드 중엔 미적용).
  // 조준 슬로우(사용자 피드백): 캐리는 '선택지 무장→지점 조준' 2단계라 조준하는 동안
  // 시계·압박이 돌면 캐리(핵심 동사)가 실시간 세금을 제일 크게 문다. 캐리를 고르면
  // 시간이 15%로 느려져(프로토에서 검증한 슬로우모션) 침착하게 지점을 고른다 —
  // 생각은 보호되되 완전 정지는 아니라 무한 숙고 익스플로잇은 없다.
  const AIM_SLOW = 0.15;
  if (engine.busy && manualSlow.active) manualSlow.active = false;   // 액션 시작 → 해제(모든 경로 견고)
  const rtDt = (selectedAction === 'carry' || manualSlow.active) ? dt * AIM_SLOW : dt;
  applyRealtimePress(engine, rtDt, realtimeActive(s, ringLive));
  // 프레임 예산(3D 3회차, 로드맵 C2 조기 집행): evaluateBoard + 팀원 전원 preview를
  // 매 프레임 돌리던 것이 실측 병목(37fps, 최악 169ms — 투영은 10만회 7.3ms로 무관).
  // 상태 키(턴·홀더·무장액션·게이지 버킷)가 같으면 140ms 캐시 재사용 — 실시간 이동
  // 반영은 140ms 리프레시로 충분(시각 오버레이용이지 판정이 아님).
  const now = performance.now();
  const hvKey = `${s.turn}:${s.holderId}:${selectedAction}:${Math.round((s.pressure ?? 0) / 6)}:${s.status}:${!!s.matchDecision}`;
  if (hvKey !== frameCache.key || now - frameCache.at > 140) {
    frameCache.key = hvKey; frameCache.at = now;
    frameCache.shotZoneNow = engine.shotZoneNow();
    frameCache.shotPreview = engine.previewShot();   // { zone, xg } or null
    frameCache.boardRead = evaluateBoard(engine);
    frameCache.passOptions = null;
    if (s.status === 'live' && !s.matchDecision) {
      const h = engine.holder();
      if (h?.side === 'us' && selectedAction === 'to_feet') {
        // Colored rings on each teammate — green/yellow/red by pass risk.
        frameCache.passOptions = s.players
          .filter(m => m.side === 'us' && m.id !== h.id && m.role !== 'GK')
          .map(m => {
            const pv = engine.preview('to_feet', m.id);
            if (!pv || pv.lane.status === 'offside') return null;
            return { targetId: m.id, risk: pv.lane.risk };
          })
          .filter(Boolean);
      }
    }
  }
  const shotZoneNow = frameCache.shotZoneNow;
  const shotPreview = frameCache.shotPreview;
  const boardRead = frameCache.boardRead;
  const passOptions = frameCache.passOptions;
  let runDestinations = null;

  // 리플레이 기록(C3) — 라이브 중 90ms 간격으로 렌더 위치·볼 스냅샷.
  if (s.status === 'live') {
    const nowMs = performance.now();
    if (nowMs - replayRec.lastAt > 90) {
      replayRec.lastAt = nowMs;
      const b = engine.ballPos();
      replayRec.frames.push({
        t: nowMs,
        ps: s.players.map((p) => [p.id, p.rx ?? p.x, p.ry ?? p.y]),
        ball: b ? [b.x, b.y, b.lofted ? 1 : 0, b.flying ? 1 : 0, b.flightT ?? 0] : null,
      });
      if (replayRec.frames.length > 110) replayRec.frames.shift();
    }
  }

  render({
    players: s.players,
    holderId: s.holderId,
    presserId: s._presserId ?? null,   // 실시간 압박수(A5) — 렌더러가 주황 링
    freezeFlash: Math.max(0, 1 - (performance.now() - defenseFreezeAt) / 420),   // A3 프리즈 플래시
    holder: engine.holder(),
    ball: engine.ballPos(),
    usColor: Club.club.clubColor,   // 우리 팀 킷 = 클럽 컬러
    rewardWindow: (chosenDifficulty === 'mid' && !s.matchDecision) ? engine.rewardWindowVisible() : null, // 쉬움에서만; 압박/결정 중엔 숨김
    superiorityZones: toggles.superiority ? engine.superiorityZones() : null,
    shotZone: s.matchDecision ? null : shotZoneNow,        // 압박 국면엔 우리 슛존 프리뷰 숨김
    shotXg: s.matchDecision ? null : (shotPreview?.xg ?? null),
    pressureExpr: engine.pressureExpression(),
    phase: s.phase,
    cue: s.cue,
    cueTone: s.cueTone,
    hover: s.matchDecision ? null : hover,                 // 결정 중엔 패스 조준 로브 숨김
    keyboardTargetId: kbTargetId,
    passOptions,
    runDestinations,
    // 예상 루트 인텔 시각화 — 수비 결정(defend) 중 상대의 dry-run best 루트를
    // 피치에 점선으로 그린다. 예측 가능(confident)이면 캐리어→예상 수신자 화살표+
    // 타깃 링, 불가(fuzzy)면 전방 부채꼴 확산(종잡을 수 없음). 인텔 텍스트와 쌍.
    defenseRoute: (s.defenseLoop?.route && s.matchDecision?.id === 'defend' && engine.holder())
      ? { from: { x: engine.holder().x, y: engine.holder().y }, to: s.defenseLoop.route, confident: (s.defenseLoop.pred ?? 1) >= 0.8 }
      : null,
    // 유인 창 시각화(Phase 2) — 유인 성공(state.baited) 시 리시버 드롭 지점 +
    // 릴리스 방향을 피치에 그려 "여기로 릴리스"를 읽게 한다. from=캐리어(볼),
    // drop=뒷공간(마커 원자리+전진), receiver/releaser 위치.
    baitArmed: s.baited ? (() => {
      const recv = s.players.find((p) => p.id === s.baited.receiverId);
      const rel = s.baited.releaserId ? s.players.find((p) => p.id === s.baited.releaserId) : null;
      return {
        drop: { x: Math.min(s.baited.vacated.x + 4, 103), y: s.baited.vacated.y },
        receiver: recv ? { x: recv.x, y: recv.y } : null,
        releaser: rel ? { x: rel.x, y: rel.y } : null,
        carrier: engine.holder() ? { x: engine.holder().x, y: engine.holder().y } : null,
      };
    })() : null,
    // Input is single-surface(2026-07 액션바 삭제): 모든 뷰포트에서 피치 링이 유일한
    // 조작면. 링 항목의 enabled/armed/guide-lock 상태는 비표시 [data-action] 상태
    // 모델에서 읽는다.
    actionRing: ringLive
      ? actionButtons
        // U8: guide-stage locks apply to the ring too, not just the bar.
        .filter((b) => RING_LABELS[b.dataset.action] && !b.classList.contains('guide-locked'))
        .map((b) => ({
          id: b.dataset.action,
          // Show xG% on the shoot pill so the player knows the chance before committing.
          label: b.dataset.action === 'shoot' && shotPreview
            ? `${t('act.shoot')} ${Math.round(shotPreview.xg * 100)}%`
            : t(RING_LABELS[b.dataset.action]),
          enabled: !b.disabled,
          armed: b.classList.contains('armed'),
          hover: ringHover === b.dataset.action,
          // U3: the shoot pill only burns orange in a GOOD zone.
          good: b.dataset.action === 'shoot' ? !!shotZoneNow && shotZoneNow.baseXg >= 0.24 : true,
        }))
      : null,
  }, dt);

  renderHudState(engine, boardRead);
  updateTacticalHud(engine.state);
  refreshActionAvailability();
  updateGuide();

  // Audio follows the match state: crowd swells with pressure, a chime when
  // a real window opens, the crowd reacts to the outcome.
  setPressureLevel(engine.pressureExpression().level);
  const w = engine.rewardWindowVisible();
  const windowKey = w && w.kind === 'real' ? `${w.committerId}:${w.expiresTurn}` : null;
  // 쉬움에서만 윈도우 신호(시각+효과음) — 표준/어려움은 스스로 공간을 읽는다.
  if (chosenDifficulty === 'mid' && windowKey && windowKey !== lastWindowKey) sfx.chime();
  lastWindowKey = windowKey;

  if (s.status === 'over' && !engine.busy && !outcomeShown) {
    outcomeShown = true;
    const kind = s.outcome?.kind;
    if (kind === 'goal' && replayRec.frames.length > 5) lastGoalReplay = replayRec.frames.slice(-100);   // 최근 ~9초 보관(C3)
    if (kind === 'goal') sfx.goal();
    else if (kind === 'saved' || kind === 'off' || kind === 'blocked') sfx.near();
    else if (kind === 'collapsed') { sfx.whistle(); sfx.collapse(); }   // 휘슬 = 시도 종료 표식
    else { sfx.whistle(); sfx.sting(); }
    recordAttempt(engine);
    renderLog(engine);
    if (careerActive) {
      // 유예 정산(2026-07 실플레이 판단): 즉시 정산은 커리어를 "사실상 원샷"으로
      // 만들었다 — 실패를 보기 전엔 재도전할 수 없었으니까. 이제 결과 카드에서
      // 무엇이 잘못됐는지 본 뒤 재도전(1회) 또는 정산을 선택한다. 최종 시도만 정산.
      if (careerSettled) settleCareerMatch();   // 방어적 — 정상 경로에선 도달 안 함
      else {
        const openOc = () => showOutcome(engine, retryAttempt, () => settleCareerMatch(),
          { nextLabel: t('oc.settle'), onReplay: () => startReplay(openOc) });
        openOc();
      }
    } else {
      const openOc = () => showOutcome(engine, retryAttempt, nextCell, { onReplay: () => startReplay(openOc) });
      openOc();
    }
  }
  // (재스케줄은 loop() 진입부에서 처리 — 여기서 다시 호출하면 프레임당 이중 예약됨)
}

// (resize 리스너는 initRenderer가 등록 — 중복 바인딩 제거)
requestAnimationFrame(loop);

// Console test hook for headless playtesting.
window.__game = {
  get engine() { return engine; },
  evaluateBoard: () => evaluateBoard(engine),
  dispatch: (a, t, p) => { const r = engine.dispatch(a, t, p); renderLog(engine); return r; },
  newAttempt,
  switchScenario,
};

// Career test hook — 클럽 상태/플로우 직접 점검 (headless 플레이테스트). [synced]
window.__buc = {
  get club() { return Club.club; },
  get setup() { return currentSetup; },
  enterHub, startMatch,
  Club,
};
