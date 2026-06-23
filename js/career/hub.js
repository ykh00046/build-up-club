// 클럽 허브 UI — 스쿼드 강화 상점, 승격 게이지, 다음 상대/예상 배당, 프레스티지.
// main.js가 onPlay 콜백으로 전술 매치를 시작한다.

import {
  club, division, DIVISIONS, POSITIONS, teamOVR, attackOVR, defenseOVR,
  upgradeCost, buyUpgrade, stadiumCost, buyStadium, oppBaseOVR,
  prestige, prestigeGain, boostActive, boostRemainSec, startBoost, formatNum, save,
} from './club.js';
import { matchSetup, upgradePreview } from './mods.js';
import { opponentName, scenarioForMatchday } from './season.js';
import { t, getLang, toggleLang } from './i18n.js';
import { currentMission, effectsSummary } from './events.js';
import { currentPhilosophy } from './philosophy.js';
import { identitySummary } from './identity.js';


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
  $('hub-boost')?.addEventListener('click', () => { if (!boostActive()) { startBoost(); save(); renderHub(); } });
  $('hub-prestige')?.addEventListener('click', () => {
    if (!club.canPrestige) return;
    if (confirm(t('prestige.confirm'))) { prestige(); renderHub(); }
  });
  $('hub-name')?.addEventListener('click', () => {
    const v = prompt(getLang() === 'ko' ? '클럽 이름' : 'Club name', clubLabel());
    if (v != null) { club.clubName = v.slice(0, 24); save(); renderHub(); }
  });
}

function pulse(el) {
  if (!el) return;
  el.style.transform = 'scale(0.96)';
  setTimeout(() => { el.style.transform = ''; }, 110);
}

export function renderHub() {
  // 헤더
  setText('hub-name', clubLabel());
  setText('hub-div', divName());
  setText('hub-record', `${club.record.w}승 ${club.record.d}무 ${club.record.l}패`);
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
    philoBtn.innerHTML = `<span class="cb-k">${ph ? '철학 · ' + ph.name : '철학 선택'}</span><span class="cb-v">${pts}P</span>`;
    philoBtn.classList.toggle('on', !!ph);
    philoBtn.classList.toggle('alert', pts > 0);
  }

  renderNextMatch();
}

function renderIdentity() {
  const el = $('hub-identity');
  if (!el) return;
  const id = identitySummary();
  el.style.setProperty('--idc', id.color);
  el.innerHTML = `
    <span class="hi-k">클럽 정체성</span>
    <strong>${id.label}</strong>
    <span class="hi-desc">${id.desc}</span>
    <span class="hi-xp">${Math.round(id.value)} XP</span>`;
}

function renderCareerVariety() {
  const missionEl = $('hub-mission');
  const mission = currentMission();
  if (missionEl) {
    missionEl.hidden = !mission;
    missionEl.classList.toggle('done', !!mission?.done);
    if (mission) missionEl.innerHTML = `
      <span class="hm-icon">${mission.done ? '✓' : '🎯'}</span>
      <span><span class="hm-title">${mission.title}</span><br><span class="hm-desc">${mission.desc}</span></span>
      <span class="hm-reward">${mission.done ? '완료' : '+' + formatNum(mission.reward)}</span>`;
  }
  const effectsEl = $('hub-effects');
  if (effectsEl) effectsEl.innerHTML = effectsSummary().map((effect) => `
    <span class="eff-chip ${effect.tone === 'bad' ? 'bad' : 'good'}">
      ${effect.tone === 'bad' ? '⚠' : '◆'} ${effect.label}
      ${effect.left == null ? '' : `<span class="eff-left">${effect.left}경기</span>`}
    </span>`).join('');
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
    const stat = isAtk ? pv.atk : pv.def;
    const winUp = pv.win.to > pv.win.from;
    const dShot = Math.round((pv.shot.to - pv.shot.from) * 100);
    const dPass = +(((pv.pass.to - pv.pass.from) * 100).toFixed(1));
    const dGk = Math.round((pv.gk.to - pv.gk.from) * 100);
    const detail = `${t('pos.' + p.key)} Lv${lvl}→${lvl + 1} · `
      + `${t('hub.atk')} ${pv.atk.from}→${pv.atk.to}, ${t('hub.def')} ${pv.def.from}→${pv.def.to} · `
      + (isAtk ? `슛 보정 +${dShot}%, 패스 안정 +${dPass} · ` : `선방 +${dGk}% · `)
      + `${t('match.win')} ${pv.win.from}%→${pv.win.to}%`;
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
        <div class="sq-prev" title="${detail}">
          <span class="sq-prev-stat">${statKo} ${stat.from}→<b>${stat.to}</b></span>
          <span class="sq-prev-win ${winUp ? 'up' : ''}">${t('match.win')} ${pv.win.from}→${pv.win.to}%</span>
        </div>
        <button class="sq-buy ${afford ? '' : 'no'}" data-pos="${p.key}" aria-label="${detail}">
          <span>${t('hub.upgrade')}</span><span class="sq-cost">${formatNum(cost)}</span>
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
  return {
    oppName: opponentName(club.divIdx, club.matchday),
    oppOVR, setup, scenario: scn,
  };
}

function renderNextMatch() {
  const info = nextMatchInfo();
  setText('hub-next-opp', info.oppName);
  const o = info.setup.odds;
  setHtml('hub-next-odds',
    `<span class="od w">${t('match.win')} ${o.win}%</span>`
    + `<span class="od d">${t('match.draw')} ${o.draw}%</span>`
    + `<span class="od l">${t('match.loss')} ${o.loss}%</span>`);
  setText('hub-play', t('hub.play') + ' →');
}

function setText(id, v) { const el = $(id); if (el) el.textContent = v; }
function setHtml(id, v) { const el = $(id); if (el) el.innerHTML = v; }
function toggleAfford(id, ok) { const el = $(id); if (el) el.classList.toggle('no', !ok); }

// Darken a hex color by a factor (0-1). Used for badge gradient.
function darkenHex(hex, factor) {
  const h = hex.replace('#', '');
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * (1 - factor)));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * (1 - factor)));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * (1 - factor)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
