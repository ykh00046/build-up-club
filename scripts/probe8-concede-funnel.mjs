// 수비 국면 퍼널 — 회수 / 슛-선방 / 실점 비율 + 슛 평균 xG. concede가 낮은 게
// 회수과다(P슛↓) 때문인지 xG과소인지 가른다.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, aiPolicy, executePolicyAction, settle } from '../js/engine/policy.js';
const CELLS=['A1','B1','C1','C2','E1'];
let poss=0, regain=0, shot=0, goal=0, saved=0, xgSum=0;
for (const cell of CELLS){
  for (let i=0;i<2500;i++){
    const e=createEngine(getScenario(cell), 70000+i, { defenseEntry:'loss', opponentBuildDisposition:'balanced' });
    let guard=0, inDef=false, counted=false;
    while(e.state.status==='live' && guard++<40){
      settle(e); if(e.state.status!=='live')break;
      if(e.state.defenseLoop) inDef=true;
      const v=buildPolicyView(e,'us'); const a=aiPolicy(v);
      if(a.kind==='noop')break;
      const wasDefense=!!e.state.defenseLoop;
      const r=executePolicyAction(e,a); settle(e);
      if(wasDefense && !counted){
        // 이 결정이 국면을 종료시켰나?
        if(r && r.conceded){ shot++; goal++; xgSum+=(r.xg??0); poss++; counted=true; }
        else if(r && r.recovered){ regain++; poss++; counted=true; }
        else if(wasDefense && !e.state.defenseLoop && e.state.status==='live'){
          // 슛 선방(defenseLoop 사라졌는데 회수도 실점도 아님 = restart)
          shot++; saved++; poss++; counted=true;
        }
      }
      if(counted) break;
    }
  }
}
const p=(n)=>(n/Math.max(1,poss)*100).toFixed(1);
console.log(`수비 국면 ${poss}회`);
console.log(`  회수(regain)   ${regain} (${p(regain)}%)`);
console.log(`  슛 도달        ${shot} (${p(shot)}%)  = 선방 ${saved}(${p(saved)}%) + 실점 ${goal}(${p(goal)}%)`);
console.log(`  → concede      ${p(goal)}%`);
console.log(`  슛 평균 xG     ${(xgSum/Math.max(1,goal)).toFixed(3)} (실점만) ; P(goal|shot)=${(goal/Math.max(1,shot)*100).toFixed(1)}%`);
console.log(`\n해석: P(슛도달) ${p(shot)}% × P(goal|shot) ${(goal/Math.max(1,shot)*100).toFixed(1)}% ≈ concede ${p(goal)}%`);
