import json, sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 390, "height": 844})
    console = []
    page.on('console', lambda msg: console.append(f'{msg.type}: {msg.text}'))
    page.goto('http://127.0.0.1:4173/index.html', wait_until='networkidle')
    page.locator('#btn-kickoff').click()
    page.wait_for_timeout(100)
    hub = page.evaluate("""() => ({
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      nameTag: document.querySelector('#hub-name').tagName,
      mission: document.querySelector('#hub-mission').textContent.trim(),
      effects: document.querySelector('#hub-effects').textContent.trim(),
      upgrades: [...document.querySelectorAll('.sq-card')].map(x => x.innerText.trim())
    })""")
    page.locator('#hub-play').click()
    page.wait_for_timeout(100)
    tactics = page.evaluate("""() => ({
      pressed: [...document.querySelectorAll('#tactics-overlay [aria-pressed]')].map(x => [x.textContent.trim(), x.getAttribute('aria-pressed')]),
      htmlOverflow: document.documentElement.style.overflow
    })""")
    page.locator('#btn-tactics-kickoff').scroll_into_view_if_needed()
    page.locator('#btn-tactics-kickoff').click()
    page.locator('#pitch').focus()
    before = page.locator('#turn-count').inner_text()
    page.keyboard.press('ArrowRight')
    announced = page.locator('#kb-announce').inner_text()
    page.keyboard.press('Enter')
    page.wait_for_timeout(900)
    after = page.locator('#turn-count').inner_text()
    drawer_before = page.locator('#btn-drawer').get_attribute('aria-expanded')
    page.locator('#btn-drawer').click()
    drawer = page.evaluate("""() => ({
      expanded: document.querySelector('#btn-drawer').getAttribute('aria-expanded'),
      open: document.querySelector('aside').classList.contains('drawer-open'),
      backdrop: document.querySelector('#drawer-backdrop').classList.contains('show')
    })""")
    print(json.dumps({"hub":hub,"tactics":tactics,"keyboard":{"before":before,"announce":announced,"after":after},"drawerBefore":drawer_before,"drawer":drawer,"console":console}, ensure_ascii=False, indent=2))
    browser.close()
