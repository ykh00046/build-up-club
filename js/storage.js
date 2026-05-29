// ─── Storage Manager ─────────────────────────────
const SAVE_KEY = 'buildup-lab:v1';
const StorageMgr = {
  data: null,

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        this.data = JSON.parse(raw);
      }
    } catch(e) { /* corrupt */ }
    if (!this.data || typeof this.data !== 'object') {
      this.data = this._defaults();
    }
    const def = this._defaults();
    for (const k in def) {
      if (!(k in this.data)) this.data[k] = def[k];
    }
  },

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch(e) { /* full */ }
  },

  _defaults() {
    return {
      levels: {},   // { "1": { stars: 0, bestPasses: 99 }, ... }
      unlocked: 1,
      muted: false,
      volume: 0.3,
    };
  },

  getLevelData(id) {
    return this.data.levels[id] || { stars: 0, bestPasses: 99 };
  },

  setLevelData(id, stars, passes) {
    const cur = this.getLevelData(id);
    if (stars > cur.stars || (stars === cur.stars && passes < cur.bestPasses)) {
      this.data.levels[id] = { stars: Math.max(cur.stars, stars), bestPasses: Math.min(cur.bestPasses, passes) };
    }
    if (id >= this.data.unlocked) {
      this.data.unlocked = Number(id) + 1;
    }
    this.save();
  },

  starsToGrade(stars) {
    return stars >= 3 ? 'S' : (stars === 2 ? 'A' : 'B');
  }
};

// Global exports
if (typeof window !== 'undefined') {
  window.SAVE_KEY = SAVE_KEY;
  window.StorageMgr = StorageMgr;
}
