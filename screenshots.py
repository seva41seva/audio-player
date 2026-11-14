#!/usr/bin/env python3
"""Скриншоты мобильного (Android) и десктопного вида с замоканным API Яндекса."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8000/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(OUT, exist_ok=True)

FOLDER = {"name": "Лекции по анатомии", "type": "dir",
          "_embedded": {"total": 4, "items": [
              {"name": "01 Введение.mp3", "path": "/01 Введение.mp3", "type": "file", "size": 12_400_000, "mime_type": "audio/mpeg"},
              {"name": "02 Костная система.mp3", "path": "/02 Костная система.mp3", "type": "file", "size": 45_800_000, "mime_type": "audio/mpeg"},
              {"name": "03 Мышечная система.mp3", "path": "/03 Мышечная система.mp3", "type": "file", "size": 52_100_000, "mime_type": "audio/mpeg"},
              {"name": "Конспект.pdf", "path": "/Конспект.pdf", "type": "file", "size": 900_000, "mime_type": "application/pdf"},
          ]}}

async def mock_routes(page):
    async def handler(route):
        u = route.request.url
        if "/public/resources/download" in u:
            await route.fulfill(status=200, content_type="application/json",
                                body=json.dumps({"href": "https://downloader.disk.yandex.ru/audio/track.mp3"}))
        elif "/public/resources" in u:
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(FOLDER))
        else:
            await route.continue_()
    await page.route("**cloud-api.yandex.net/**", handler)
    # аудио не грузим из сети — отдаём пустой ответ, плееру важна разметка
    await page.route("**downloader.disk.yandex.ru/**", lambda r: r.fulfill(status=200, content_type="audio/mpeg", body=b""))

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 393, "height": 851}, device_scale_factor=2, is_mobile=True, has_touch=True,
            user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
            locale="ru-RU",
        )
        page = await ctx.new_page()
        await mock_routes(page)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(400)
        await page.screenshot(path=os.path.join(OUT, "android-01-start.png"))

        # Открываем папку
        await page.fill("#urlInput", "https://disk.yandex.ru/d/demoLECTURES")
        await page.click("#openBtn")
        await page.wait_for_timeout(900)
        await page.screenshot(path=os.path.join(OUT, "android-02-folder.png"))

        # Открываем второй файл из плейлиста
        items = page.locator("#playlistList .playlist-item")
        await items.nth(2).click()
        await page.wait_for_timeout(900)
        await page.screenshot(path=os.path.join(OUT, "android-03-player.png"))

        # Прокрутка вниз — должен появиться мини-плеер
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight * 0.55)")
        await page.wait_for_timeout(700)
        await page.screenshot(path=os.path.join(OUT, "android-04-mini.png"))

        # Проверка размеров тач-целей и отсутствия горизонтального скролла
        metrics = await page.evaluate("""() => {
          const btns = [...document.querySelectorAll('.ctl, .mp-btn, #openBtn, .icon-btn, .btn')];
          const small = btns.filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44); })
                            .map(b => (b.id || b.className) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
          const inputFont = getComputedStyle(document.querySelector('#urlInput')).fontSize;
          const seekH = document.querySelector('#seekBar').getBoundingClientRect().height;
          return {
            overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
            scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
            smallTargets: small, inputFont, seekH,
            mini: getComputedStyle(document.querySelector('#miniPlayer')).display,
            controlsCols: getComputedStyle(document.querySelector('.controls')).gridTemplateColumns,
          };
        }""")
        print("METRICS", json.dumps(metrics, ensure_ascii=False, indent=2))
        print("PAGE ERRORS", errors)

        # Десктоп для сравнения
        ctx2 = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="ru-RU")
        page2 = await ctx2.new_page()
        await mock_routes(page2)
        await page2.goto(BASE, wait_until="networkidle")
        await page2.fill("#urlInput", "https://disk.yandex.ru/d/demoLECTURES")
        await page2.click("#openBtn")
        await page2.wait_for_timeout(900)
        await page2.locator("#playlistList .playlist-item").nth(1).click()
        await page2.wait_for_timeout(800)
        await page2.screenshot(path=os.path.join(OUT, "desktop.png"), full_page=False)
        await browser.close()
    print("OK, скриншоты в", OUT)

asyncio.run(main())
