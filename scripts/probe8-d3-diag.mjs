// D3 진단 — 성향 수렴 원인: 각 국면에서 후보 목록 + best/gamble/trap/calm/burst가
// 서로 다른 후보를 가리키는지, 성향별 실제 선택 타깃이 갈리는지.
import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';
import { oppBuildDryRun } from '../js/engine/dry-run.js';
import { chooseOppBuild } from '../js/engine/opp-build-policy.js';
import { buildPolicyView, aiPolicy, executePolicyAction, settle } from '../js/engine/policy.js';

for (const cell of ['C1','B1','A1']){
  // 상대 볼 국면(수비 국면) 하나를 잡아 dry-run 후보 덤프
  let shown=0;
  for (let i=0;i<400 && shown<2;i++){
    const e=createEngine(getScenario(cell), 60000+i, { defenseEntry:'loss', opponentBuildDisposition:'balanced' });
    let guard=0;
    while(e.state.status==='live' && guard++<30){
      settle(e); if(e.state.status!=='live')break;
      if(e.state.defenseLoop){
        const read=oppBuildDryRun(e);
        if(read && read.candidates.length>=2){
          const ids=(c)=>c?c.target.id:'-';
          const calm=read.candidates.reduce((a,c)=>((c.risk??1)<(a?.risk??1)?c:a),null);
          const burst=read.candidates.reduce((a,c)=>((c.progress??-1)>(a?.progress??-1)?c:a),null);
          // 성향별 결정적 선택(rng 고정)
          const pick=(d)=>{const seen={};for(let k=0;k<30;k++){const c=chooseOppBuild(read,d,()=>((k+0.5)/30));if(c)seen[c.target.id]=(seen[c.target.id]||0)+1;}return Object.entries(seen).map(([k,v])=>`${k}:${v}`).join(' ');};
          console.log(`\n[${cell}] 후보 ${read.candidates.length}개:`);
          read.candidates.forEach(c=>console.log(`   ${c.target.id} prog=${c.progress.toFixed(1)} risk=${c.risk.toFixed(2)} net=${c.net.toFixed(2)}`));
          console.log(`   레인: best=${ids(read.best)} gamble=${ids(read.gamble)} trap=${ids(read.trap)} calm=${ids(calm)} burst=${ids(burst)}`);
          console.log(`   safe픽:      ${pick('safe')}`);
          console.log(`   balanced픽:  ${pick('balanced')}`);
          console.log(`   aggressive픽:${pick('aggressive')}`);
          console.log(`   direct픽:    ${pick('direct')}`);
          shown++;
        }
        break;
      }
      const v=buildPolicyView(e,'us'); const a=aiPolicy(v);
      if(a.kind==='noop')break; executePolicyAction(e,a);
    }
  }
}
