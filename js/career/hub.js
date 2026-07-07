// 클럽 허브 UI — 스쿼드 강화 상점, 승격 게이지, 다음 상대/예상 배당, 프레스티지.
// main.js가 onPlay 콜백으로 전술 매치를 시작한다.

import {
  club, division, DIVISIONS, POSITIONS, teamOVR, attackOVR, defenseOVR,
  upgradeCost, buyUpgrade, stadiumCost, buyStadium, oppBaseOVR,
  setPieceCoachCost, buySetPieceCoach, setRole,
  prestige, prestigeGain, boostActive, boostRemainSec, startBoost, formatNum, save,
} from './club.js';
import { ROLES } from '../data/roles.js';
import { matchSetup, upgradePreview } from './mods.js';
import { opponentName, scenarioForMatchday, opponentDisposition, rivalName, isRivalMatchday } from './season.js';
import { t, loc, getLang, toggleLang } from './i18n.js';
import { currentMission, effectsSummary } from './events.js';
import { currentPhilosophy } from './philosophy.js';
import { identitySummary } from './identity.js';
import { activeSeasonGoals } from './season-goals.js';
import { identityLevel } from './identity.js';


const $ = (id) => document.getElementById(id);
let handlers = { onPlay: () => {}, onLang: () => {} };

const DIV_NAMES = { 5: '5부 리그', 4: '4부 리그', 3: '3부 리그', 2: '2부 리그', 1: '1부 리그' };
const DIV_NAMES_EN = { 5: 'Division 5', 4: 'Division 4', 3: 'Division 3', 2: 'Division 2', 1: 'Division 1' };
function divName() {
  const tier = division().tier;
  return (getLang() === 'ko' ? DIV_NAMES : DIV_NAMES_EN)[tier];
}

export function clubLabel() {
  return club.clubName || (getLang() === 'ko' ? '내 클럽' : 'My Club');
}

export function initHub(opts) {
  handlers = { ...handlers, ...opts };
  $('hub-play')?.addEventListener('click', () => handlers.onPlay());
  $('hub-lang')?.addEventListener('click', () => { toggleLang(); handlers.onLang?.(); renderHub(); });
  $('hub-stadium')?.addEventListener('click', () => { if (buyStadium()) { pulse($('hub-stadium')); renderHub(); } });
  $('hub-setpiece')?.addEventListener('click', () => { if (buySetPieceCoach()) { pulse($('hub-setpiece')); renderHub(); } });
  $('hub-boost')?.addEventListener('click', () => { if (!boostActive()) { startBoost(); save(); renderHub(); } });
  $('hub-prestige')?.addEventListener('click', () => {
    if (!club.canPrestige) return;
    if (confirm(t('prestige.confirm'))) { prestige(); renderHub(); }
  });
  $('hub-name')?.addEventListener('click', () => {
    const v = prompt(getLang() === 'ko' ? '클럽 이름' : 'Club name', clubLabel());
    if (v != null) { club.clubName = v.slice(0, 24); save(); renderHub(); }
  });
  // 탭 전환
  for (const tab of document.querySelectorAll('.hub-tab')) {
    tab.addEventListener('click', () => switchHubTab(tab.dataset.tab));
  }
}

// ── 단계적 해금 ────────────────────────────────────────────────
// 시스템을 한 번에 쏟지 않고 진행도에 따라 하나씩 연다(순차 공개).
// 가시성만 게이팅 — 엔진/저장 로직은 건드리지 않는다.
const HUB_TABS = ['match', 'squad', 'club'];

function hubUnlocks() {
  const mp = club.record.w + club.record.d + club.record.l;
  const tier = division().tier;
  const anyXp = Object.values(club.identityXp || {}).some((v) => v > 0);
  const identity = mp >= 2 || anyXp;
  const philosophy = mp >= 3 || (club.philoPoints || 0) > 0 || tier <= 4 || !!currentPhilosophy();
  const seasonGoals = tier <= 4 || mp >= 6;
  const prestige = !!club.canPrestige;
  return { mp, tier, identity, philosophy, seasonGoals, prestige, clubTab: identity || philosophy || seasonGoals || prestige };
}

function switchHubTab(name) {
  for (const t of HUB_TABS) {
    const btn = $('tab-' + t);
    const panel = $('hub-panel-' + t);
    const on = t === name;
    if (btn) { btn.classList.toggle('on', on); btn.setAttribute('aria-selected', on ? 'true' : 'false'); }
    if (panel) { panel.hidden = !on; panel.classList.toggle('on', on); }
  }
  if (name === 'club') markClubSeen();
}

function markClubSeen() {
  const u = hubUnlocks();
  club.hubSeen = { identity: u.identity, philosophy: u.philosophy, seasonGoals: u.seasonGoals, prestige: u.prestige };
  save();
  const dot = $('tab-club-dot'); if (dot) dot.hidden = true;
}

// 해금 상태를 화면에 반영 — renderHub 끝에서 호출(콘텐츠 채운 뒤 가시성 결정).
function applyUnlocks() {
  const u = hubUnlocks();
  const clubBtn = $('tab-club'); if (clubBtn) clubBtn.hidden = !u.clubTab;
  setHidden('hub-philo', !u.philosophy);
  setHidden('hub-identity', !u.identity);
  setHidden('hub-season-goals', !u.seasonGoals);
  // 새 해금 알림 점
  const seen = club.hubSeen || {};
  const fresh = (u.identity && !seen.identity) || (u.philosophy && !seen.philosophy)
             || (u.seasonGoals && !seen.seasonGoals) || (u.prestige && !seen.prestige);
  const dot = $('tab-club-dot'); if (dot) dot.hidden = !(u.clubTab && fresh);
  // 다음 해금 한 줄 안내 (클럽 탭이 열렸지만 철학은 아직일 때)
  const lk = $('hub-locked');
  if (lk) {
    if (u.clubTab && !u.philosophy) {
      lk.hidden = false;
      lk.innerHTML = t('hub.lockedPhilo');
    } else lk.hidden = true;
  }
  // 클럽 탭이 잠겼는데 활성 상태면 경기 탭으로 되돌림
  const clubPanel = $('hub-panel-club');
  if (!u.clubTab && clubPanel && !clubPanel.hidden) switchHubTab('match');
}

function pulse(el) {
  if (!el) return;
  el.style.transform = 'scale(0.96)';
  setTimeout(() => { el.style.transform = ''; }, 110);
}

// 선수 롤 선택 UI (E8) — 중원/전방 롤 버튼 + 설명. 무료 토글, 즉시 저장.
function renderRoles() {
  const el = $('hub-roles');
  if (!el) return;
  const LINES = [['mf', 'hub.line.mid'], ['fw', 'hub.line.front']];
  el.innerHTML = LINES.map(([line, labelKey]) => {
    const cur = club.roles?.[line] || 'none';
    const desc = loc(ROLES[line][cur]?.desc) || '';
    const btns = Object.values(ROLES[line]).map((r) =>
      `<button type="button" class="role-btn ${r.key === cur ? 'active' : ''}" data-line="${line}" data-role="${r.key}">${loc(r.label)}</button>`).join('');
    return `<div class="hub-role-line"><span class="rl-k">${t('hub.roleLine').replace('{x}', t(labelKey))}</span><div class="hub-role-btns">${btns}</div><div class="hub-role-desc">${desc}</div></div>`;
  }).join('');
  for (const btn of el.querySelectorAll('.role-btn')) {
    btn.addEventListener('click', () => { setRole(btn.dataset.line, btn.dataset.role); renderHub(); });
  }
}

export function renderHub() {
  // 헤더
  setText('hub-name', clubLabel());
  setText('hub-div', divName());
  setText('hub-record', t('hub.recordFmt').replace('{w}', club.record.w).replace('{d}', club.record.d).replace('{l}', club.record.l));
  setText('hub-cash', formatNum(club.cash));
  setText('hub-fans', formatNum(club.fans));
  setText('hub-ovr', Math.round(teamOVR()));
  setText('hub-atk', Math.round(attackOVR()));
  setText('hub-def', Math.round(defenseOVR()));
  const badge = $('hub-badge');
  if (badge) {
    // CSS gradient badge with club's first letter instead of emoji.
    const letter = (club.clubName || '').charAt(0) || '⚽';
    const stars = club.champions > 0 ? '★'.repeat(Math.min(5, club.champions)) : '';
    badge.style.background = `linear-gradient(135deg, ${club.clubColor || '#5dd6c5'}, ${club.clubColor ? darkenHex(club.clubColor, 0.4) : '#2a8a7a'})`;
    badge.textContent = stars || letter;
    badge.style.fontWeight = stars ? '400' : '800';
    badge.style.letterSpacing = stars ? '1px' : '0';
  }
  setText('hub-lang', t('hub.lang'));

  // 승격 게이지
  const div = division();
  const pct = Math.min(100, (club.points / div.promotePts) * 100);
  const fill = $('hub-promote-fill');
  if (fill) fill.style.width = pct + '%';
  setText('hub-promote-label', club.isChampion
    ? t('res.champion')
    : `${t('hub.points')} ${club.points}/${div.promotePts} · ${t('hub.promote')} ${Math.max(0, div.promotePts - club.points)}`);

  renderCareerVariety();
  renderIdentity();

  renderSquad();

  // 스타디움 / 부스트 / 프레스티지
  setHtml('hub-stadium', `<span class="cb-k">${t('hub.stadium')} · Lv ${club.stadiumLvl}</span><span class="cb-v">${formatNum(stadiumCost())}</span>`);
  toggleAfford('hub-stadium', club.cash >= stadiumCost());
  // 세트피스 코치 (E5) — 자금 소모형, 최대 레벨에서 MAX 표시.
  const spCost = setPieceCoachCost();
  setHtml('hub-setpiece', `<span class="cb-k">${t('hub.setpieceCoach').replace('{n}', club.setPieceCoach)}</span><span class="cb-v">${spCost == null ? 'MAX' : formatNum(spCost)}</span>`);
  toggleAfford('hub-setpiece', spCost != null && club.cash >= spCost);
  renderRoles();
  const boostBtn = $('hub-boost');
  if (boostBtn) {
    boostBtn.innerHTML = boostActive()
      ? `<span class="cb-k">⚡ ${Math.ceil(boostRemainSec() / 60)}m</span><span class="cb-v">×2</span>`
      : `<span class="cb-k">⚡ ${t('hub.boost')}</span><span class="cb-v">FREE</span>`;
    boostBtn.classList.toggle('on', boostActive());
  }
  const pBtn = $('hub-prestige');
  if (pBtn) {
    pBtn.hidden = !club.canPrestige;
    pBtn.innerHTML = `<span class="cb-k">${t('hub.prestige')}</span><span class="cb-v">${t('hub.prestigeGain')}${prestigeGain()}</span>`;
  }
  // 클럽 철학(장기 분기) — main.js가 클릭 시 모달을 연다.
  const philoBtn = $('hub-philo');
  if (philoBtn) {
    const ph = currentPhilosophy();
    const pts = club.philoPoints || 0;
    philoBtn.innerHTML = `<span class="cb-k">${ph ? t('philo.label').replace('{x}', loc(ph.name)) : t('philo.pick')}</span><span class="cb-v">${pts}P</span>`;
    philoBtn.classList.toggle('on', !!ph);
    philoBtn.classList.toggle('alert', pts > 0);
  }

  renderNextMatch();
  applyUnlocks();
}

function renderIdentity() {
  const el = $('hub-identity');
  if (!el) return;
  // 표시 기준 = 선택한 정체성(club.philosophy) — 퍽·Lv4 게이트·액션 안정화와 일치.
  // 플레이 성향(XP 최고)이 선택과 다르면 보조로 안내. 미선택이면 성향을 제안.
  const chosen = currentPhilosophy();
  const dominant = identitySummary();
  if (chosen) {
    const xp = club.identityXp?.[chosen.id] ?? 0;
    const lv = identityLevel(xp);
    const tendency = (dominant.id !== chosen.id && dominant.value > 0) ? ` · ${t('hub.tendency').replace('{x}', loc(dominant.label))}` : '';
    el.style.setProperty('--idc', chosen.color);
    el.innerHTML = `
      <span class="hi-k">${t('hub.identity')}</span>
      <strong>${loc(chosen.name)}</strong>
      <span class="hi-desc">${loc(chosen.kicker)}</span>
      <span class="hi-xp">Lv ${lv} · ${Math.round(xp)} XP${tendency}</span>`;
  } else {
    const lv = identityLevel(dominant.value);
    el.style.setProperty('--idc', dominant.color);
    el.innerHTML = `
      <span class="hi-k">${t('hub.identityNone')}</span>
      <strong>${t('hub.tendencyStrong').replace('{x}', loc(dominant.label))}</strong>
      <span class="hi-desc">${t('hub.identityHint').replace('{x}', loc(dominant.desc))}</span>
      <span class="hi-xp">Lv ${lv} · ${Math.round(dominant.value)} XP</span>`;
  }
}

// 커리어 히스토리 차트 — 승점 흐름을 SVG polyline 으로 (roadmap 고도화).
// 데이터 2개 미만이면 숨김. points 가 0 이면 평탄한 선.
function renderCareerChart() {
  const el = $('hub-chart');
  if (!el) return;
  const hist = Array.isArray(club.careerHistory) ? club.careerHistory : [];
  if (hist.length < 2) { el.hidden = true; return; }
  el.hidden = false;
  const pts = hist.map((h) => h.points ?? 0);
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const range = max - min || 1;
  const n = pts.length;
  const coords = pts.map((v, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 30 - ((v - min) / range) * 26 - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastPts = pts[n - 1];
  const lastMd = hist[n - 1].matchday;
  el.innerHTML = `
    <div class="hub-chart-title">${t('hub.pointsTrend').replace('{n}', n)}</div>
    <svg viewBox="0 0 100 30" preserveAspectRatio="none">
      <polyline points="${coords}" fill="none" stroke="#5dd6c5" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <div style="font-size:10.5px;color:var(--text-muted);margin-top:3px">${t('hub.mdPoints').replace('{md}', lastMd).replace('{pts}', lastPts)}</div>`;
}

function renderCareerVariety() {
  const missionEl = $('hub-mission');
  const mission = currentMission();
  if (missionEl) {
    missionEl.hidden = !mission;
    missionEl.classList.toggle('done', !!mission?.done);
    if (mission) missionEl.innerHTML = `
      <span class="hm-icon">${mission.done ? '✓' : '🎯'}</span>
      <span><span class="hm-title">${loc(mission.title)}</span><br><span class="hm-desc">${loc(mission.desc)}</span></span>
      <span class="hm-reward">${mission.done ? t('hub.done') : '+' + formatNum(mission.reward)}</span>`;
  }
  // 시즌 목표 카드 — roadmap P3.
  const goalsEl = $('hub-season-goals');
  if (goalsEl) {
    goalsEl.innerHTML = activeSeasonGoals().map((g) => {
      const cur = Math.min(g.current(), g.target);
      const pct = g.target > 0 ? Math.min(100, (cur / g.target) * 100) : 0;
      return `
      <div class="sg-card ${g.done ? 'done' : ''}">
        <div class="sg-head">
          <span class="sg-title">${g.done ? '✓ ' : ''}${loc(g.title)}</span>
          <span class="sg-reward">${g.done ? t('hub.done') : '+' + formatNum(g.reward)}</span>
        </div>
        <div class="sg-desc">${loc(g.desc)}</div>
        <div class="sg-progress">
          <div class="sg-bar"><div class="sg-bar-fill" style="width:${pct}%"></div></div>
          <span class="sg-count">${cur}/${g.target}</span>
        </div>
      </div>`;
    }).join('');
  }
  const effectsEl = $('hub-effects');
  if (effectsEl) effectsEl.innerHTML = effectsSummary().map((effect) => `
    <span class="eff-chip chip-in ${effect.tone === 'bad' ? 'bad' : 'good'}">
      ${effect.tone === 'bad' ? '⚠' : '◆'} ${loc(effect.label)}
      ${effect.nextEffect ? `<span class="eff-next">${loc(effect.nextEffect)}</span>` : ''}
      ${effect.left == null ? '' : `<span class="eff-left">${t('unit.matchesLeft').replace('{n}', effect.left)}</span>`}
    </span>`).join('');
  renderCareerChart();
}

// Position-specific accent colors for squad card left borders.
const POS_ACCENT = {
  fw: 'var(--warn, #f5a623)',     // 공격수 — orange
  rw: 'var(--warn, #f5a623)',     // 윙어 — orange
  lw: 'var(--warn, #f5a623)',     // 윙어 — orange
  st: 'var(--warn, #f5a623)',     // 스트라이커 — orange
  mf: 'var(--accent, #5dd6c5)',   // 미드필더 — teal
  cm: 'var(--accent, #5dd6c5)',
  am: 'var(--accent, #5dd6c5)',
  dm: 'var(--accent, #5dd6c5)',
  df: '#5aa9f0',                  // 수비수 — blue
  cb: '#5aa9f0',
  rb: '#5aa9f0',
  lb: '#5aa9f0',
  fb: '#5aa9f0',
  gk: '#c8a0e8',                  // 골키퍼 — purple
};

function posAccentColor(key) {
  return POS_ACCENT[key] ?? 'var(--accent, #5dd6c5)';
}

function renderSquad() {
  const wrap = $('hub-squad');
  if (!wrap) return;
  wrap.innerHTML = POSITIONS.map((p) => {
    const lvl = club.levels[p.key];
    const cost = upgradeCost(p.key);
    const afford = club.cash >= cost;
    // 강화 효과 미리보기(순수): 다음 레벨 OVR·보정·승률 변화.
    const pv = upgradePreview(p.key);
    const isAtk = p.atk >= p.def;
    const statKo = isAtk ? t('hub.atk') : t('hub.def');
    const dShot = Math.round((pv.shot.to - pv.shot.from) * 100);
    const dPass = +(((pv.pass.to - pv.pass.from) * 100).toFixed(1));
    const dGk = Math.round((pv.gk.to - pv.gk.from) * 100);
    // 상세는 툴팁으로만 — 카드 표면엔 한 줄도 늘리지 않는다.
    const detail = `${t('pos.' + p.key)} Lv${lvl}→${lvl + 1} · `
      + `${t('hub.atk')} ${pv.atk.from}→${pv.atk.to}, ${t('hub.def')} ${pv.def.from}→${pv.def.to} · `
      + (isAtk ? `${t('hub.upgradeShot').replace('{shot}', dShot).replace('{pass}', dPass)} · ` : `${t('hub.upgradeGk').replace('{gk}', dGk)} · `)
      + `${t('match.win')} ${pv.win.from}%→${pv.win.to}%`;
    // 강화의 가치를 토큰 하나로: 승률이 오르면 승률, 아니면 스탯 증가분.
    const winDelta = pv.win.to - pv.win.from;
    const statDelta = isAtk ? (pv.atk.to - pv.atk.from) : (pv.def.to - pv.def.from);
    const delta = winDelta > 0 ? `${t('match.win')} +${winDelta}%` : `${statKo} +${statDelta}`;
    const accent = posAccentColor(p.key);
    return `
      <div class="sq-card" data-pos="${p.key}" style="border-left: 3px solid ${accent}">
        <div class="sq-top">
          <span class="sq-name">${t('pos.' + p.key)}</span>
          <span class="sq-lvl" style="color: ${accent}">Lv ${lvl}</span>
        </div>
        <div class="sq-bars">
          ${p.atk ? `<span class="sq-bar atk" title="ATK"><i style="width:${Math.min(100, lvl * p.atk * 4)}%"></i></span>` : ''}
          ${p.def ? `<span class="sq-bar def" title="DEF"><i style="width:${Math.min(100, lvl * p.def * 4)}%"></i></span>` : ''}
        </div>
        <button class="sq-buy ${afford ? '' : 'no'}" data-pos="${p.key}" title="${detail}" aria-label="${detail}">
          <span class="sq-act">${t('hub.upgrade')}<small class="sq-delta">${delta}</small></span>
          <span class="sq-cost">${formatNum(cost)}</span>
        </button>
      </div>`;
  }).join('');
  for (const btn of wrap.querySelectorAll('.sq-buy')) {
    btn.addEventListener('click', () => {
      if (buyUpgrade(btn.dataset.pos)) { pulse(btn.closest('.sq-card')); renderHub(); handlers.onUpgrade?.(); }
    });
  }
}



// 다음 상대 + 예상 배당 (mods.matchSetup 사용)
export function nextMatchInfo() {
  const oppOVR = oppBaseOVR();
  const setup = matchSetup(oppOVR);
  const scn = scenarioForMatchday(club.divIdx, club.matchday);
  const rival = isRivalMatchday(club.divIdx, club.matchday);   // B3 라이벌전(더비)
  return {
    oppName: rival ? rivalName(club.divIdx) : opponentName(club.divIdx, club.matchday),
    rival,
    oppOVR, setup, scenario: scn,
    // 상대 전개 성향 페르소나 — 수비 국면에서 상대 루트 선택의 기본값 (C단계)
    disposition: opponentDisposition(club.divIdx, club.matchday),
  };
}

function renderNextMatch() {
  const info = nextMatchInfo();
  setText('hub-next-opp', (info.rival ? '🔥 ' : '') + info.oppName);   // 더비 표식(B3)
  const o = info.setup.odds;
  setHtml('hub-next-odds',
    `<span class="od w">${t('match.win')} ${o.win}%</span>`
    + `<span class="od d">${t('match.draw')} ${o.draw}%</span>`
    + `<span class="od l">${t('match.loss')} ${o.loss}%</span>`);
  setText('hub-play', t('hub.play') + ' →');
}

function setText(id, v) { const el = $(id); if (el) el.textContent = v; }
function setHtml(id, v) { const el = $(id); if (el) el.innerHTML = v; }
function setHidden(id, v) { const el = $(id); if (el) el.hidden = v; }
function toggleAfford(id, ok) { const el = $(id); if (el) el.classList.toggle('no', !ok); }

// Darken a hex color by a factor (0-1). Used for badge gradient.
function darkenHex(hex, factor) {
  const h = hex.replace('#', '');
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * (1 - factor)));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * (1 - factor)));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * (1 - factor)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
