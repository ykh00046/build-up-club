import { createEngine } from '../js/engine/engine.js';
import { getScenario } from '../js/data/scenarios.js';

let fail = 0;
const ok = (condition, message) => {
  console.log(`  ${condition ? 'OK' : 'FAIL'} ${message}`);
  if (!condition) fail++;
};

console.log('=== Press mode test ===\n');

let engine = createEngine(getScenario('A1'), 221);
let result = engine.openPressingMode();
ok(result.ok, 'pressing mode opens from live play');
ok(engine.state.phase === 'PRESSING', 'phase switches to pressing');
ok(engine.state.matchDecision?.id === 'defensive_press', 'pressing mode creates a situation decision');
ok(engine.holder()?.side === 'opp', 'opponent becomes ball holder during press');

engine.state.defensivePress.regainP = 1;
result = engine.chooseSituationOption('dp_press');
ok(result.ok && result.recovered, 'aggressive press can win the ball');
ok(engine.state.status === 'live', 'successful press keeps the attempt alive');
ok(engine.holder()?.side === 'us', 'successful press restores our possession');
ok(engine.state.facts.defensivePressWins === 1, 'successful press is recorded');

engine = createEngine(getScenario('A1'), 222);
engine.openPressingMode();
engine.state.defensivePress.regainP = 0;
result = engine.chooseSituationOption('dp_press');
ok(result.ok && !result.recovered, 'failed press resolves as not recovered');
ok(engine.state.status === 'over', 'failed aggressive press ends the attempt');
ok(engine.state.outcome?.kind === 'press_broken', 'failed press has a dedicated outcome');

engine = createEngine(getScenario('A1'), 223);
engine.openPressingMode();
result = engine.chooseSituationOption('dp_drop');
ok(result.ok && result.recovered === false, 'retreat is accepted');
ok(engine.state.status === 'live', 'retreat keeps play alive');
ok(engine.holder()?.id === 'us-gk', 'retreat resets possession to our goalkeeper');
ok(!engine.state.matchDecision && !engine.state.defensivePress, 'retreat clears pressing decision state');

console.log(fail === 0 ? '\nPress mode passed' : `\n${fail} failures`);
process.exit(fail === 0 ? 0 : 1);
