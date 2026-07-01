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
    print(f'  OK {message}')


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


print('=== Build-Up Club browser smoke ===\n')
with server() as port, sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.goto(f'http://127.0.0.1:{port}/index.html', wait_until='domcontentloaded')
    page.evaluate('localStorage.clear()')
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function('window.__game && window.__buc')

    print('[1] title and hub')
    check(page.locator('#title-overlay').get_attribute('aria-hidden') == 'false', 'title is visible')
    page.locator('#btn-kickoff').click()
    if page.locator('#tutorial-overlay.visible').count() > 0:
        page.locator('#tutorial-skip').click()
        page.wait_for_function("document.querySelector('#tutorial-overlay').getAttribute('aria-hidden') === 'true'")
    page.wait_for_selector('#hub-overlay.visible')
    check(page.locator('#hub-overlay').get_attribute('aria-hidden') == 'false', 'hub is visible')

    print('\n[2] squad upgrade and season goals')
    check(page.locator('#hub-squad .sq-card').count() == 4, 'squad cards exist')
    page.locator('#tab-squad').click()
    page.wait_for_selector('#hub-panel-squad:not([hidden])')
    page.wait_for_function("document.querySelector('#hub-ovr').textContent.trim() !== ''")
    before = float(page.locator('#hub-ovr').inner_text())
    page.locator('.sq-card[data-pos="mf"] .sq-buy').click()
    page.wait_for_function(f"Number(document.querySelector('#hub-ovr').textContent.trim()) > {before}")
    after = float(page.locator('#hub-ovr').inner_text())
    check(after > before, f'upgrade increases OVR {before}->{after}')
    check(page.locator('.sg-card').count() == 2, 'season goal cards exist')

    print('\n[3] moment select and simplified briefing')
    page.locator('#hub-play').click()
    page.wait_for_selector('#select-overlay.visible')
    page.locator('#select-grid button').first.click()
    page.wait_for_selector('#tactics-overlay.visible')
    check(page.locator('#tactics-overlay.simplified').count() == 1, 'first briefing starts simplified')
    plan_text = page.locator('#tactics-plan-text').inner_text().strip()
    check(plan_text != '', 'recommended plan is visible')
    check(all(label in plan_text for label in ['최선:', '도박:', '덫:']), 'AI board read is visible in briefing')
    ai_read = page.evaluate('window.__game.evaluateBoard()')
    check(bool(ai_read and ai_read.get('best')), 'AI board evaluator is exposed to the browser')
    page.locator('#btn-tactics-adv').click()
    page.wait_for_function("!document.querySelector('#tactics-overlay').classList.contains('simplified')")
    check(page.locator('#tactics-scout-style').inner_text().strip() != '', 'scouting style is visible after expand')
    check(page.locator('#tactics-scout-rec').inner_text().strip() != '', 'scouting recommendation is visible after expand')
    page.locator('#btn-tactics-kickoff').click()

    print('\n[4] actionbar click and keyboard play')
    page.wait_for_selector('#tactics-overlay:not(.visible)')
    page.locator('[data-action="hold"]').click()
    page.wait_for_function("document.querySelector('#turn-count').textContent === '1'")
    check(page.locator('#turn-count').inner_text() == '1', 'desktop actionbar button is clickable')
    page.locator('#pitch').focus()
    check(page.evaluate("document.activeElement && document.activeElement.id === 'pitch'"), 'pitch accepts keyboard focus')

    print('\n[5] pressing mode (ball-winning)')
    page.locator('[data-action="press_mode"]').click()
    page.wait_for_function("document.querySelector('#transition-actions button') !== null")
    check(page.locator('#transition-actions button').count() == 3, 'pressing offers three choices in actionbar')
    check(page.locator('#match-situation .situation-actions button').count() == 3, 'pressing choices mirrored in situation strip')
    check(page.locator('#transition-actions').get_attribute('data-kind') == 'defensive_press', 'pressing decision is tagged')
    # 블록 후퇴 = 안전 리셋 — 경기는 계속 라이브로 유지된다.
    page.locator('#transition-actions button[data-situation-choice="dp_drop"]').click()
    page.wait_for_function("document.querySelector('#transition-actions').children.length === 0")
    check(page.locator('#career-result').get_attribute('aria-hidden') != 'false', 'retreat resets without ending the match')

    print('\n[6] transition decision and report CTA')
    page.evaluate("""() => {
      const e = window.__game.engine;
      e.state.phase = 'FINAL_THIRD';
      e.state.transition = {
        kind: 'intercepted',
        detail: { reason: 'smoke' },
        loss: { x: 84, y: 22 },
        msLeft: 5000,
        regainP: 0.57,
      };
      e.state.matchDecision = {
        id: 'transition',
        title: 'Counterpress window',
        detail: 'Recover or retreat.',
        choices: [
          { id: 'cp_press', label: 'Counterpress', desc: 'Recover high.' },
          { id: 'cp_retreat', label: 'Retreat', desc: 'End safely.' },
        ],
      };
    }""")
    page.wait_for_function("document.querySelector('#transition-actions button') !== null")
    check(page.locator('#transition-actions button').count() == 2, 'transition actions are mirrored in actionbar')
    page.locator('#transition-actions button[data-situation-choice="cp_retreat"]').click()
    page.wait_for_function("document.querySelector('#career-result').getAttribute('aria-hidden') === 'false'")
    check('그래서 다음엔?' in (page.locator('#cr-report').text_content() or ''), 'result report shows next-action CTA')

    browser.close()

print('\nBrowser smoke passed')
