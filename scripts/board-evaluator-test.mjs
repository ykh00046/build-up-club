import { createEngine } from '../js/engine/engine.js';
import { evaluateBoard, formatBoardRead } from '../js/engine/evaluator.js';
import { getScenario } from '../js/data/scenarios.js';

let fail = 0;
const ok = (condition, message) => {
  console.log(`  ${condition ? 'OK' : 'FAIL'} ${message}`);
  if (!condition) fail++;
};

console.log('=== Board evaluator test ===\n');

const engine = createEngine(getScenario('A1'), 1234);
let read = evaluateBoard(engine);
ok(read && read.candidates.length >= 3, 'current board produces multiple AI candidates');
ok(read.best && read.best.net >= -1, 'best action is ranked');
ok(formatBoardRead(read).includes('최선:'), 'formatted read includes best action');
ok(formatBoardRead(read).includes('도박:'), 'formatted read includes gamble action');
ok(formatBoardRead(read).includes('덫:'), 'formatted read includes trap action');

engine.state.actionHistory = ['to_feet', 'to_feet', 'to_feet'];
engine.state.adaptRead = 'to_feet';
read = evaluateBoard(engine);
ok(read.trap && read.trap.trapScore >= 0.45, 'opponent adaptation raises trap score');
ok(formatBoardRead(read).includes('차단 위험'), 'trap copy explains interception risk');

const shotEngine = createEngine(getScenario('A1'), 4321);
shotEngine.state.phase = 'FINAL_THIRD';
const holder = shotEngine.holder();
holder.x = 94;
holder.y = 34;
holder.tx = holder.x;
holder.ty = holder.y;
read = evaluateBoard(shotEngine);
ok(read.candidates.some((candidate) => candidate.action === 'shoot'), 'shot candidate appears in final third');
ok(formatBoardRead(read).includes('xG') || read.candidates.some((candidate) => candidate.shot?.xg > 0), 'shot value is exposed');

console.log(fail === 0 ? '\nBoard evaluator passed' : `\n${fail} failures`);
process.exit(fail === 0 ? 0 : 1);
