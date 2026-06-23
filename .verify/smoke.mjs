// 실제 Chromium 통합 스모크. Python Playwright 러너의 종료 코드를 전달한다.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'browser_smoke.py');
const python = process.env.PYTHON || 'python';
const run = spawnSync(python, [script], { stdio: 'inherit' });
if (run.error) {
  console.error(`Python Playwright 실행 실패: ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);

