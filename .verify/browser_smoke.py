import contextlib
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print(f'  ✓ {message}')


@contextlib.contextmanager
def server():
    previous = os.getcwd()
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_address[1]
    finally:
        httpd.shutdown()
        thread.join(timeout=2)
        os.chdir(previous)


print('=== Build-Up Club 통합 스모크 (Chromium) ===\n')
with server() as port, sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.goto(f'http://127.0.0.1:{port}/index.html', wait_until='domcontentloaded')
    page.wait_for_function('window.__game && window.__buc')

    print('[1] 타이틀 → 허브 → 강화')
    check(page.locator('#title-overlay').get_attribute('aria-hidden') == 'false', '타이틀 표시')
    page.locator('#btn-kickoff').click()
    check(page.locator('#hub-overlay').get_attribute('aria-hidden') == 'false', '허브 표시')
    check(page.locator('#hub-squad .sq-card').count() == 4, '스쿼드 카드 4개')
    page.wait_for_function("document.querySelector('#hub-ovr').textContent.trim() !== ''")
    before = page.locator('#hub-ovr').inner_text()
    page.locator('.sq-card[data-pos="mf"] .sq-buy').click()
    page.wait_for_function(f"document.querySelector('#hub-ovr').textContent.trim() !== '{before}'")
    after = page.locator('#hub-ovr').inner_text()
    check(float(after) > float(before), f'강화 후 전력 증가 {before}→{after}')

    print('\n[2] 경기 시작 → 키보드 패스')
    page.locator('#hub-play').click()
    page.locator('#btn-tactics-kickoff').click()
    page.locator('#pitch').focus()
    page.keyboard.press('ArrowRight')
    check('차단 위험' in page.locator('#kb-announce').inner_text(), '키보드 대상 위험도 안내')
    page.keyboard.press('Enter')
    page.wait_for_function("document.querySelector('#turn-count').textContent === '1'")
    check(True, '키보드 패스 실행')

    print('\n[3] 경기 상황 발생 → HUD 피드백')
    page.wait_for_timeout(800)
    page.evaluate("""() => {
      window.__game.engine.state.turn = 2;
      window.__game.engine.state.pressure = 58;
      window.__game.dispatch('hold');
    }""")
    page.wait_for_function("document.querySelector('#match-situation').hidden === false")
    check(page.locator('#situation-title').inner_text() == '템포 선택', '선택형 템포 상황 배너 표시')
    check(page.locator('#situation-actions button').count() == 2, '경기 중 선택 버튼 2개 표시')
    page.locator('#situation-actions button[data-situation-choice="reset"]').click()
    page.wait_for_function("document.querySelector('#situation-actions button') === null")
    check('리셋' in page.locator('#tactical-log').inner_text(), '선택 결과가 전술 로그에 반영')
    page.wait_for_function("window.__game.engine.busy === false")

    page.evaluate("""() => {
      window.__game.engine.state.pressure = 70;
      window.__game.dispatch('hold');
    }""")
    page.wait_for_function("document.querySelector('#match-situation').hidden === false")
    check(page.locator('#situation-title').inner_text() == '상대 압박 강화', '압박 강화 상황 배너 표시')
    check('원투' in page.locator('#situation-detail').inner_text(), '상황별 대응 방법 안내')

    print('\n[4] 결과 정산 → 강제 커리어 이벤트 → 허브')
    page.evaluate("""() => {
      window.__buc.club.matchday = 4;
      window.__buc.club.lastEventMatchday = 0;
    }""")
    for _ in range(45):
        if page.evaluate("window.__game.engine.state.status") == 'over':
            break
        page.evaluate("""() => {
          const e = window.__game.engine;
          e.state.phase = 'FINAL_THIRD';
          const h = e.holder();
          if (h) { h.x = 100; h.y = 34; }
          window.__game.dispatch('shoot');
        }""")
        page.wait_for_timeout(140)
    page.wait_for_function("document.querySelector('#career-result').getAttribute('aria-hidden') === 'false'")
    check(page.locator('#cr-score').inner_text().count(':') == 1, '결과 스코어 표시')
    check('다음 경기 추천' in page.locator('#cr-report').inner_text(), '전술 결과 리포트 표시')
    check(page.locator('#cr-training .ct-choice').count() == 2, '리포트 기반 훈련 선택 2개 표시')
    page.locator('#cr-training .ct-choice').first.click()
    check('XP' in page.locator('#cr-identity').inner_text(), '훈련 선택 후 정체성 XP 표시')
    page.locator('#cr-continue').click()
    page.wait_for_function("document.querySelector('#event-overlay').getAttribute('aria-hidden') === 'false'")
    check(page.locator('#event-choices .event-choice:not([disabled])').count() >= 1, '3~5경기 변주 이벤트 표시')
    page.locator('#event-choices .event-choice:not([disabled])').first.click()
    page.wait_for_function("document.querySelector('#hub-overlay').getAttribute('aria-hidden') === 'false'")
    check(page.locator('#hub-effects').inner_text().strip() != '' or page.locator('#hub-mission').inner_text().strip() != '', '허브 변주 상태 렌더링')
    check('클럽 정체성' in page.locator('#hub-identity').inner_text(), '허브 정체성 카드 렌더링')
    check(page.evaluate("Boolean(localStorage.getItem('buc-save-v1'))"), '커리어 저장 생성')

    browser.close()

print('\n✅ Chromium 통합 스모크 통과')
