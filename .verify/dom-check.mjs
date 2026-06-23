// 정적 DOM 교차검증 — JS가 참조하는 모든 element id가 index.html에 존재하는지,
// 동적 생성 클래스(.sq-card 등)가 자기 생성 코드와 일치하는지 확인.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const jsFiles = ['js/main.js', 'js/career/hub.js', 'js/career/club.js', 'js/career/events.js', 'js/career/mods.js', 'js/career/season.js', 'js/career/i18n.js'];
const js = Object.fromEntries(jsFiles.map((f) => [f, read(f)]));

// 1) HTML에 정의된 id 수집
const definedIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// 2) JS가 getElementById / $('..') 로 참조하는 리터럴 id 수집 (파일별)
const refRe = /(?:getElementById\(\s*|[^A-Za-z0-9_]\$\(\s*)['"]([a-zA-Z][\w-]*)['"]\s*\)\s*(\?\.)?/g;
// main.js의 setText('id', ..) 도 참조로 간주
const setTextRe = /setText\(\s*['"]([a-zA-Z][\w-]*)['"]/g;

let missing = [];
for (const [f, src] of Object.entries(js)) {
  const ids = new Set();
  // optional chaining은 요소 부재를 의도적으로 허용하므로 필수 DOM 계약에서 제외.
  for (const m of src.matchAll(refRe)) if (!m[2]) ids.add(m[1]);
  for (const m of src.matchAll(setTextRe)) ids.add(m[1]);
  for (const id of ids) {
    if (!definedIds.has(id)) missing.push(`${f}: getElementById('${id}') — index.html에 없음`);
  }
}

// 3) hub.js가 동적 생성하는 요소의 클래스/속성 self-consistency
const hub = js['js/career/hub.js'];
const checks = [];
function expect(cond, msg) { checks.push([!!cond, msg]); }
// renderSquad는 .sq-card / .sq-buy / data-pos 를 생성하고 동일 셀렉터로 쿼리
expect(/class="sq-card"/.test(hub) && /querySelectorAll\('\.sq-buy'\)/.test(hub), 'squad: .sq-card 생성 + .sq-buy 쿼리 일치');
expect(/data-pos="\$\{p\.key\}"/.test(hub) && /btn\.dataset\.pos/.test(hub), 'squad: data-pos 생성 + dataset.pos 사용 일치');
// 다음 상대 odds 클래스
expect(/class="od w"/.test(hub) && /class="od d"/.test(hub) && /class="od l"/.test(hub), 'odds: w/d/l 클래스 생성');

// 4) main.js가 careerResult.dataset.tone 을 'w'|'d'|'l' 로 설정하고 CSS가 그 톤을 처리
const main = js['js/main.js'];
expect(/careerResult\.dataset\.tone = r/.test(main), 'result: dataset.tone = r(w/d/l) 설정');
expect(/career-result\[data-tone="w"\]/.test(html) && /career-result\[data-tone="l"\]/.test(html), 'CSS: result 톤별 색상 규칙 존재');

// 5) 핵심 플로우 함수/리스너 존재
expect(/initHub\(\{[^}]*onPlay: startMatch/.test(main), 'flow: initHub onPlay=startMatch 연결');
expect(/function settleCareerMatch\(\)/.test(main) && /resolveScoreline\(/.test(main), 'flow: settleCareerMatch + resolveScoreline');
expect(/if \(careerActive\) settleCareerMatch\(\)/.test(main), 'flow: 경기 종료 → 커리어 정산 분기');
expect(/applyClubBoost\(engine, currentSetup\)/.test(main), 'glue: newAttempt에서 클럽 부스트 적용');

console.log('=== 정적 DOM 교차검증 ===\n');
console.log(`HTML 정의 id: ${definedIds.size}개`);
let fail = 0;
console.log('\n[참조 id 존재성]');
if (missing.length === 0) console.log('  ✓ JS가 참조하는 모든 id가 index.html에 존재');
else { fail += missing.length; for (const m of missing) console.log('  ✗ ' + m); }

console.log('\n[생성/사용 일치 + 플로우]');
for (const [ok, msg] of checks) { console.log(`  ${ok ? '✓' : '✗ FAIL —'} ${msg}`); if (!ok) fail++; }

console.log(fail === 0 ? '\n✅ 정적 검증 통과 — DOM 참조/플로우 무결' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
