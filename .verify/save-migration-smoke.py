"""세이브 마이그레이션 스모크 — roadmap P0.
3종 케이스를 Chromium(localStorage) 레벨에서 검증:
  1) 새 세이브: 플레이 → save → reload → 데이터 보존
  2) 구 세이브(saveVersion 2 + 레거시 id) 주입 → reload → saveVersion 4 + id 마이그레이션
  3) 깨진 JSON 세이브 주입 → reload → 안전 무시(기본값)
"""
import contextlib
import json
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


print('=== 세이브 마이그레이션 스모크 ===\n')
with server() as port, sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})

    # ── [1] 새 세이브: 생성 → save → reload → 보존 ──
    print('[1] 새 세이브 생성 → 저장 → 재로드')
    page.goto(f'http://127.0.0.1:{port}/index.html', wait_until='domcontentloaded')
    page.wait_for_function('window.__game && window.__buc')
    page.locator('#btn-kickoff').click()
    page.wait_for_function("document.querySelector('#hub-overlay').getAttribute('aria-hidden') === 'false'")
    # firstPlay 튜토리얼이 표시되면 건너뛰기 (이후 흐름 차단 방지).
    try:
        page.wait_for_selector('#tutorial-overlay.visible', timeout=3000)
        page.locator('#tutorial-skip').click()
        page.wait_for_selector('#tutorial-overlay:not(.visible)', timeout=3000)
    except Exception:
        pass
    # 강화로 club 상태 변화 → save
    page.locator('.sq-card[data-pos="mf"] .sq-buy').click()
    page.wait_for_function("window.__buc.club.levels.mf >= 2")
    page.evaluate("() => window.__buc.Club.save()")
    saved_mf = page.evaluate("window.__buc.club.levels.mf")
    saved_cash = page.evaluate("window.__buc.club.cash")
    # reload → load() 자동 실행
    page.goto(f'http://127.0.0.1:{port}/index.html', wait_until='domcontentloaded')
    page.wait_for_function('window.__game && window.__buc')
    loaded_mf = page.evaluate("window.__buc.club.levels.mf")
    loaded_cash = page.evaluate("window.__buc.club.cash")
    loaded_sv = page.evaluate("window.__buc.club.saveVersion")
    check(loaded_mf == saved_mf, f'새 세이브 levels.mf 보존 ({saved_mf}→{loaded_mf})')
    check(loaded_cash == saved_cash, f'새 세이브 cash 보존 ({saved_cash}→{loaded_cash})')
    check(loaded_sv == 5, f'새 세이브 saveVersion 5 ({loaded_sv})')

    # ── [2] 구 세이브(saveVersion 2 + 레거시 id) 주입 → 마이그레이션 ──
    print('\n[2] 구 세이브(saveVersion 2 + gegen) → 마이그레이션')
    page.evaluate("""(legacy) => localStorage.setItem('buc-save-v1', JSON.stringify(legacy))""", {
        'saveVersion': 2, 'cash': 500, 'fans': 100, 'levels': {'gk': 1, 'df': 1, 'mf': 3, 'fw': 1},
        'divIdx': 0, 'points': 0, 'matchday': 5, 'record': {'w': 2, 'd': 0, 'l': 1},
        'philosophy': 'gegen', 'philoPoints': 2, 'identityXp': {'positional': 0, 'direct': 0, 'wing': 0, 'pressproof': 5},
    })
    page.goto(f'http://127.0.0.1:{port}/index.html', wait_until='domcontentloaded')
    page.wait_for_function('window.__game && window.__buc')
    mig_sv = page.evaluate("window.__buc.club.saveVersion")
    mig_philo = page.evaluate("window.__buc.club.philosophy")
    mig_mf = page.evaluate("window.__buc.club.levels.mf")
    mig_cash = page.evaluate("window.__buc.club.cash")
    mig_matchday = page.evaluate("window.__buc.club.matchday")
    check(mig_sv == 5, f'구 세이브 saveVersion 2→5 마이그레이션 ({mig_sv})')
    check(mig_philo == 'pressproof', f'레거시 philosophy gegen→pressproof ({mig_philo})')
    check(mig_mf == 3, f'데이터 보존 levels.mf=3 ({mig_mf})')
    check(mig_cash == 500, f'데이터 보존 cash=500 ({mig_cash})')
    check(mig_matchday == 5, f'데이터 보존 matchday=5 ({mig_matchday})')
    # 신규 필드(identityStreak/scenarioWins/seasonGoalsDone) 보정 확인
    mig_streak = page.evaluate("window.__buc.club.identityStreak")
    mig_sw = page.evaluate("window.__buc.club.scenarioWins")
    check(mig_streak is not None and mig_streak.get('count') == 0, f'마이그레이션 identityStreak 기본값 ({mig_streak})')
    check(isinstance(mig_sw, dict), f'마이그레이션 scenarioWins 빈 객체 ({mig_sw})')

    # ── [3] 깨진 JSON 세이브 → 안전 무시 ──
    print('\n[3] 깨진 JSON 세이브 → 안전 무시(기본값)')
    page.evaluate("() => localStorage.setItem('buc-save-v1', '{not-valid-json;;;')")
    page.goto(f'http://127.0.0.1:{port}/index.html', wait_until='domcontentloaded')
    page.wait_for_function('window.__game && window.__buc')
    broken_sv = page.evaluate("window.__buc.club.saveVersion")
    broken_cash = page.evaluate("window.__buc.club.cash")
    broken_levels = page.evaluate("window.__buc.club.levels")
    check(broken_sv == 5, f'깨진 세이브 → 기본 saveVersion 5 ({broken_sv})')
    check(broken_cash == 120, f'깨진 세이브 → 기본 cash 120 ({broken_cash})')
    check(broken_levels.get('gk') == 1 and broken_levels.get('mf') == 1, f'깨진 세이브 → 기본 levels ({broken_levels})')

    browser.close()

print('\n✅ 세이브 마이그레이션 스모크 통과')
