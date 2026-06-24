// DOM-side HUD: scenario panels, tactical log, outcome card, and the
// Tactical Archive (localStorage). The archive is the "leaderboard"
// replacement — a history of setups and outcomes, no numbers, no grades.

import { openModal, closeModal } from './modal.js';

const ARCHIVE_KEY = 'beat-the-block:archive:v2';

export function bindScenarioPanels(scenario) {
  setText('scn-title', scenario.title);
  setText('scn-our', scenario.ourShapeName);
  setText('scn-opp', scenario.oppShapeName);
  setText('scn-scheme', scenario.scheme);
  setText('scn-intensity', scenario.intensity.toUpperCase());
  setText('scn-compact', scenario.compactness.toUpperCase());
  setText('scn-target', scenario.targetShot);
  setText('scn-briefing', scenario.briefing);
  setText('scn-opp-plan', scenario.oppPlan ?? '—');
  document.title = `빌드업 클럽 · ${scenario.cell}`;
  const sel = document.getElementById('scenario-selector');
  if (sel) sel.value = scenario.cell;
}

export function renderHudState(engine) {
  const s = engine.state;
  setText('phase-chip', s.phase);
  const chip = document.getElementById('phase-chip');
  if (chip) chip.dataset.phase = s.phase;
  setText('turn-count', String(s.turn));
  const objectives = {
    BUILDUP: '압박을 끌어낸 뒤 첫 라인을 통과하세요.',
    PROGRESSION: '열린 전진 레인을 찾아 최종 3선으로 진입하세요.',
    FINAL_THIRD: '수비가 닫히기 전에 슛 존을 만드세요.',
    SHOT: '열린 슛 존에서 공격을 마무리하세요.',
  };
  setText('objective-text', objectives[s.phase] ?? '블록의 빈 공간을 찾아 공격을 이어가세요.');
  const info = engine.pressInfo?.();
  if (info) {
    setText('opp-adapt', info.pending ? '읽는 중…' : (info.labelKo ?? '기본 압박'));
    const el = document.getElementById('opp-adapt');
    if (el) el.style.color = info.pending ? 'var(--accent)' : info.labelKo ? 'var(--warn)' : '';
  }
  // §9 / master_plan "하지 않을 것": no pressure NUMBER in the HUD. The bar
  // breathes; the exact value stays internal. (aria keeps it for screen readers.)
  const fill = document.getElementById('pressure-fill');
  if (fill) {
    const level = engine.pressureExpression().level;
    const percent = Math.round(level * 100);
    fill.style.width = `${percent}%`;
    fill.className = level >= 0.78 ? 'danger' : level >= 0.55 ? 'warn' : '';
    document.getElementById('pressure-gauge')?.setAttribute('aria-valuenow', String(percent));
  }
}

export function renderLog(engine) {
  const el = document.getElementById('tactical-log');
  if (!el) return;
  const items = engine.state.log.slice(-7).reverse();
  el.innerHTML = items.map((it, i) =>
    `<div class="log-item ${it.tone}${i === 0 ? ' log-new' : ''}"><span class="t">${String(it.turn).padStart(2, '0')}</span>${escapeHtml(it.text)}</div>`
  ).join('') || '<div class="log-empty">아직 기록이 없습니다</div>';
  // Auto-scroll to show the latest entry.
  el.scrollTop = 0;
  // Brief highlight on newest entry that fades out.
  const newest = el.querySelector('.log-new');
  if (newest) {
    newest.style.transition = 'background-color 0.8s ease-out';
    newest.style.backgroundColor = 'rgba(93, 214, 197, 0.18)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        newest.style.backgroundColor = 'transparent';
      });
    });
  }
}

// ─── outcome card ────────────────────────────────────────────────────────────

export function showOutcome(engine, onRetry, onNextCell) {
  const o = engine.state.outcome;
  if (!o) return;
  const overlay = document.getElementById('outcome-overlay');
  if (!overlay) return;
  overlay.querySelector('.oc-headline').textContent = o.headline;
  overlay.querySelector('.oc-body').textContent = o.body;
  overlay.querySelector('.oc-facts').textContent = o.facts || '—';
  const report = overlay.querySelector('.oc-report');
  if (report) report.innerHTML = renderReport(o.report);
  overlay.dataset.tone = o.tone;
  const retryBtn = overlay.querySelector('.oc-retry');
  openModal(overlay, retryBtn);
  retryBtn.onclick = () => { closeModal(overlay, false); onRetry(); };
  // U6: the next-moment door is always open — a near miss is exactly when a
  // player wants to try a different tactical problem.
  const nextBtn = overlay.querySelector('.oc-next');
  nextBtn.style.display = '';
  nextBtn.onclick = () => { closeModal(overlay, false); onNextCell(); };
  // 골 시 간단한 컨페티 효과.
  if (o.tone === 'goal') spawnConfetti(overlay);
}

export function renderTacticalReport(report) {
  return renderReport(report);
}

function renderReport(report) {
  if (!report) return '';
  const rows = [
    ['잘 먹힌 전술', report.worked],
    ['상대가 읽은 패턴', report.read],
    ['결정적 장면', report.decisive],
    ['다음 경기 추천', report.next],
  ];
  const body = rows.map(([k, v]) => `<div class="tr-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v || '—')}</b></div>`).join('');
  return renderMetrics(report.metrics) + body;
}

// 실제 축구 지표로 결과를 설명 (E2). 데이터는 report.js가 facts·xG로 산출.
function renderMetrics(m) {
  if (!m) return '';
  const cell = (label, value, title) =>
    `<span class="tm-cell" title="${escapeHtml(title)}"><i>${escapeHtml(label)}</i><b>${escapeHtml(value)}</b></span>`;
  return `<div class="tr-metrics">`
    + cell('패킹', String(m.packing), '라인 브레이킹 — 패스·드리블로 제친 상대 라인 수')
    + cell('xT', String(m.xt), '기대 위협 — 전진 행동이 만든 위협 가치 지수(0~100)')
    + cell('xG', m.xg != null ? m.xg + '%' : '—', '기대 득점 — 마무리 찬스의 질')
    + cell('지배력', String(m.dominance), '빌드업 지배력 — 유인·전진·상황 해결 종합(0~100)')
    + `</div>`;
}

function spawnConfetti(container) {
  const CONFETTI_COLORS = ['#5dd6c5', '#f5a623', '#ffffff', '#8df0e2', '#ffd28a'];
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
    el.innerHTML = '<div class="archive-empty">아직 기록이 없습니다 — 첫 공격을 시도해 보세요.</div>';
    return;
  }
  el.innerHTML = list.slice(0, 8).map((e) => `
    <div class="archive-item ${e.tone}">
      <strong>[${e.cell}] ${escapeHtml(e.headline)}</strong>
      <span>${escapeHtml(e.facts || '')}</span>
      <span class="meta">${e.turns}턴 · ${new Date(e.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
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
