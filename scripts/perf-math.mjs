// 자기완결 수행기반 스코어 + 철학 수식 검증 (마운트 절단 우회; 실파일과 동일 알고리즘).
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗ FAIL —'} ${m}`); if (!c) fail++; };
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const NEUTRAL = { execMul: 1, xgMul: 1, concedeMul: 1, secondGoalBonus: 0, passBoostAdd: 0, pressRelief: 0, failConcedeRelief: 0 };

// mods.resolveScoreline 과 동일
function resolveScoreline(perf, setup, rng, pmods = NEUTRAL) {
  const P = typeof perf === 'string' ? { tone: perf } : (perf || {});
  const tone = P.tone || 'fail';
  const execRaw = (P.baits||0)*0.05 + (P.linesBroken||0)*0.12 + (P.switches||0)*0.08 + (P.runs||0)*0.05 + (P.windowsUsed||0)*0.10;
  const exec = clamp(execRaw * (pmods.execMul||1), 0, 0.8);
  const xg = clamp((P.xg||0) * (pmods.xgMul||1), 0, 1);
  const edge = clamp((setup.atk - 8) / 40, 0, 0.5);
  const dominance = clamp(exec + xg*0.35 + edge*0.4, 0, 1);
  let ourGoals = 0;
  if (tone === 'goal') {
    ourGoals = 1;
    const p2 = clamp(dominance*0.50 + (pmods.secondGoalBonus||0)*0.55, 0, 0.72);
    if (rng() < p2) { ourGoals = 2; if (dominance > 0.6 && rng() < (dominance - 0.6)*0.6) ourGoals = 3; }
  } else if (tone === 'near') {
    if (rng() < clamp(exec + xg*0.4 - 0.15, 0, 0.4)) ourGoals = 1;
  }
  const oppAtk = setup.oppOVR * 0.5;
  let concedeP = clamp(oppAtk/(oppAtk + setup.def*1.5), 0.05, 0.85) * (pmods.concedeMul||1) * (1 - dominance*0.35);
  if (tone === 'fail') concedeP += 0.18 * (1 - (pmods.failConcedeRelief||0));
  concedeP = clamp(concedeP, 0.02, 0.92);
  let oppGoals = 0; if (rng() < concedeP) oppGoals++; if (rng() < concedeP*0.45) oppGoals++;
  return { ourGoals, oppGoals, result: ourGoals>oppGoals?'w':ourGoals<oppGoals?'l':'d', cleanSheet: oppGoals===0, dominance };
}
// philosophy.philoMods (positional pos1+pos2)
function philoMods(perks) {
  const m = { ...NEUTRAL };
  const tbl = { pos1:{passBoostAdd:.06}, pos2:{execMul:1.35,secondGoalBonus:.12}, geg1:{pressRelief:1} };
  for (const id of perks) { const md = tbl[id]||{}; for (const k in md) { if (k==='execMul'||k==='xgMul'||k==='concedeMul') m[k]*=md[k]; else m[k]+=md[k]; } }
  return m;
}
const setup = { atk: 30, def: 30, oppOVR: 120 };
const avg = (perf, pm, n=5000) => { let s=0,mx=0; for(let i=0;i<n;i++){const r=resolveScoreline(perf,setup,Math.random,pm); s+=r.ourGoals; mx=Math.max(mx,r.ourGoals);} return {avg:s/n,max:mx}; };

console.log('=== 수행기반 스코어 + 철학 수식 ===\n');
console.log('[1] 품질 → 다득점 단조 + 2골 가능');
const plain = avg('goal', NEUTRAL), rich = avg({tone:'goal',baits:3,linesBroken:3,switches:2,runs:2,windowsUsed:2,xg:0.7}, NEUTRAL);
ok(rich.avg > plain.avg, `리치 > 단순 (${rich.avg.toFixed(2)} > ${plain.avg.toFixed(2)})`);
ok(rich.max >= 2, `2골+ 달성 가능 (max=${rich.max}) ← '2골' 미션 가능`);
ok(plain.max >= 1, '단순 골 최소 1');

console.log('\n[2] tone 성향');
ok(avg({tone:'near',xg:0.3}, NEUTRAL).avg < plain.avg, 'near < goal');
ok(resolveScoreline({tone:'fail'}, setup, Math.random).ourGoals === 0, 'fail 우리 득점 0');

console.log('\n[3] 철학 퍼크 → 다득점↑');
const pm = philoMods(['pos1','pos2']);
ok(pm.secondGoalBonus > 0 && pm.execMul > 1, `집계 execMul=${pm.execMul.toFixed(2)} 2nd+${pm.secondGoalBonus}`);
const wPhi = avg({tone:'goal',baits:2,linesBroken:2,xg:0.5}, pm), nPhi = avg({tone:'goal',baits:2,linesBroken:2,xg:0.5}, NEUTRAL);
ok(wPhi.avg > nPhi.avg, `철학 적용 다득점↑ (${wPhi.avg.toFixed(2)} > ${nPhi.avg.toFixed(2)})`);

console.log('\n[4] 게겐 pressRelief → 압박 완화 (rel 계산)');
const rel = (team, opp, relief) => opp / Math.max(1, team*(1+relief*0.08));
const intens = (r) => r<0.82?'mid':r<1.18?'high':'vhigh';
const o = {mid:0,high:1,vhigh:2};
ok(o[intens(rel(180,200,1))] <= o[intens(rel(180,200,0))], `완화: ${intens(rel(180,200,0))} → ${intens(rel(180,200,1))}`);

console.log('\n[5] 무결성'); ok(Number.isFinite(rich.avg) && Number.isFinite(wPhi.avg), 'NaN 없음');
console.log(fail === 0 ? '\n✅ 수식 전 항목 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
