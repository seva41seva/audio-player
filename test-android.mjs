// Автотест мобильной/PWA-адаптации (jsdom, без реального аудио)
import { JSDOM } from "/tmp/node_modules/jsdom/lib/api.js";
import fs from "fs";
import path from "path";

const DIR = "/home/user/yandex-audio-player";
const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
const FOLDER = "https://disk.yandex.ru/d/TESTFOLDER";

const subFiles = [
  { name: "Глава 1.mp3", path: "/Том 1/Глава 1.mp3", type: "file", size: 5000000, mime_type: "audio/mpeg" },
  { name: "Глава 2.mp3", path: "/Том 1/Глава 2.mp3", type: "file", size: 6000000, mime_type: "audio/mpeg" },
];
const rootItems = [
  { name: "Том 1", path: "/Том 1", type: "dir" },
  { name: "Введение.mp3", path: "/Введение.mp3", type: "file", size: 1000000, mime_type: "audio/mpeg" },
];

function fakeFetch(url) {
  const u = decodeURIComponent(String(url));
  const json = (o) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(o)) });
  if (u.endsWith("manifest.webmanifest")) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") });
  if (u.includes("/public/resources/download")) return json({ href: "https://downloader.disk.yandex.ru/audio/x.mp3" });
  if (u.includes("/public/resources")) {
    if (u.includes("path=/Том 1")) return json({ name: "Том 1", type: "dir", _embedded: { total: subFiles.length, items: subFiles } });
    return json({ name: "Аудиокнига", type: "dir", _embedded: { total: rootItems.length, items: rootItems } });
  }
  return Promise.reject(new Error("unexpected " + u));
}

const mediaSessionCalls = { metadata: [], state: [], handlers: [] };

const dom = new JSDOM(html, {
  url: "https://example.test/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(win) {
    win.fetch = fakeFetch;
    const P = win.HTMLMediaElement.prototype;
    P.load = function () { this._loaded = true; };
    P.play = function () { this._paused = false; this.dispatchEvent(new win.Event("play")); return Promise.resolve(); };
    P.pause = function () { this._paused = true; this.dispatchEvent(new win.Event("pause")); };
    Object.defineProperty(P, "paused", { configurable: true, get() { return this._paused !== false; }, set(v) { this._paused = v; } });
    Object.defineProperty(P, "duration", { configurable: true, get() { return this._dur === undefined ? 600 : this._dur; }, set(v) { this._dur = v; } });
    Object.defineProperty(P, "currentTime", { configurable: true, get() { return this._ct || 0; }, set(v) { this._ct = v; } });
    Object.defineProperty(P, "buffered", { configurable: true, get() { return { length: 0 }; } });

    // Media Session API
    win.MediaMetadata = class { constructor(o) { Object.assign(this, o); } };
    Object.defineProperty(win.navigator, "mediaSession", {
      configurable: true,
      value: {
        set metadata(v) { mediaSessionCalls.metadata.push(v); },
        get metadata() { return mediaSessionCalls.metadata.at(-1) || null; },
        playbackState: "none",
        setActionHandler(name, fn) { mediaSessionCalls.handlers.push(name); this["h_" + name] = fn; },
        setPositionState(s) { mediaSessionCalls.state.push(s); },
      },
    });
    // Wake Lock
    win.navigator.wakeLock = { request: () => Promise.resolve({ release: () => {}, addEventListener: () => {} }) };
    win.HTMLElement.prototype.scrollIntoView = () => {};
    win.scrollTo = () => {};
  },
});

const win = dom.window;
const doc = win.document;
const $ = (s) => doc.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = [];
const check = (name, cond, extra) => res.push({ name, ok: !!cond, extra });

await sleep(250);

// ---------- 1. PWA-разметка ----------
check("manifest подключён", !!doc.querySelector('link[rel="manifest"]'), doc.querySelector('link[rel="manifest"]')?.getAttribute("href"));
check("theme-color для Android", !!doc.querySelector('meta[name="theme-color"]'));
check("viewport с viewport-fit=cover (вырез экрана)", /viewport-fit=cover/.test(doc.querySelector('meta[name="viewport"]').content));
check("apple/app-name мета", !!doc.querySelector('meta[name="application-name"]'));
check("иконка 192 в манифесте", fs.existsSync(path.join(DIR, "icons/icon-192.png")));
check("maskable-иконка есть", fs.existsSync(path.join(DIR, "icons/icon-maskable-512.png")));

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.webmanifest"), "utf8"));
check("манифест: standalone", manifest.display === "standalone");
check("манифест: start_url и scope", manifest.start_url === "./index.html" && manifest.scope === "./");
check("манифест: maskable purpose", manifest.icons.some((i) => (i.purpose || "").includes("maskable")));
check("манифест: все иконки существуют", manifest.icons.every((i) => fs.existsSync(path.join(DIR, i.src))), manifest.icons.map((i) => i.src));

const sw = fs.readFileSync(path.join(DIR, "service-worker.js"), "utf8");
check("SW кэширует оболочку", /index\.html/.test(sw) && /caches\.open/.test(sw));
check("SW не кэширует аудио и API", /isMedia/.test(sw) && /cloud-api\\?\.yandex/.test(sw.replace(/\\\\/g, "\\")) || /isApi/.test(sw));

// ---------- 2. Установка приложения ----------
check("кнопка установки скрыта до события", !$("#installRow").classList.contains("show"));
win.dispatchEvent(new win.Event("beforeinstallprompt"));
await sleep(50);
check("кнопка установки появилась", $("#installRow").classList.contains("show"));

// ---------- 3. Мобильные стили ----------
const css = html;
check("CSS: safe-area для нижней панели", /env\(safe-area-inset-bottom\)/.test(css));
check("CSS: медиазапрос под телефон", /@media \(max-width:720px\)/.test(css));
check("CSS: 16px в полях (без зума при фокусе)", /input\[type="url"\], \.add-form[\s\S]{0,120}font-size:16px/.test(css) || /\.jump-row input, \.pill select\{font-size:16px\}/.test(css));
check("CSS: увеличенная зона перемотки на тач", /\.seekbar\{height:44px/.test(css));
check("CSS: тач-цели не меньше 44px у кнопок", /min-height:44px/.test(css));
check("CSS: touch-action:manipulation (без двойного тапа)", /touch-action:manipulation/.test(css));

// ---------- 4. Мини-плеер ----------
check("мини-плеер в разметке", !!$("#miniPlayer"));
check("мини-плеер скрыт без трека", !$("#miniPlayer").classList.contains("show"));

$("#urlInput").value = FOLDER;
$("#addForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
await sleep(400);
const firstFile = [...doc.querySelectorAll("#playlistList .playlist-item")].find((el) => /Введение/.test(el.textContent));
firstFile.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
await sleep(400);

check("мини-плеер показан (плеер вне экрана)", $("#miniPlayer").classList.contains("show"));
check("в мини-плеере название трека", /Введение/.test($("#mpTitle").textContent), $("#mpTitle").textContent);
check("в мини-плеере время", /\d+:\d\d \/ \d+:\d\d/.test($("#mpMeta").textContent), $("#mpMeta").textContent);

// пауза/плей из мини-плеера
$("#mpPlay").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
await sleep(80);
check("мини-плеер ставит на паузу", $("#audio").paused);
$("#mpPlay").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
await sleep(80);
check("мини-плеер продолжает воспроизведение", !$("#audio").paused);

// основной плеер «на экране» → мини-плеер скрывается
const origRect = win.HTMLElement.prototype.getBoundingClientRect;
win.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.id === "playerCard") return { top: 100, bottom: 500, left: 0, right: 400, width: 400, height: 400 };
  return origRect.call(this);
};
win.dispatchEvent(new win.Event("scroll"));
await sleep(120);
check("мини-плеер скрыт, когда плеер виден", !$("#miniPlayer").classList.contains("show"), win.document.querySelector("#miniPlayer").className);
win.HTMLElement.prototype.getBoundingClientRect = origRect;

// ---------- 5. Media Session (экран блокировки) ----------
check("обработчики mediaSession заданы", mediaSessionCalls.handlers.length >= 7, mediaSessionCalls.handlers);
check("есть nexttrack/previoustrack", mediaSessionCalls.handlers.includes("nexttrack") && mediaSessionCalls.handlers.includes("previoustrack"));
check("есть seekto/seekbackward/seekforward", ["seekto", "seekbackward", "seekforward"].every((h) => mediaSessionCalls.handlers.includes(h)));
const meta = mediaSessionCalls.metadata.at(-1);
check("метаданные для локскрина (название)", meta && /Введение/.test(meta.title), meta && meta.title);
check("метаданные содержат папку", meta && /Аудиокнига/.test(meta.artist || ""), meta && meta.artist);
check("обложка передана", meta && Array.isArray(meta.artwork) && meta.artwork.length >= 1);
check("позиция передаётся в шторку", mediaSessionCalls.state.length > 0, mediaSessionCalls.state.at(-1));

// ---------- 6. Кнопка «назад» Android: из подпапки на уровень выше ----------
const folderRow = [...doc.querySelectorAll("#playlistList .playlist-item.folder-row")][0];
folderRow.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
await sleep(400);
check("вход в подпапку", /Том 1/.test($("#folderTitle").textContent + $("#folderPath").textContent), $("#folderTitle").textContent);
check("кнопка «Назад» видна в подпапке", !$("#folderBackBtn").classList.contains("hidden"));
const histLenBefore = win.history.length;
win.history.back();
await sleep(500);
check("аппаратная «назад» подняла на уровень выше", ($("#folderPath").textContent || "").includes("Корень"), $("#folderPath").textContent);
check("остались в приложении (не вышли)", !!doc.querySelector("#folderCard"));

// ---------- 7. Плеер не ломается без Media Session / Wake Lock ----------
const errors = [];
const { VirtualConsole } = await import("/tmp/node_modules/jsdom/lib/api.js");
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(e.message || String(e)));
vc.on("error", (m) => errors.push(String(m)));

const dom2 = new JSDOM(html, {
  url: "https://example.test/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.fetch = fakeFetch;
    const P = w.HTMLMediaElement.prototype;
    P.load = function () {}; P.play = function () { return Promise.resolve(); }; P.pause = function () {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    // navigator.mediaSession и wakeLock отсутствуют — старый Android/браузер
  },
});
await sleep(300);
const w2 = dom2.window, d2 = w2.document;
check("страница без ошибок без Media Session/Wake Lock", errors.length === 0, errors.slice(0, 3));
d2.querySelector("#urlInput").value = FOLDER;
d2.querySelector("#addForm").dispatchEvent(new w2.Event("submit", { bubbles: true, cancelable: true }));
await sleep(500);
const f2 = [...d2.querySelectorAll("#playlistList .playlist-item")].find((el) => /Введение/.test(el.textContent));
f2 && f2.dispatchEvent(new w2.MouseEvent("click", { bubbles: true }));
await sleep(400);
check("воспроизведение работает без Media Session", /Введение/.test(d2.querySelector("#trackTitle").textContent), d2.querySelector("#trackTitle").textContent);
check("мини-плеер работает без Media Session", d2.querySelector("#miniPlayer").classList.contains("show"));
check("ошибок после открытия трека нет", errors.length === 0, errors.slice(0, 3));

const failed = res.filter((r) => !r.ok);
for (const r of res) console.log((r.ok ? "✅" : "❌") + " " + r.name + (r.ok ? "" : "  → " + JSON.stringify(r.extra)));
console.log("\n" + (res.length - failed.length) + "/" + res.length + " проверок пройдено");
process.exit(failed.length ? 1 : 0);
