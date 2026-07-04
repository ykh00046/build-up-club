import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { buildPolicyView, aiPolicy, executePolicyAction, settle } from '../js/engine/policy.js';
const CELLS = ['B1','C2','E1'];
const DISPS = ['safe','balanced','aggressive','direct'];
for (const cell of CELLS) for (const disp of DISPS) {
  let dec=0, foul=0, drop=0, strongFoulCtx=0;
  for (let i=0;i<1500;i++){
    const e=createEngine(getScenario(cell), 50000+i, { defenseEntry:'loss', opponentBuildDisposition:disp });
    let guard=0;
    while(e.state.status==='live' && guard++<40){
      settle(e); if(e.state.status!=='live')break;
      const v=buildPolicyView(e,'us'); const pr=v.pressRead;
      if(e.state.defenseLoop && v.situation?.id==='defend' && pr) dec++;
      const a=aiPolicy(v);
      if(a.choiceId==='dp_foul') foul++;
      if(a.choiceId==='dp_drop') drop++;
      if(a.kind==='noop')break;
      executePolicyAction(e,a);
    }
  }
  const p=(n)=>dec?(n/dec*100).toFixed(1):'0';
  console.log(`${cell}/${disp}/loss  결정 ${dec}  foul픽 ${foul}(${p(foul)}%)  drop픽 ${drop}(${p(drop)}%)`);
}
