// Автотест логики папок в jsdom (без реального аудио и сети — API замокан)
import { JSDOM } from "/tmp/node_modules/jsdom/lib/api.js";
import fs from "fs";

const html = fs.readFileSync("/home/user/yandex-audio-player/index.html", "utf8");

const FOLDER = "https://disk.yandex.ru/d/TESTFOLDER";
const files = [
  { name: "02 Лекция 2.mp3", path: "/02 Лекция 2.mp3", type: "file", size: 20_000_000, mime_type: "audio/mpeg" },
  { name: "01 Лекция 1.mp3", path: "/01 Лекция 1.mp3", type: "file", size: 10_000_000, mime_type: "audio/mpeg" },
  { name: "10 Лекция 10.mp3", path: "/10 Лекция 10.mp3", type: "file", size: 30_000_000, mime_type: "audio/mpeg" },
  { name: "конспект.pdf", path: "/конспект.pdf", type: "file", size: 1000, mime_type: "application/pdf" },
  { name: "Сезон 2", path: "/Сезон 2", type: "dir" },
];

const calls = [];
function fakeFetch(url) {
  const u = decodeURIComponent(String(url));
  calls.push(u);
  const json = (o) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(o)) });
  if (u.includes("/public/resources/download")) {
    return json({ href: "https://downloader.disk.yandex.ru/audio/" + encodeURIComponent(u.split("path=")[1] || "x") });
  }
  if (u.includes("/public/resources")) {
    if (u.includes("&path=") && u.includes("Сезон 2")) {
      return json({ name: "Сезон 2", type: "dir", _embedded: { total: 0, items: [] } });
    }
    if (u.includes("&path=")) {
      // запрос метаданных конкретного файла — не должен случаться, но вернём файл
      return json({ name: "файл.mp3", type: "file", size: 1, mime_type: "audio/mpeg" });
    }
    return json({ name: "Лекции", type: "dir", _embedded: { total: files.length, items: files } });
  }
  return Promise.reject(new Error("unexpected url " + u));
}

const dom = new JSDOM(html, {
  url: "https://example.test/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(win) {
    win.fetch = fakeFetch;
    // Заглушки медиаэлемента
    const P = win.HTMLMediaElement.prototype;
    P.load = function () { this._loaded = true; };
    P.play = function () { this.paused = false; this.dispatchEvent(new win.Event("play")); return Promise.resolve(); };
    P.pause = function () { this.paused = true; this.dispatchEvent(new win.Event("pause")); };
    Object.defineProperty(P, "paused", { configurable: true, get() { return this._paused !== false; }, set(v) { this._paused = v; } });
    Object.defineProperty(P, "duration", { configurable: true, get() { return this._dur === undefined ? 600 : this._dur; }, set(v) { this._dur = v; } });
    Object.defineProperty(P, "currentTime", { configurable: true, get() { return this._ct || 0; }, set(v) { this._ct = v; } });
    Object.defineProperty(P, "buffered", { configurable: true, get() { return { length: 0 }; } });
    win.confirm = () => true;
    win.scrollTo = () => {};
    win.HTMLElement.prototype.scrollIntoView = () => {};
  },
});

const win = dom.window;
const doc = win.document;
const $ = (s) => doc.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond, extra }); };

await sleep(200); // init

// --- 1. Открытие ссылки на папку ---
$("#urlInput").value = FOLDER;
$("#addForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
await sleep(400);

check("карточка папки показана", !$("#folderCard").classList.contains("hidden"));
check("имя папки", /Лекции/.test($("#folderTitle").textContent), $("#folderTitle").textContent);
check("счётчик аудио", /3 аудио/.test($("#folderCount").textContent), $("#folderCount").textContent);
const items = [...doc.querySelectorAll("#playlistList .playlist-item")];
check("элементов в списке: 1 папка + 3 аудио", items.length === 4, items.length);
const titles = [...doc.querySelectorAll("#playlistList .playlist-item .title")].map((e) => e.textContent);
check("папка первой, аудио в естественном порядке", JSON.stringify(titles) === JSON.stringify(["Сезон 2", "01 Лекция 1.mp3", "02 Лекция 2.mp3", "10 Лекция 10.mp3"]), titles);
check("pdf отфильтрован", !titles.some((t) => /pdf/i.test(t)));

// --- 2. Клик по первому аудио ---
const audioItems = [...doc.querySelectorAll("#playlistList .playlist-item")].filter((el) => !el.classList.contains("folder-row"));
audioItems[0].dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
await sleep(400);

check("плеер открыт", !$("#playerCard").classList.contains("hidden"));
check("заголовок трека", $("#trackTitle").textContent === "01 Лекция 1.mp3", $("#trackTitle").textContent);
check("мета содержит папку", /Лекции/.test($("#trackMeta").textContent), $("#trackMeta").textContent);
check("src выставлен на прямую ссылку", /downloader\.disk\.yandex\.ru/.test($("#audio").src), $("#audio").src);
check("кнопка «след.» активна", !$("#nextBtn").disabled);
check("кнопка «пред.» неактивна", $("#prevBtn").disabled);
check("download-запрос содержит path файла", calls.some((c) => c.includes("path=/01 Лекция 1.mp3")), calls.filter(c=>c.includes("download")));

// --- 3. Переход вперёд ---
$("#nextBtn").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
await sleep(400);
check("переключение на следующий файл", $("#trackTitle").textContent === "02 Лекция 2.mp3", $("#trackTitle").textContent);
check("пред. теперь активна", !$("#prevBtn").disabled);

// --- 4. История ---
const histTitles = [...doc.querySelectorAll("#historyList .history-item .title")].map((e) => e.textContent);
check("в истории оба файла", histTitles.includes("01 Лекция 1.mp3") && histTitles.includes("02 Лекция 2.mp3"), histTitles);
const histMeta = [...doc.querySelectorAll("#historyList .history-item .meta")].map((e) => e.textContent);
check("в истории указана папка", histMeta.every((m) => /📁 Лекции/.test(m)), histMeta);

// --- 5. Восстановление контекста папки из истории после перезагрузки ---
const stored = JSON.parse(win.localStorage.getItem("yd-player-folder-v1"));
check("состояние папки сохранено", stored && stored.folderUrl === FOLDER && stored.items.length === files.length, stored && stored.items.length);

// --- 6. Перезагрузка страницы: список папки восстанавливается из кэша ---
const dom2 = new JSDOM(html, {
  url: "https://example.test/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(win2) {
    win2.fetch = fakeFetch;
    // перенос localStorage ДО выполнения скриптов страницы
    const keys = Object.keys(win.localStorage);
    for (const k of keys) win2.localStorage.setItem(k, win.localStorage.getItem(k));
    const P2 = win2.HTMLMediaElement.prototype;
    P2.load = function () {};
    P2.play = function () { return Promise.resolve(); };
    P2.pause = function () {};
    win2.HTMLElement.prototype.scrollIntoView = () => {};
  },
});
await sleep(300);
const doc2 = dom2.window.document;
check("после перезагрузки папка видна из кэша", !doc2.querySelector("#folderCard").classList.contains("hidden"));
check("список файлов восстановлен", doc2.querySelectorAll("#playlistList .playlist-item").length === 4);

// --- 7. Продолжение с сохранённой позиции для файла из папки ---
const key1 = FOLDER + "|||/01 Лекция 1.mp3";
const tracks = JSON.parse(win.localStorage.getItem("yd-player-tracks-v1") || "{}");
tracks[key1] = Object.assign({}, tracks[key1], { position: 300, duration: 600, folderName: "Лекции" });
win.localStorage.setItem("yd-player-tracks-v1", JSON.stringify(tracks));
// перезагружаем страницу, чтобы позиция прочиталась при открытии
const dom3 = new JSDOM(html, {
  url: "https://example.test/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(win3) {
    win3.fetch = fakeFetch;
    for (const k of Object.keys(win.localStorage)) win3.localStorage.setItem(k, win.localStorage.getItem(k));
    const P3 = win3.HTMLMediaElement.prototype;
    P3.load = function () {};
    P3.play = function () { this.paused = false; return Promise.resolve(); };
    P3.pause = function () { this.paused = true; };
    Object.defineProperty(P3, "paused", { configurable: true, get() { return this._paused !== false; }, set(v) { this._paused = v; } });
    Object.defineProperty(P3, "duration", { configurable: true, get() { return this._dur === undefined ? 600 : this._dur; }, set(v) { this._dur = v; } });
    Object.defineProperty(P3, "currentTime", { configurable: true, get() { return this._ct || 0; }, set(v) { this._ct = v; } });
    win3.HTMLElement.prototype.scrollIntoView = () => {};
  },
});
await sleep(300);
const w3 = dom3.window, d3 = w3.document;
const audioEl = d3.querySelector("#audio");
const firstAudioEl = [...d3.querySelectorAll("#playlistList .playlist-item")].find((el) => !el.classList.contains("folder-row") && /01 Лекция 1/.test(el.textContent));
check("файл с сохранённой позицией найден в списке", !!firstAudioEl);
firstAudioEl.dispatchEvent(new w3.MouseEvent("click", { bubbles: true }));
await sleep(300);
// браузер сообщает о готовности метаданных — плеер должен перемотать
audioEl.dispatchEvent(new w3.Event("loadedmetadata"));
audioEl.dispatchEvent(new w3.Event("canplay"));
await sleep(300);
check("продолжение с 05:00 внутри папки", Math.abs(audioEl.currentTime - 300) < 1, audioEl.currentTime);
check("после перемотки воспроизведение активно", !audioEl.paused);

// --- 8. Автопереход по окончании файла ---
const before = d3.querySelector("#trackTitle").textContent;
audioEl.dispatchEvent(new w3.Event("ended"));
await sleep(700);
check("автопереход на следующий файл после ended", d3.querySelector("#trackTitle").textContent !== before, d3.querySelector("#trackTitle").textContent);
check("автопереход включён по умолчанию", d3.querySelector("#autoNextChk").checked);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? "✅" : "❌") + " " + r.name + (r.ok ? "" : "  → " + JSON.stringify(r.extra)));
console.log("\n" + (results.length - failed.length) + "/" + results.length + " проверок пройдено");
process.exit(failed.length ? 1 : 0);
