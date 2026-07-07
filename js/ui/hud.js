// DOM-side HUD: scenario panels, tactical log, outcome card, and the
// Tactical Archive (localStorage). The archive is the "leaderboard"
// replacement — a history of setups and outcomes, no numbers, no grades.

import { openModal, closeModal } from './modal.js';
import { prefersReducedMotion } from '../util/motion.js';
import { loc, t, getLang } from '../career/i18n.js';
import { bestObjectiveText } from '../util/board-read-i18n.js';

const ARCHIVE_KEY = 'beat-the-block:archive:v2';

export function bindScenarioPanels(scenario) {
  setText('scn-title', loc(scenario.title));
  setText('scn-our', loc(scenario.ourShapeName));
  setText('scn-opp', loc(scenario.oppShapeName));
  setText('scn-scheme', scenario.scheme);
  setText('scn-intensity', scenario.intensity.toUpperCase());
  setText('scn-compact', scenario.compactness.toUpperCase());
  setText('scn-target', loc(scenario.targetShot));
  setText('rc-target', loc(scenario.targetShot));   // 읽기 칩(피치 위) 동기화
  setText('scn-briefing', loc(scenario.briefing));
  setText('scn-opp-plan', loc(scenario.oppPlan) ?? '—');
  document.title = `${t('app.title')} · ${scenario.cell}`;
  const sel = document.getElementById('scenario-selector');
  if (sel) sel.value = scenario.cell;
}

export function renderHudState(engine, boardRead = null) {
  const s = engine.state;
  setText('phase-chip', s.phase);
  const chip = document.getElementById('phase-chip');
  if (chip) chip.dataset.phase = s.phase;
  setText('turn-count', String(s.turn));
  const objectives = {
    BUILDUP: t('obj.buildup'),
    PROGRESSION: t('obj.progression'),
    FINAL_THIRD: t('obj.finalThird'),
    PRESSING: t('obj.pressing'),
    SHOT: t('obj.shot'),
  };
  // 다음 추천 행동 — 단일 CTA. 상황 > 좋은 슛 > 압박 위험 > 국면 순으로 하나만 강하게 민다.
  let objective = objectives[s.phase] ?? t('obj.default');
  const decisionNow = s.matchDecision;
  const zoneNow = engine.shotZoneNow?.();
  const pressLvl = engine.pressureExpression?.().level ?? 0;
  if (decisionNow) objective = t('obj.decision').replace('{title}', decisionNow.title);
  else if (zoneNow && zoneNow.baseXg >= 0.24) objective = t('obj.shootNow');
  else if (boardRead?.best && boardRead.reset && boardRead.best.risk >= 0.35) {
    // 전진 제안이 위험(≥35%)하고 안전 리사이클이 있으면 — 강행 대신 볼 지켜 다시
    // 시작하는 탈출구를 표면화. "읽히면 그냥 잃는다"의 해소: 리셋 옵션을 보여준다.
    objective = t('obj.reset').replace('{label}', boardRead.reset.target?.label ?? '');
  } else if (boardRead?.best) objective = bestObjectiveText(boardRead.best);
  else if (pressLvl >= 0.78) objective = t('obj.pressRisk');
  setText('objective-text', objective);
  const info = engine.pressInfo?.();
  if (info) {
    const oppText = info.pending ? t('hud.reading') : (info.labelKo ?? t('dr.oppStateDefault'));
    const oppColor = info.pending ? 'var(--accent)' : info.labelKo ? 'var(--warn)' : '';
    setText('opp-adapt', oppText);
    const el = document.getElementById('opp-adapt');
    if (el) el.style.color = oppColor;
    // 읽기 칩(피치 위) 상대 상태 동기화
    const rc = document.getElementById('rc-opp');
    if (rc) { rc.textContent = oppText; rc.style.color = oppColor || 'var(--text)'; }
  }
  // §9 / master_plan "하지 않을 것": no pressure NUMBER in the HUD. The bar
  // breathes; the exact value stays internal. (aria keeps it for screen readers.)
  const fill = document.getElementById('pressure-fill');
  if (fill) {
    const level = engine.pressureExpression().level;
    const percent = Math.round(level * 100);
    fill.style.width = `${percent}%`;
    fill.className = level >= 0.78 ? 'danger' : level >= 0.55 ? 'warn' : '';
    // 접근성: 스크린리더가 맥락 있는 값을 읽도록 valuetext 제공(숫자만 X).
    const word = level >= 0.78 ? t('hud.pressDanger') : level >= 0.55 ? t('hud.pressCaution') : t('hud.pressSafe');
    const gauge = document.getElementById('pressure-gauge');
    if (gauge) {
      gauge.setAttribute('aria-valuenow', String(percent));
      gauge.setAttribute('aria-valuetext', t('hud.pressVT').replace('{percent}', String(percent)).replace('{word}', word));
    }
  }
}

export function renderLog(engine) {
  const el = document.getElementById('tactical-log');
  if (!el) return;
  const items = engine.state.log.slice(-7).reverse();
  el.innerHTML = items.map((it, i) =>
    `<div class="log-item ${it.tone}${i === 0 ? ' log-new' : ''}"><span class="t">${String(it.turn).padStart(2, '0')}</span>${escapeHtml(it.text)}</div>`
  ).join('') || `<div class="log-empty">${t('dr.logEmpty')}</div>`;
  // Auto-scroll to show the latest entry.
  el.scrollTop = 0;
  // Brief highlight on newest entry that fades out.
  const newest = el.querySelector('.log-new');
  if (newest) {
    newest.style.transition = 'background-color 0.8s ease-out';
    newest.style.backgroundColor = 'rgba(77, 139, 255, 0.18)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        newest.style.backgroundColor = 'transparent';
      });
    });
  }
}

// ─── outcome card ────────────────────────────────────────────────────────────

export function showOutcome(engine, onRetry, onNextCell, { nextLabel = null, onReplay = null, reportMode = 'full' } = {}) {
  const o = engine.state.outcome;
  if (!o) return;
  const overlay = document.getElementById('outcome-overlay');
  if (!overlay) return;
  overlay.querySelector('.oc-headline').textContent = o.headline;
  overlay.querySelector('.oc-body').textContent = o.body;
  overlay.querySelector('.oc-facts').textContent = o.facts || '—';
  const report = overlay.querySelector('.oc-report');
  if (report) report.innerHTML = renderReport(o.report, reportMode);
  overlay.dataset.tone = o.tone;
  const retryBtn = overlay.querySelector('.oc-retry');
  openModal(overlay, retryBtn);
  // 재도전이 거부될 수 있으므(커리어 재도전 소진 → 토스트) 모달을 먼저 닫지 않는다 —
  // 진행되면 newAttempt의 hideOutcome이 닫고, 거부되면 카드가 남아 다른 선택을 유도.
  retryBtn.onclick = () => { if (onRetry() === false) return; hideOutcome(); };
  // U6: the next-moment door is always open — a near miss is exactly when a
  // player wants to try a different tactical problem.
  const nextBtn = overlay.querySelector('.oc-next');
  nextBtn.style.display = '';
  // 커리어는 "결과 정산 →", 자유 플레이는 기본 라벨로 매번 복원(잔존 방지).
  nextBtn.textContent = nextLabel ?? t('oc.next');
  nextBtn.onclick = () => { closeModal(overlay, false); onNextCell(); };
  // 골 리플레이(C3) — 골일 때만 노출. 클릭 시 카드를 닫고 재생, 끝나면 호출부가
  // 카드를 다시 연다(onReplay 안에서 처리).
  const replayBtn = overlay.querySelector('.oc-replay');
  if (replayBtn) {
    const canReplay = o.tone === 'goal' && typeof onReplay === 'function';
    replayBtn.hidden = !canReplay;
    replayBtn.onclick = canReplay ? () => { closeModal(overlay, false); onReplay(); } : null;
  }
  // 골 시 간단한 컨페티 효과.
  if (o.tone === 'goal') spawnConfetti(overlay);
}

export function renderTacticalReport(report, mode = 'full') {
  return renderReport(report, mode);
}

// mode(정보 다이어트 2026-07): 'full'=코치 한 줄+상세, 'coach'=코치 한 줄만(커리어
// 결말 카드 — 재도전/정산 판단용), 'details'=상세만(커리어 결과 카드 — 코치 줄은
// 결말 카드가 이미 말했다). 결말→결과가 연속으로 같은 내용을 두 번 보이던 것 정리.
function renderReport(report, mode = 'full') {
  if (!report) return '';
  const rows = [
    [t('trh.worked'), report.worked],
    [t('trh.read'), report.read],
    [t('trh.decisive'), report.decisive],
  ];
  const body = rows.map(([k, v]) => `<div class="tr-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v || '—')}</b></div>`).join('');
  const sup = report.superiority ? `<div class="tr-sup">${escapeHtml(t('trh.superiority'))} · <b>${escapeHtml(report.superiority)}</b></div>` : '';
  const trans = report.transition ? `<div class="tr-sup tr-trans">${escapeHtml(t('trh.transition'))} · <b>${escapeHtml(report.transition)}</b></div>` : '';
  // "그래서 다음엔?" — 가장 먼저 보이는 1순위 학습 CTA (P2).
  const next = (mode !== 'details' && report.next)
    ? `<div class="tr-next"><span class="tr-next-k">${escapeHtml(t('trh.next'))}</span><strong>${escapeHtml(report.next)}</strong></div>`
    : '';
  // 상세 분석(지표·우위·전환·리포트행)은 접어서 온디맨드 — 결과 카드를 한눈에 들어오게.
  const details = mode === 'coach' ? '' : renderMetrics(report.metrics) + sup + trans + body;
  const detailsBlock = details
    ? `<details class="tr-details"><summary>${escapeHtml(t('rep.details'))}</summary><div class="tr-details-body">${details}</div></details>`
    : '';
  return next + detailsBlock;
}

// 실제 축구 지표로 결과를 설명 (E2). 데이터는 report.js가 facts·xG로 산출.
function renderMetrics(m) {
  if (!m) return '';
  const cell = (label, value, title) =>
    `<span class="tm-cell" title="${escapeHtml(title)}"><i>${escapeHtml(label)}</i><b>${escapeHtml(value)}</b></span>`;
  return `<div class="tr-metrics">`
    + cell(t('trh.packing'), String(m.packing), t('trh.packingTip'))
    + cell('xT', String(m.xt), t('trh.xtTip'))
    + cell('xG', m.xg != null ? m.xg + '%' : '—', t('trh.xgTip'))
    + cell(t('trh.dominance'), String(m.dominance), t('trh.dominanceTip'))
    + `</div>`;
}

function spawnConfetti(container) {
  if (prefersReducedMotion()) return;   // 접근성: 모션 최소화 시 색종이 생략
  const CONFETTI_COLORS = ['#4d8bff', '#ffc24b', '#ffffff', '#9fc0ff', '#ffd28a'];
  const COUNT = 35;
  const confettiEls = [];
  // Inject keyframes once if not already present.
  if (!document.getElementById('confetti-style')) {
    const style = document.createElement('style');
    style.id = 'confetti-style';
    style.textContent = `
      @keyframes confetti-burst {
        0% { transform: translate(0,0) rotate(0deg) scale(1); opacity: 1; }
        100% { transform: translate(var(--cx), var(--cy)) rotate(var(--cr)) scale(0.3); opacity: 0; }
      }
      .confetti-dot {
        position: absolute; top: 50%; left: 50%; pointer-events: none;
        width: 8px; height: 8px; border-radius: 2px;
        animation: confetti-burst 2.2s cubic-bezier(.15,.8,.35,1) forwards;
      }
    `;
    document.head.appendChild(style);
  }
  for (let i = 0; i < COUNT; i++) {
    const dot = document.createElement('div');
    dot.className = 'confetti-dot';
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 180;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 40; // bias upward
    dot.style.setProperty('--cx', dx + 'px');
    dot.style.setProperty('--cy', dy + 'px');
    dot.style.setProperty('--cr', (Math.random() * 720 - 360) + 'deg');
    dot.style.backgroundColor = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    dot.style.width = (5 + Math.random() * 6) + 'px';
    dot.style.height = (4 + Math.random() * 5) + 'px';
    dot.style.animationDelay = (Math.random() * 0.15) + 's';
    container.appendChild(dot);
    confettiEls.push(dot);
  }
  // Clean up after animation completes.
  setTimeout(() => {
    for (const el of confettiEls) el.remove();
  }, 2500);
}

export function hideOutcome() {
  closeModal(document.getElementById('outcome-overlay'), false);
}

// ─── tactical archive ────────────────────────────────────────────────────────

export function recordAttempt(engine) {
  const s = engine.state;
  if (!s.outcome) return;
  const entry = {
    cell: s.scenario.cell,
    at: new Date().toISOString(),
    seed: s.seed,
    turns: s.turn,
    kind: s.outcome.kind,
    tone: s.outcome.tone,
    headline: s.outcome.headline,
    facts: s.outcome.facts,
  };
  const list = readArchive();
  list.unshift(entry);
  try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(0, 40))); } catch { /* private mode */ }
  renderArchive();
}

function readArchive() {
  try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY)) || []; } catch { return []; }
}

export function renderArchive(filter = null) {
  const el = document.getElementById('archive-list');
  if (!el) return;
  const sel = document.getElementById('archive-filter');
  const f = filter ?? (sel?.value || 'ALL');
  const all = readArchive();
  const list = f === 'ALL' ? all : all.filter((e) => e.cell === f);
  setText('archive-count', `${list.length}`);
  if (!list.length) {
    el.innerHTML = `<div class="archive-empty">${t('archive.empty')}</div>`;
    return;
  }
  el.innerHTML = list.slice(0, 8).map((e) => `
    <div class="archive-item ${e.tone}">
      <strong>[${e.cell}] ${escapeHtml(e.headline)}</strong>
      <span>${escapeHtml(e.facts || '')}</span>
      <span class="meta">${t('archive.turnsN').replace('{n}', e.turns)} · ${new Date(e.at).toLocaleString(getLang() === 'ko' ? 'ko-KR' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  `).join('');
}

export function initArchiveControls() {
  document.getElementById('archive-filter')?.addEventListener('change', () => renderArchive());
  renderArchive();
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function escapeHtml(v) {
  return String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
