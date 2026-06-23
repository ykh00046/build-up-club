import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
OUT = Path(r"C:\X\game\build-up-club\.verify")

def visible_controls(page):
    return page.locator("button:visible, input:visible, select:visible, summary:visible, [tabindex]:visible").evaluate_all(
        "els => els.map(e => ({tag:e.tagName,id:e.id,text:(e.innerText||e.getAttribute('aria-label')||'').trim(),role:e.getAttribute('role'),tabindex:e.getAttribute('tabindex'),box:(()=>{const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]})()}))"
    )

def safe_screenshot(page, path, errors):
    try:
        page.screenshot(path=path, full_page=True, timeout=5000)
    except Exception as exc:
        errors.append(f"screenshot skipped: {Path(path).name}: {exc.__class__.__name__}")

def audit(p, viewport, suffix):
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=viewport, device_scale_factor=1)
        console = []
        errors = []
        page.route("https://fonts.googleapis.com/**", lambda route: route.abort())
        page.route("https://fonts.gstatic.com/**", lambda route: route.abort())
        page.on("console", lambda msg: console.append(f"{msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto("http://127.0.0.1:4173/index.html", wait_until="commit")
        page.wait_for_timeout(5000)
        if not page.evaluate("Boolean(window.__game && window.__buc)"):
            errors.append("app readiness hook missing after 5s")
        page.evaluate("() => { try { document.fonts && document.fonts.clear && document.fonts.clear(); } catch {} }")
        safe_screenshot(page, OUT / f"title-{suffix}.png", errors)
        states = {"title": visible_controls(page)}
        page.locator("#btn-kickoff").click()
        page.wait_for_timeout(300)
        safe_screenshot(page, OUT / f"hub-{suffix}.png", errors)
        states["hub"] = visible_controls(page)
        hub_metrics = page.evaluate("""() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          hubScrollHeight: document.querySelector('#hub-overlay').scrollHeight,
          hubClientHeight: document.querySelector('#hub-overlay').clientHeight
        })""")
        page.locator("#hub-play").evaluate("el => el.click()")
        page.wait_for_timeout(300)
        safe_screenshot(page, OUT / f"tactics-{suffix}.png", errors)
        states["tactics"] = visible_controls(page)
        page.locator("#btn-tactics-kickoff").evaluate("el => el.click()")
        page.wait_for_timeout(500)
        safe_screenshot(page, OUT / f"match-{suffix}.png", errors)
        states["match"] = visible_controls(page)
        match_metrics = page.evaluate("""() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          canvas: (()=>{const r=document.querySelector('#pitch').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})(),
          active: document.activeElement?.id || document.activeElement?.tagName
        })""")
        ready_for_situation = page.evaluate("Boolean(window.__game && window.__game.engine && window.__game.engine.state)")
        if ready_for_situation:
            page.evaluate("""() => {
              window.__game.engine.state.pressure = 70;
              window.__game.dispatch('hold');
            }""")
            page.wait_for_function("document.querySelector('#match-situation').hidden === false", timeout=5000)
            safe_screenshot(page, OUT / f"situation-{suffix}.png", errors)
            match_metrics["situation"] = page.evaluate("""() => {
              const banner = document.querySelector('#match-situation').getBoundingClientRect();
              const buttons = [...document.querySelectorAll('.actionbar button')].filter(el => el.offsetParent).map(el => el.getBoundingClientRect());
              return {
                banner: [banner.x, banner.y, banner.width, banner.height],
                actionBottom: Math.max(...buttons.map(r => r.bottom)),
                viewportHeight: innerHeight,
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth
              };
            }""")
        else:
            errors.append("match hook missing; skipped forced situation")
            match_metrics["situation"] = None
        result = {"viewport":viewport,"states":states,"hubMetrics":hub_metrics,"matchMetrics":match_metrics,"console":console,"errors":errors}
        (OUT / f"audit-{suffix}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()

with sync_playwright() as p:
    audit(p, {"width":1440,"height":1000}, "desktop")
    audit(p, {"width":390,"height":844}, "mobile")
