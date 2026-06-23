// Seeded RNG (mulberry32) so an attempt can be reproduced from its seed.

export function createRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    range(lo, hi) { return lo + next() * (hi - lo); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    // Weighted choice from [{value, w}, ...]
    weighted(items) {
      const total = items.reduce((s2, it) => s2 + it.w, 0);
      let r = next() * total;
      for (const it of items) { r -= it.w; if (r <= 0) return it.value; }
      return items[items.length - 1].value;
    },
  };
}
