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
import { initRenderer, render, resize, toPitch, toggles, pickActionAt } from './ui/renderer.js';
import {
  bindScenarioPanels, renderHudState, renderLog,
  showOutcome, hideOutcome, recordAttempt, renderArchive, initArchiveControls,
  renderTacticalReport,
} from './ui/hud.js';
import { dist, clamp, PITCH_W, PITCH_H } from './data/pitch.js';
import { initAudio, unlockAudio, setSoundEnabled, soundEnabled, setPressureLevel, sfx } from './ui/audio.js';
import { openModal, closeModal } from './ui/modal.js';
import { prefersReducedMotion } from './util/motion.js';
// ─── Career layer (idle-football-club 메타 + 통합 글루) ───────────────────────
import * as Club from './career/club.js';
import { applyClubBoost, resolveScoreline, BUILD_SHAPES, applyShape, applySetPiece } from './career/mods.js';
import { DELIVERIES, DEFAULT_DELIVERY, bestDeliveryFor, deliveryBonus } from './data/setpieces.js';
import { initHub, renderHub, nextMatchInfo } from './career/hub.js';
import { t } from './career/i18n.js';
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
let engine = createEngine(scenario);
let selectedAction = 'to_feet';
let hover = null;
let kbTargetId = null;   // 키보드로 선택한 동료(없으면 null)
let outcomeShown = false;
let chosenDifficulty = 'high'; // set by tactics overlay, persists across retries
let chosenShape = 'balanced';  // 빌드업 셰이프 (E6) — 브리핑에서 선택, 리트라이/다음경기 유지
let chosenDelivery = DEFAULT_DELIVERY;  // 세트피스 딜리버리 (E5) — 브리핑 선택
const tacticsIntents = { front: 'pin', mid: 'between', back: 'hold' };

// 선택한 셰이프의 빌더로 buildOurs를 덮어쓴 시나리오(공유 SCENARIOS는 변형하지 않음).
// builder=null(균형)이면 시나리오 고유 셰이프 그대로.
function shapedScenario() {
  const b = BUILD_SHAPES[chosenShape]?.builder;
  return b ? { ...scenario, buildOurs: b } : scenario;
}

// ─── Career state ────────────────────────────────────────────────────────────
// 한 경기 = 한 번의 전술 빌드업 모먼트. 그 결과로 클럽이 자란다.
let currentSetup = null;   // mods.matchSetup — 이번 경기의 압박강도/트레잇 부스트/수비
let careerActive = false;  // 전술 매치가 커리어 경기로 진행 중인가
const careerRng = () => Math.random();
const offlineGain = Club.load();   // 저장 불러오기 + 자리비움 수익

bindScenarioPanels(scenario);

// ─── scenario switching (card select) ───────────────────────────────────────
const selectOverlay = document.getElementById('select-overlay');
const selectGrid = document.getElementById('select-grid');

// Only A/B cells have generated artwork; C/D fall back to a tinted gradient so
// the select screen never shows a broken image or 404s in the console.
const CARD_IMG = new Set(['A1', 'A2', 'B1', 'B2']);
const CARD_TINT = { A: '93,214,197', B: '196,75,75', C: '245,166,35', D: '150,110,230' };

function buildSelectGrid() {
  selectGrid.innerHTML = Object.values(SCENARIOS).map((s) => {
    const tint = CARD_TINT[s.cell[0]] ?? '93,214,197';
    const bg = CARD_IMG.has(s.cell)
      ? `linear-gradient(rgba(7,10,14,0.05), rgba(7,10,14,0.2)), url('assets/card-${s.cell.toLowerCase()}.jpg')`
      : `linear-gradient(150deg, rgba(${tint},0.20), rgba(7,10,14,0.88))`;
    return `
    <button type="button" class="moment-card ${s.cell === scenario.cell ? 'current' : ''}" data-cell="${s.cell}"
         aria-label="${s.cell}, ${s.title}, 추천 마무리 ${s.targetShot}"
         style="background-image: ${bg}">
      <div class="mc-info">
        <div class="mc-cell">${s.cell}</div>
        <div class="mc-title">${s.title}</div>
        <div class="mc-plan">${s.oppPlan ?? ''}</div>
        <div class="mc-shot">추천 마무리: ${s.targetShot}</div>
      </div>
    </button>
  `;
  }).join('');
  for (const card of selectGrid.querySelectorAll('.moment-card')) {
    card.addEventListener('click', () => {
      switchScenario(card.dataset.cell);
      closeModal(selectOverlay);
    });
  }
}

document.getElementById('btn-select-moment')?.addEventListener('click', () => {
  buildSelectGrid();
  openModal(selectOverlay, selectGrid.querySelector('.current'));
});
document.getElementById('btn-select-close')?.addEventListener('click', () => closeModal(selectOverlay));
selectOverlay?.addEventListener('click', (e) => {
  if (e.target === selectOverlay) closeModal(selectOverlay);
});

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
  engine = createEngine(shapedScenario(), undefined, { intensityOverride: chosenDifficulty });
  // 통합 글루: 클럽 업그레이드를 'us' 선수 traits로 반영 → 강해질수록 전술이 쉬워짐.
  if (currentSetup) applyClubBoost(engine, currentSetup);
  outcomeShown = false;
  hover = null;
  selectAction('to_feet');
  applyIntentsToEngine(true);
  renderLog(engine);
}

function nextCell() {
  const order = Object.keys(SCENARIOS);
  const idx = order.indexOf(scenario.cell);
  switchScenario(order[(idx + 1) % order.length]);
}

// ─── tactics briefing overlay ────────────────────────────────────────────────
const tacticsOverlay = document.getElementById('tactics-overlay');

const DIFF_DESC = {
  mid: '쉬운 압박 — 패턴을 익히며 연습하세요',
  high: '전방 압박 — 빠른 판단이 필요합니다',
  vhigh: '극강 압박 — 실전 수준의 압박 강도',
};
const SCHEME_LABELS = {
  hybrid: '하이브리드 전방 압박 (선택적 점프)',
  man: '맨마킹 전면 추적 압박',
  zonal: '지역방어 블록 수비',
  gegen: '게겐프레싱 즉시 반격 압박',
  midblock: '미드블록 (중앙 3선 컴팩트)',
  lowblock: '로우블록 (박스 앞 밀집 수비)',
};

// 첫 경기 전 인터랙티브 튜토리얼 단계 — roadmap 고도화(온보딩).
// 4단계: 스카우팅 읽기 → 행동 선택 → 위험도 factor → 결과 설명.
const TUTORIAL_STEPS = [
  {
    title: '상대를 먼저 읽으세요',
    body: '전술 브리핑의 "상대 스카우팅" 카드가 상대의 성향·약점·주의·추천을 알려줍니다. 추천 행동은 실제 엔진 보정과 일치합니다.',
  },
  {
    title: '행동을 선택하세요',
    body: '하단 액션바나 피치 클릭으로 패스·운반·전환 등을 선택합니다. 초보용 행동(발밑 패스, 기다리기)은 항상 표시되고, 고급 행동은 점차 열립니다.',
  },
  {
    title: '위험도 요소를 확인하세요',
    body: '행동을 선택하면 오른쪽 패널에 "위험 요소"가 표시됩니다. 상대 scheme·내 정체성·상황이 이 행동에 어떤 영향을 주는지 즉시 볼 수 있습니다.',
  },
  {
    title: '결과를 설명받고 성장하세요',
    body: '경기 후 전술 리포트가 무엇이 잘했는지 알려주고, 훈련 선택지로 클럽 정체성을 키웁니다. 허브의 시즌 목표·정체성 레벨·승점 차트로 성장을 추적하세요.',
  },
];

function showTacticsOverlay() {
  populateTacticsOverlay(scenario);
  openModal(tacticsOverlay, document.getElementById('btn-tactics-kickoff'));
}

function populateTacticsOverlay(scn) {
  const el = (id) => document.getElementById(id);
  el('tactics-cell').textContent = scn.cell;
  el('tactics-scenario-title').textContent = scn.title;
  el('tactics-formation').innerHTML = buildFormationSvg(shapedScenario(), { ...tacticsIntents });
  el('tactics-our-shape').textContent = scn.ourShapeName;
  el('tactics-opp-shape').textContent = scn.oppShapeName;
  el('tactics-scheme-line').textContent = SCHEME_LABELS[scn.scheme] ?? scn.scheme;
  el('tactics-opp-plan-text').textContent = scn.oppPlan ?? '';
  el('tactics-edge-text').textContent = scn.primaryEdge?.ko ?? '—';
  el('tactics-target-shot').textContent = scn.targetShot ?? '—';
  populateScoutingCard(scn);
  el('tactics-hint').textContent = `힌트: ${scn.hint ?? ''}`;
  updateDifficultyUI();
  updateShapeUI();
  updateDeliveryUI();
  updateTacticsIntentUI();
}

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
  el('tactics-scout-style').textContent = scout.style;
  el('tactics-scout-weak').textContent = scout.weakness;
  el('tactics-scout-caution').textContent = scout.caution;
  el('tactics-scout-trap').textContent = scout.trap ?? '—';   // 압박 덫 유형 + 회피법 (E9)
  el('tactics-scout-rec').textContent =
    `${actionLabels(scout.recommendActions)}${scout.recommendLine ? ` · ${scout.recommendLine}` : ''}`;

  const effects = Club.activeTrainingEffects();
  const trainWrap = el('tactics-scout-train');
  const trainList = el('tactics-scout-train-list');
  if (effects.length === 0) {
    trainWrap.hidden = true;
    return;
  }
  trainWrap.hidden = false;
  trainList.innerHTML = effects.map((e) => {
    const left = e.until == null ? '' : ` (${Math.max(0, e.until - Club.club.matchday)}경기)`;
    return `<span class="ts-chip">${e.label}${left}</span>`;
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
    d += `<circle cx="${cx}" cy="${cy}" r="8.5" fill="#e35d5d" fill-opacity="0.83"/>`;
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
      d += `<circle cx="${gx}" cy="${gy}" r="8" fill="none" stroke="#5dd6c5" stroke-opacity="0.22" stroke-width="1.2" stroke-dasharray="3 2"/>`;
      // 화살표 선
      const tx = mx(adjX), ty = my(p.y);
      d += `<line x1="${gx}" y1="${gy}" x2="${tx}" y2="${ty}" stroke="#5dd6c5" stroke-opacity="0.30" stroke-width="1" marker-end="url(#arr)"/>`;
    }
    // Solid: 인텐트 적용 위치
    const cx = mx(adjX), cy = my(p.y);
    d += `<circle cx="${cx}" cy="${cy}" r="8.5" fill="#5dd6c5" fill-opacity="${moved ? '1' : '0.88'}"/>`;
    d += `<text x="${cx}" y="${(Number(cy) + 3.5).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#062018" font-weight="800" font-family="system-ui,sans-serif">${p.num}</text>`;
  }
  // 화살표 마커 정의
  const arrowDef = `<defs><marker id="arr" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="#5dd6c5" fill-opacity="0.45"/></marker></defs>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${arrowDef}${d}</svg>`;
}

function updateDifficultyUI() {
  for (const btn of document.querySelectorAll('.diff-btn')) {
    const on = btn.dataset.difficulty === chosenDifficulty;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  const desc = document.getElementById('tactics-diff-desc');
  if (desc) desc.textContent = DIFF_DESC[chosenDifficulty] ?? '';
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
    const base = DELIVERIES[chosenDelivery]?.desc ?? '';
    const strong = deliveryBonus(chosenDelivery, scenario.scheme) === 1;
    const rec = DELIVERIES[bestDeliveryFor(scenario.scheme)]?.label;
    desc.textContent = strong ? `${base} · ✓ 이 상대에 강함` : `${base} · 추천: ${rec}`;
  }
}

// 빌드업 셰이프 UI 동기화 (E6) — active 버튼 + 설명 + 미니맵 셰이프 반영.
function updateShapeUI() {
  for (const btn of document.querySelectorAll('.shape-btn')) {
    const on = btn.dataset.shape === chosenShape;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  const desc = document.getElementById('tactics-shape-desc');
  if (desc) desc.textContent = BUILD_SHAPES[chosenShape]?.desc ?? '';
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
for (const btn of document.querySelectorAll('.shape-btn')) {
  btn.addEventListener('click', () => {
    chosenShape = btn.dataset.shape;
    updateShapeUI();
    // 셰이프 선택 즉시 미니맵을 교체된 대형으로 갱신.
    const fEl = document.getElementById('tactics-formation');
    if (fEl) fEl.innerHTML = buildFormationSvg(shapedScenario(), { ...tacticsIntents });
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
  // 빌드업 셰이프 트레이드오프를 이번 경기 셋업에 반영(커리어 정산·엔진 부스트 공유).
  if (currentSetup) applyShape(currentSetup, chosenShape);
  // 세트피스 딜리버리를 셋업에 반영(상대 마킹 상성 → 정산 세트피스 채널). E5.
  if (currentSetup) applySetPiece(currentSetup, chosenDelivery, scenario.scheme);
  closeModal(tacticsOverlay);
  newAttempt();
  updateGuide();
  canvas.focus();
});

document.getElementById('btn-retry')?.addEventListener('click', newAttempt);

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

// ─── action chips ────────────────────────────────────────────────────────────
const TARGETED = new Set(['to_feet', 'into_space', 'bounce', 'third_man', 'switch', 'run_order']);
const actionButtons = [...document.querySelectorAll('[data-action]')];
const GUIDE_KEY = 'beat-the-block:guide:v1';
const coachCard = document.getElementById('coach-card');
let guideDismissed = false;
let renderedGuideKey = null;
try { guideDismissed = localStorage.getItem(GUIDE_KEY) === 'done'; } catch { /* private mode */ }
// Short labels for the in-board ring around the holder.
const RING_LABELS = {
  hold: '기다리기', carry: '운반', bounce: '원투', third_man: '써드맨',
  switch: '전환', into_space: '공간', run_order: '런', shoot: '슈팅',
};
let ringHover = null;

// 고급 액션 접기/펼치기 — 기본 4개만 노출해 첫 화면을 단순하게. 선택은 저장.
const actionbarEl = document.querySelector('.actionbar');
const ADV_KEY = 'beat-the-block:adv:v1';
const moreBtn = document.getElementById('btn-action-more');
function setAdvExpanded(expanded) {
  if (!actionbarEl || !moreBtn) return;
  actionbarEl.classList.toggle('adv-collapsed', !expanded);
  moreBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  try { localStorage.setItem(ADV_KEY, expanded ? 'open' : 'closed'); } catch { /* private */ }
}
try { if (localStorage.getItem(ADV_KEY) === 'open') setAdvExpanded(true); } catch { /* private */ }
moreBtn?.addEventListener('click', () => setAdvExpanded(actionbarEl.classList.contains('adv-collapsed')));

function activateAction(id) {
  if (engine.state.status !== 'live' || engine.busy) return;
  if (id === 'hold' || id === 'shoot') {
    const r = engine.dispatch(id);
    if (r.ok) (id === 'shoot' ? sfx.kick(0.95) : sfx.tick());
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
  const stage = engine.state.phase === 'FINAL_THIRD' || engine.state.phase === 'SHOT'
    ? 3
    : engine.state.turn > 0 || engine.state.phase !== 'BUILDUP' ? 2 : 1;
  const renderKey = `${guideDismissed}:${titleVisible}:${stage}`;
  if (renderKey === renderedGuideKey) return;
  renderedGuideKey = renderKey;
  const copy = {
    1: ['압박을 먼저 움직이세요', '기다리기, 운반, 짧은 패스로 상대가 튀어나오게 만드세요.'],
    2: ['열린 레인을 골라 전진하세요', '선수에 마우스를 올리거나 한 번 탭해 패스 위험도를 먼저 확인하세요.'],
    3: ['열린 슛 존에서 끝내세요', '슈팅 버튼이 강조되면 지체하지 말고 마무리하세요.'],
  }[stage];
  coachCard.hidden = guideDismissed || titleVisible;
  coachCard.querySelector('.coach-step').textContent = `첫 플레이 · ${stage}/3`;
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
  bounce: () => { sfx.kick(0.5); sfx.kick(0.45); },
  third_man: () => sfx.kick(0.55),
  switch: () => { sfx.kick(0.85); sfx.whoosh(); },
  into_space: () => sfx.kick(0.7),
  carry: () => sfx.kick(0.3),
  run_order: () => sfx.tick(),
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
  if (e.code === 'Space') { e.preventDefault(); activateAction('hold'); return; }
  if (e.key === 'r' || e.key === 'R') { newAttempt(); return; }
  if (e.key === 'Escape') { selectAction('to_feet'); return; }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= actionButtons.length) {
    const btn = actionButtons[n - 1];
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
  const hints = {
    to_feet: '받을 동료를 클릭하세요 — 발밑으로 정확히.',
    into_space: '침투시킬 동료를 클릭하세요 — 그 앞 공간으로 보냅니다.',
    bounce: '벽이 될 동료를 클릭하세요 — 받고 바로 돌려받습니다.',
    third_man: '연결 고리를 클릭하세요 — 엔진이 제3의 선수를 찾습니다.',
    switch: '반대 측면의 동료를 클릭하세요 — 긴 전환.',
    carry: '운반할 지점을 피치에서 클릭하세요 (최대 11m).',
    run_order: '침투시킬 동료를 클릭하세요 — 공 없이 공간을 공격합니다.',
  };
  setHint(hints[id] || '');
  updateTacticalFactors(id);
}

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
  const zone = engine.shotZoneNow();
  for (const btn of actionButtons) {
    const id = btn.dataset.action;
    let enabled = live;
    if (id === 'shoot') enabled = live && !!zone;
    if (id === 'switch') enabled = live && (engine.holder()?.traits?.longPass ?? 0) >= 0.5;
    btn.disabled = !enabled;
  }
  // U3: the glow means "this is a GOOD shot", not "a shot exists" — low-xG
  // zones (midRange/centralD) stay shootable but don't beg to be taken.
  const shootBtn = actionButtons.find((b) => b.dataset.action === 'shoot');
  if (shootBtn) {
    shootBtn.classList.toggle('shot-ready', !!zone && zone.baseXg >= 0.24);
    const sp = engine.previewShot();
    shootBtn.textContent = sp ? `슈팅 ${Math.round(sp.xg * 100)}%` : '슈팅';
  }
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
  if (selectedAction === 'carry') {
    hover = buildCarryHover(p);
    return;
  }
  if (!TARGETED.has(selectedAction)) { hover = null; return; }
  const target = nearestTeammate(p);
  hover = target ? { kind: 'preview', targetId: target.id, preview: engine.preview(selectedAction, target.id) } : null;
});

canvas.addEventListener('mouseleave', () => { hover = null; });

canvas.addEventListener('click', (e) => {
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
  if (selectedAction === 'carry') {
    // U2: on touch, first tap previews the path; a second tap near the same
    // spot executes — same contract as the teammate two-tap.
    if (isTouchSession && (!pendingCarry || dist(pendingCarry, p) > 2.5)) {
      pendingCarry = { x: p.x, y: p.y };
      hover = buildCarryHover(p);
      setHint('한 번 더 탭하면 운반합니다 — 경로 판정을 확인하세요.');
      return;
    }
    const point = pendingCarry ?? p;
    pendingCarry = null;
    const r = engine.dispatch('carry', null, point);
    if (r.ok) ACTION_SFX.carry();
    afterDispatch();
    return;
  }
  if (!TARGETED.has(selectedAction)) return;
  const target = nearestTeammate(p);
  if (!target) return;
  // Touch: first tap previews, second tap on the same target executes.
  if (isTouchSession && lastTapTargetId !== target.id) {
    lastTapTargetId = target.id;
    hover = { kind: 'preview', targetId: target.id, preview: engine.preview(selectedAction, target.id) };
    setHint('한 번 더 탭하면 실행합니다 — 레인 판정을 확인하세요.');
    return;
  }
  executeTargetedAction(target.id);
});

// 패스/특수 액션 실행 — 클릭과 키보드(Enter)가 공유하는 단일 실행 경로.
function executeTargetedAction(targetId) {
  lastTapTargetId = null;
  const result = engine.dispatch(selectedAction, targetId);
  if (!result.rejected) {
    if (result.ok) ACTION_SFX[selectedAction]?.();
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
const ACTION_KO = {
  to_feet: '발밑 패스', into_space: '공간 패스', bounce: '원투', third_man: '써드맨',
  switch: '전환', run_order: '런 지시', carry: '운반', hold: '기다리기', shoot: '슈팅',
};

function selectableTeammates() {
  const s = engine.state;
  return s.players
    .filter((m) => m.side === 'us' && m.id !== s.holderId && m.role !== 'GK')
    .sort((a, b) => (a.x - b.x) || (a.y - b.y));
}

function kbCycleTarget(dir) {
  if (engine.state.status !== 'live' || engine.busy) return;
  if (!TARGETED.has(selectedAction)) { // hold/shoot/carry는 대상이 없음
    announce(`${ACTION_KO[selectedAction] ?? '액션'}: 대상 선택이 없습니다. Enter로 실행.`);
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
    const word = lane.risk < 0.34 ? '안전' : lane.risk < 0.6 ? '주의' : '위험';
    risk = ` — 차단 위험 ${pct}% (${word})`;
  } else if (lane?.status === 'offside') {
    risk = ' — 오프사이드';
  }
  announce(`${player.label} 선택${risk}. Enter로 ${ACTION_KO[selectedAction] ?? '실행'}.`);
}

function kbExecute() {
  if (engine.state.status !== 'live' || engine.busy) return;
  if (selectedAction === 'hold' || selectedAction === 'shoot') { activateAction(selectedAction); return; }
  if (selectedAction === 'carry') { setHint('운반 지점은 마우스/터치로 지정하세요.'); announce('운반은 피치 지점 지정이 필요합니다.'); return; }
  if (!TARGETED.has(selectedAction)) return;
  if (!kbTargetId) { kbCycleTarget(1); return; } // 첫 Enter는 선택부터
  const label = selectableTeammates().find((m) => m.id === kbTargetId)?.label ?? '';
  const r = executeTargetedAction(kbTargetId);
  if (r && !r.rejected) announce(`${label}에게 ${ACTION_KO[selectedAction] ?? '패스'} 실행.`);
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
  const maxCarry = 11;
  const to = d > maxCarry
    ? { x: h.x + (point.x - h.x) / d * maxCarry, y: h.y + (point.y - h.y) / d * maxCarry }
    : { x: point.x, y: point.y };
  to.x = clamp(to.x, 2, PITCH_W - 2); to.y = clamp(to.y, 2, PITCH_H - 2);
  const threat = engine.state.players.filter((d2) => d2.side === 'opp' && d2.line !== 'gk')
    .some((d2) => distPointSeg(d2, h, to) < 3.2);
  const boxRush = to.x > 85 && Math.abs(to.y - PITCH_H / 2) < 14;
  return { kind: 'carryPath', to, status: threat || boxRush ? 'risky' : 'safe' };
}

function afterDispatch() {
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
  renderHub();
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
  const step = TUTORIAL_STEPS[tutorialStep];
  setText('tutorial-step-tag', `${tutorialStep + 1} / ${TUTORIAL_STEPS.length}`);
  setText('tutorial-title', step.title);
  setText('tutorial-body', step.body);
  const dotsEl = document.getElementById('tutorial-dots');
  dotsEl.innerHTML = TUTORIAL_STEPS.map((_, i) => `<span class="tut-dot ${i === tutorialStep ? 'on' : ''}"></span>`).join('');
  const nextBtn = document.getElementById('tutorial-next');
  nextBtn.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? '시작하기 ✓' : '다음 →';
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
  const info = nextMatchInfo();           // { oppName, oppOVR, setup, scenario }
  currentSetup = info.setup;
  lastMatch = info;
  scenario = info.scenario;
  chosenDifficulty = info.setup.intensity; // 압박 강도 = 클럽 vs 상대 전력
  careerActive = true;
  bindScenarioPanels(scenario);
  const cc = document.getElementById('current-cell');
  if (cc) cc.textContent = scenario.cell;
  closeModal(hubOverlay);
  showTacticsOverlay();                     // 브리핑 → 킥오프 → newAttempt
}

// 전술 모먼트 종료 → 스코어라인 시뮬 → 정산 → 결과 카드.
function settleCareerMatch() {
  const out = engine.state.outcome;
  const f = engine.state.facts || {};
  const tone = out?.tone ?? 'fail';   // goal | near | fail
  const setup = currentSetup || lastMatch?.setup;
  if (!setup) { showOutcome(engine, newAttempt, () => enterHub()); return; }
  const seasonGoalCtx = { divIdx: Club.club.divIdx };
  // 수행 품질(압박 유인·라인통과·전환·침투·열린공간 활용 + 슛 xG)을 스코어로.
  const perf = {
    tone,
    baits: f.baits, linesBroken: f.linesBroken, switches: f.switches,
    runs: f.runs, windowsUsed: f.windowsUsed,
    situationsResolved: f.situationsResolved, decisionsMade: f.decisionsMade,
    xg: out?.xg ?? 0,
    // 게임스테이트 (E4): 전술 모먼트의 모멘텀·피로가 정산 스코어라인으로 흘러든다.
    momentum: engine.state.momentum, fatigue: engine.state.fatigue,
  };
  const score = resolveScoreline(perf, setup, careerRng);
  const income = Club.settleMatch(score.result, score.cleanSheet);
  const mission = checkMission({ ...score, tone });
  const cond = rollPostMatchCondition({ ...score, tone }, careerRng);
  const prog = Club.addPoints(score.result);
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
  showCareerResult({ tone, score, income, prog, oppName: lastMatch?.oppName ?? '', mission, seasonGoals, cond, report: out?.report, identity, training: pendingTrainingOptions });
}

// 색종이 파티클 — Web Animations API로 자체 낙하/회전(추가 CSS 불필요).
function spawnConfetti(host, n = 42) {
  if (!host || prefersReducedMotion()) return;   // 접근성: 모션 최소화 시 색종이 생략
  const colors = ['#5dd6c5', '#f5a623', '#e35d5d', '#5aa9f0', '#c8a0e8', '#ffffff'];
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

function showCareerResult({ tone, score, income, prog, oppName, mission, seasonGoals = [], cond, report, identity, training = [] }) {
  const r = score.result;
  careerResult.dataset.tone = r;
  setText('cr-result', r === 'w' ? t('res.win') : r === 'd' ? t('res.draw') : t('res.loss'));
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
  else if (mission) bannerText = `🎯 미션 달성 · ${mission.title} +${Club.formatNum(mission.reward)}`;
  else if (r === 'w' && Club.club.streakW >= 2) bannerText = `🔥 ${Club.club.streakW} ${t('res.streak')}`;
  else if (score.cleanSheet && r !== 'l') bannerText = '🛡 ' + t('res.cleanSheet');
  if (banner) { banner.hidden = !bannerText; banner.textContent = bannerText; }
  if (banner && !bannerText && seasonGoals.length) {
    bannerText = `시즌 목표 달성 · ${seasonGoals[0].title} +${Club.formatNum(seasonGoals[0].reward)}`;
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
    identityEl.innerHTML = `<span>정체성 성장</span><strong>${identity.label}</strong><b class="xp-pop">${Math.round(identity.value)} XP</b>`;
    identityEl.hidden = false;
  }

  const trainingEl = document.getElementById('cr-training');
  if (trainingEl) {
    trainingEl.hidden = training.length === 0;
    trainingEl.innerHTML = training.length ? `
      <div class="ct-k">리포트 기반 훈련 선택</div>
      <div class="ct-list">${training.map((opt) => `
        <button type="button" class="ct-choice" data-training="${opt.id}">
          <b>${opt.label}</b><span>${opt.desc}</span>
          ${opt.nextEffect ? `<em class="ct-next">다음 경기 · ${opt.nextEffect}</em>` : ''}
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
          identityEl.innerHTML = `<span>훈련 반영</span><strong>${id.label}</strong><b>${Math.round(id.value)} XP</b>`;
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
    if (score.ourGoals >= 3) parts.push('🔥 완벽한 지배 — 빌드업으로 ' + score.ourGoals + '골');
    else if (score.ourGoals >= 2) parts.push('⚡ 지배적인 빌드업으로 다득점');
    else if (tone === 'goal' && score.dominance >= 0.5) parts.push('🎯 잘 풀어낸 결정적 빌드업');
    else if (tone === 'fail') parts.push('↩ 볼 로스트 — 역습 위험에 노출');
    if (score.setPieceGoal) parts.push('⚽ 세트피스 득점 — 코너/프리킥에서 마무리');
    if (mission && !bannerText.includes(mission.title)) parts.push(`🎯 ${mission.title} +${Club.formatNum(mission.reward)}`);
    if (cond) parts.push((cond.tone === 'bad' ? '⚠ ' : '✨ ') + cond.text);
    for (const goal of seasonGoals) {
      if (!bannerText.includes(goal.title)) parts.push(`시즌 목표 달성 · ${goal.title} +${Club.formatNum(goal.reward)}`);
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
    flash.style.cssText = 'position:absolute;inset:0;background:rgba(93,214,197,0.18);pointer-events:none;z-index:999;transition:opacity 0.6s ease-out;';
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
  setText('event-kicker', event.kicker || '클럽 결정');
  setText('event-title', event.title || '선택의 시간');
  setText('event-desc', event.desc || '다음 경기 전에 방향을 선택하세요.');
  choices.innerHTML = '';
  event.choices.forEach((choice, index) => {
    const cost = typeof choice.cost === 'function' ? choice.cost.call(choice) : Number(choice.cost || 0);
    const affordable = !cost || Club.club.cash >= cost;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `event-choice ${affordable ? '' : 'no'}`;
    button.disabled = !affordable;
    button.innerHTML = `<span class="ec-label">${choice.label}${cost ? ` <em>${Club.formatNum(cost)}</em>` : ''}</span><span class="ec-desc">${choice.desc || ''}</span>`;
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
document.getElementById('btn-hub')?.addEventListener('click', () => {
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

initHub({ onPlay: startMatch, onLang: () => bindScenarioPanels(scenario), onUpgrade: () => {} });

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
drawerBackdrop?.addEventListener('click', () => setDrawer(false));

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
        <span class="pc-name">${p.name}</span><span class="pc-kicker">${p.kicker}</span><span class="pc-desc">${p.desc}</span>
      </button>`).join('');
    for (const b of list.querySelectorAll('.philo-card')) {
      b.addEventListener('click', () => {
        const targetId = b.dataset.philo;
        const prev = Club.club.philosophy;
        // 정체성 전환 비용 안내 — 이전 철학과 다르면 확인 절차 (roadmap P4 전환 비용).
        if (prev && prev !== targetId) {
          const prevXp = Club.club.identityXp?.[prev] ?? 0;
          const cost = Math.floor(prevXp * 0.2);
          const prevName = getPhilosophy(prev)?.name ?? prev;
          const targetName = getPhilosophy(targetId)?.name ?? targetId;
          const msg = `[정체성 전환] ${prevName} → ${targetName}\n\n전환 비용:\n• ${prevName} XP 20% 차감 (${cost} XP)\n• 연속 기록 초기화\n\n전환하시겠습니까?`;
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
  if (!cur) { perksEl.innerHTML = '<div class="philo-empty">위에서 철학을 먼저 선택하세요.</div>'; return; }
  const nextIdx = nextPerkIndex(cur.id);
  const idLevel = activeIdentityLevel()?.level ?? 0;
  perksEl.innerHTML = `<div class="philo-perks-title" style="--pc:${cur.color}">${cur.name} 트리</div>`
    + cur.perks.map((perk, i) => {
      const unlocked = isPerkUnlocked(perk.id);
      const isNext = i === nextIdx;
      const t4 = perk.tier === 4;
      // T4 고유 퍽은 정체성 Lv4 게이트. 미달 시 잠금 + 사유 표시.
      const t4Locked = t4 && idLevel < 4;
      const cls = unlocked ? 'on' : (isNext && !t4Locked) ? 'next' : 'locked';
      const t4Tag = t4 ? ' <span class="pp-unique">고유</span>' : '';
      const right = unlocked ? '<span class="pp-state">해금됨 ✓</span>'
        : (isNext && !t4Locked) ? `<button type="button" class="pp-unlock"${(Club.club.philoPoints || 0) < 1 ? ' disabled' : ''}>해금 1P</button>`
        : t4Locked ? '<span class="pp-state">정체성 Lv4 필요</span>'
        : '<span class="pp-state">잠김</span>';
      return `<div class="philo-perk ${cls}${t4 ? ' perk-t4' : ''}"><span class="pp-tier">T${i + 1}</span><span class="pp-info"><b>${perk.name}${t4Tag}</b><small>${perk.desc}</small></span>${right}</div>`;
    }).join('');
  const unlockBtn = perksEl.querySelector('.pp-unlock');
  if (unlockBtn) unlockBtn.addEventListener('click', () => { if (unlockNextPerk()) { Club.save(); renderPhiloModal(); renderHub(); } });
}
document.getElementById('hub-philo')?.addEventListener('click', openPhilo);
document.getElementById('philo-close')?.addEventListener('click', () => closeModal(philoOverlay));
philoOverlay?.addEventListener('click', (e) => { if (e.target === philoOverlay) closeModal(philoOverlay); });

// 전술 깊이 HUD — 모멘텀·피로 게이지 + 적응(읽힘) 경고.
let renderedSituationActionKey = '';
function updateTacticalHud(s) {
  const mf = document.getElementById('momentum-fill');
  if (mf) { const v = s.momentum ?? 50; mf.style.width = v + '%'; mf.classList.toggle('high', v >= 80); }
  const ff = document.getElementById('fatigue-fill');
  if (ff) { const v = s.fatigue ?? 0; ff.style.width = v + '%'; ff.classList.toggle('high', v >= 65); }
  const aw = document.getElementById('adapt-warn');
  if (aw) {
    if (s.adaptRead) { aw.hidden = false; aw.textContent = `⚠ ${ACTION_KO[s.adaptRead] ?? s.adaptRead} 읽힘 — 위험↑`; }
    else aw.hidden = true;
  }
  const situationEl = document.getElementById('match-situation');
  const situation = s.matchDecision || s.situations?.active?.at(-1);
  if (situationEl) {
    situationEl.hidden = !situation;
    if (situation) {
      situationEl.dataset.kind = situation.id;
      document.getElementById('situation-title').textContent = situation.title;
      document.getElementById('situation-detail').textContent = situation.detail;
      const actions = document.getElementById('situation-actions');
      if (actions) {
        const key = s.matchDecision
          ? `${s.matchDecision.id}:${s.matchDecision.choices.map((choice) => choice.id).join('|')}`
          : '';
        if (key !== renderedSituationActionKey) {
          renderedSituationActionKey = key;
          actions.innerHTML = (s.matchDecision?.choices || []).map((choice) =>
            `<button type="button" data-situation-choice="${choice.id}" title="${choice.desc}">${choice.label}</button>`
          ).join('');
          for (const btn of actions.querySelectorAll('button')) {
            btn.addEventListener('click', () => {
              const result = engine.chooseSituationOption(btn.dataset.situationChoice);
              if (result.ok) {
                renderedSituationActionKey = '';
                renderLog(engine);
                updateTacticalHud(engine.state);
              }
            });
          }
        }
      }
    } else {
      delete situationEl.dataset.kind;
      const actions = document.getElementById('situation-actions');
      if (actions) actions.innerHTML = '';
      renderedSituationActionKey = '';
    }
  }
}

// ─── render loop ─────────────────────────────────────────────────────────────
let lastTs = performance.now();
let lastWindowKey = null;
// 피치를 가리는 풀스크린 오버레이가 떠 있으면 매치는 상호작용 불가 — 그동안
// engine.update + 전체 렌더 + 프레임당 프리뷰 계산을 건너뛴다(배터리/CPU 절약).
const PITCH_COVER_SEL = '#title-overlay.visible, #outcome-overlay.visible, #select-overlay.visible, #tactics-overlay.visible, #hub-overlay.visible, #career-result.visible, #event-overlay.visible, #tutorial-overlay.visible, #philo-overlay.visible';
function renderPaused() {
  return document.hidden || !!document.querySelector(PITCH_COVER_SEL);
}
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(50, ts - lastTs);
  lastTs = ts;
  // 오버레이가 피치를 덮는 동안은 무거운 작업을 멈춘다(루프는 살아있어 닫히면 자동 재개).
  if (renderPaused()) return;
  engine.update(dt);

  const s = engine.state;
  const ringLive = s.status === 'live' && !engine.busy;
  const shotZoneNow = engine.shotZoneNow();
  const shotPreview = engine.previewShot();   // { zone, xg } or null

  // Overlay computations for armed actions (computed each frame; cheap per call).
  let passOptions = null;
  let runDestinations = null;
  if (s.status === 'live') {
    const h = engine.holder();
    if (h && selectedAction === 'to_feet') {
      // Colored rings on each teammate — green/yellow/red by pass risk.
      passOptions = s.players
        .filter(m => m.side === 'us' && m.id !== h.id && m.role !== 'GK')
        .map(m => {
          const pv = engine.preview('to_feet', m.id);
          if (!pv || pv.lane.status === 'offside') return null;
          return { targetId: m.id, risk: pv.lane.risk };
        })
        .filter(Boolean);
    } else if (h && selectedAction === 'run_order') {
      // Orange arrows + destination circles for every potential runner.
      runDestinations = s.players
        .filter(m => m.side === 'us' && m.id !== h.id && m.role !== 'GK')
        .map(m => {
          const pv = engine.preview('run_order', m.id);
          if (!pv?.zone) return null;
          return { targetId: m.id, from: { x: m.rx ?? m.x, y: m.ry ?? m.y }, zone: pv.zone };
        })
        .filter(Boolean);
    }
  }

  render({
    players: s.players,
    holderId: s.holderId,
    holder: engine.holder(),
    ball: engine.ballPos(),
    usColor: Club.club.clubColor,   // 우리 팀 킷 = 클럽 컬러
    rewardWindow: chosenDifficulty === 'mid' ? engine.rewardWindowVisible() : null, // 쉬움에서만 '열린 공간' 표시(학습 보조)
    superiorityZones: toggles.superiority ? engine.superiorityZones() : null,
    shotZone: shotZoneNow,
    shotXg: shotPreview?.xg ?? null,
    pressureExpr: engine.pressureExpression(),
    phase: s.phase,
    cue: s.cue,
    cueTone: s.cueTone,
    hover,
    keyboardTargetId: kbTargetId,
    passOptions,
    runDestinations,
    // Input is single-surface (UI 개편): desktop = in-board ring only (the
    // bottom bar buttons are display:none >900px), mobile = bottom bar only.
    // 900 matches the CSS breakpoint so the two never show together.
    actionRing: ringLive && window.innerWidth > 900
      ? actionButtons
        // U8: guide-stage locks apply to the ring too, not just the bar.
        .filter((b) => RING_LABELS[b.dataset.action] && !b.classList.contains('guide-locked'))
        .map((b) => ({
          id: b.dataset.action,
          // Show xG% on the shoot pill so the player knows the chance before committing.
          label: b.dataset.action === 'shoot' && shotPreview
            ? `슈팅 ${Math.round(shotPreview.xg * 100)}%`
            : RING_LABELS[b.dataset.action],
          enabled: !b.disabled,
          armed: b.classList.contains('armed'),
          hover: ringHover === b.dataset.action,
          // U3: the shoot pill only burns orange in a GOOD zone.
          good: b.dataset.action === 'shoot' ? !!shotZoneNow && shotZoneNow.baseXg >= 0.24 : true,
        }))
      : null,
  }, dt);

  renderHudState(engine);
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
    if (kind === 'goal') sfx.goal();
    else if (kind === 'saved' || kind === 'off' || kind === 'blocked') sfx.near();
    else if (kind === 'collapsed') sfx.collapse();
    else sfx.sting();
    recordAttempt(engine);
    renderLog(engine);
    if (careerActive) settleCareerMatch();
    else showOutcome(engine, newAttempt, nextCell);
  }
  // (재스케줄은 loop() 진입부에서 처리 — 여기서 다시 호출하면 프레임당 이중 예약됨)
}

// (resize 리스너는 initRenderer가 등록 — 중복 바인딩 제거)
requestAnimationFrame(loop);

// Console test hook for headless playtesting.
window.__game = {
  get engine() { return engine; },
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
