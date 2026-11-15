// Greek words — a Telegram Mini App.
//
// Opened by the bot in one of two ways:
//   ?m=words&l=<lesson id>      the new words of a lesson, each one a plate that speaks
//   ?m=home&n=<lessons done>    games on the words of the first n lessons
// With src=kb (opened from the bot's keyboard) the results are sent back to
// the bot when the learner presses «Готово».

import { tg, inTelegram, h, mount, setChrome, plural, store, haptic, PACES, getPace, setPace, play,
         preload, stopSound, ring } from "./core.js";
import * as games from "./games.js";

const params = new URLSearchParams(location.search);
const state = {
  mode: params.get("m") || "home",
  lessonId: params.get("l"),
  done: params.has("n") ? Math.max(0, parseInt(params.get("n"), 10) || 0) : null,
  fromKeyboard: params.get("src") === "kb",
  scope: "all",
  index: null,
  lessons: new Map(),
  rounds: [],
  opened: Date.now(),
};

const GAMES = [
  { id: "cards", el: "Κάρτες", ru: "карточки: вспомни перевод", need: 1 },
  { id: "pairs", el: "Ζευγάρια", ru: "найди пары", need: 6 },
  { id: "spell", el: "Γράμματα", ru: "собери слово из букв", need: 1 },
  { id: "listen", el: "Ακούω", ru: "узнай слово на слух", need: 4 },
  { id: "blitz", el: "Γρήγορα", ru: "блиц: полминуты «да» или «нет»", need: 4 },
  { id: "letters", el: "Αλφάβητο", ru: "буквы и их звуки", need: 0 },
];

// ---- data -------------------------------------------------------------------

async function getJson(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function lesson(id) {
  if (!state.lessons.has(id)) state.lessons.set(id, await getJson(`data/lessons/${id}.json`));
  return state.lessons.get(id);
}
/** Lessons the learner has finished, in order. */
function doneLessons() {
  const all = state.index.lessons;
  return state.done === null ? all : all.slice(0, state.done);
}
/** The learner's words for the games, without repeats. */
async function pool() {
  const list = doneLessons();
  const chosen = state.scope === "last" ? list.slice(-1) : list;
  const seen = new Set(), words = [];
  for (const entry of chosen) {
    for (const w of (await lesson(entry.id)).words) {
      if (!seen.has(w.el)) { seen.add(w.el); words.push(w); }
    }
  }
  return words;
}

// ---- Telegram buttons ---------------------------------------------------------

let mainHandler = null;
function mainButton(text, handler) {
  if (!inTelegram) return null;
  if (mainHandler) tg.MainButton.offClick(mainHandler);
  mainHandler = handler;
  if (!text) { tg.MainButton.hide(); return null; }
  tg.MainButton.setText(text);
  tg.MainButton.onClick(handler);
  tg.MainButton.show();
  return null;
}
let backHandler = null;
function backButton(handler) {
  if (!inTelegram || !tg.BackButton) return;
  if (backHandler) tg.BackButton.offClick(backHandler);
  backHandler = handler;
  if (handler) { tg.BackButton.onClick(handler); tg.BackButton.show(); } else tg.BackButton.hide();
}

/** Tell the bot what was played, then close. Only works when opened from the keyboard. */
function finishSession() {
  stopSound();
  if (state.fromKeyboard && state.rounds.length && inTelegram) {
    const seconds = Math.round((Date.now() - state.opened) / 1000);
    tg.sendData(JSON.stringify({ v: 1, rounds: state.rounds.slice(-30), sec: seconds }));
  } else if (inTelegram) {
    tg.close();
  }
}

// ---- parts ----------------------------------------------------------------------

function paceControl(onChange) {
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Темп речи" });
  const paint = () => seg.replaceChildren(...PACES.map((p) =>
    h("button", { type: "button", "aria-pressed": String(p.id === getPace()),
      onclick: () => { setPace(p.id); haptic("light"); paint(); onChange?.(); } }, p.label)));
  paint();
  return seg;
}

const backLink = (text, go) => h("button", { class: "back", type: "button", onclick: go }, "‹ ", text);

// ---- the words of a lesson ----------------------------------------------------------

async function screenWords() {
  let data;
  try { data = await lesson(state.lessonId); }
  catch { return mount(h("p", { class: "empty" }, "Слова этого урока пока не загружены. Закрой окно и продолжай урок в чате.")); }
  preload(data.words.map((w) => w.a));
  setChrome(null);
  let playingAll = false;

  const rows = data.words.map((w) => {
    const node = h("button", { class: "plate", type: "button", "aria-label": `${w.el} — ${w.ru}` }, w.el);
    node.addEventListener("click", () => { playingAll = false; ring(node); haptic("light"); play(w.a); });
    return { w, node, row: h("div", { class: "word-row" }, node,
      h("div", { class: "word-note" },
        w.emoji && h("span", { class: "emoji" }, w.emoji),
        w.translit && h("span", { class: "hint" }, `[${w.translit}]`),
        h("span", {}, w.ru))) };
  });

  const all = h("button", { class: "btn", type: "button" }, "▶ Прослушать все подряд");
  all.addEventListener("click", async () => {
    if (playingAll) { playingAll = false; stopSound(); all.textContent = "▶ Прослушать все подряд"; return; }
    playingAll = true;
    all.textContent = "■ Остановить";
    for (const r of rows) {
      if (!playingAll) break;
      r.node.scrollIntoView({ block: "center", behavior: "smooth" });
      ring(r.node);
      await play(r.w.a);
      await new Promise((ok) => setTimeout(ok, 350));
    }
    playingAll = false;
    all.textContent = "▶ Прослушать все подряд";
  });

  mount(
    h("header", { class: "head" },
      h("div", {}, h("h1", { class: "title" }, "Новые слова"), h("p", { class: "sub" }, data.title))),
    h("div", { class: "stack" },
      h("div", {}, paceControl()),
      h("p", { class: "small" }, "Нажми на табличку — слово прозвучит. Повторяй вслух."),
      rows.map((r) => r.row),
      h("div", { class: "spacer" }),
      all,
      !inTelegram && h("p", { class: "small center" }, "Открой это окно из бота, чтобы вернуться к уроку.")));
  mainButton("К упражнениям", () => { stopSound(); tg.close(); });
  backButton(null);
}

// ---- home: the games ------------------------------------------------------------------

async function screenHome() {
  setChrome(null);
  const words = await pool();
  const lessons = doneLessons().length;
  const scopeChips = lessons > 1 && h("div", { class: "chips", role: "group", "aria-label": "Какие слова" },
    [["all", "Все слова"], ["last", "Последний урок"]].map(([id, label]) =>
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.scope === id),
        onclick: () => { state.scope = id; screenHome(); } }, label)));

  const plates = GAMES.map((g) => {
    const open = words.length >= g.need;
    const best = store.get(`best:${g.id}`, null);
    const under = open ? g.ru + (best ? `, рекорд ${best}` : "")
      : (lessons === 0 ? "откроется после первого урока" : `нужно слов: ${g.need}`);
    const node = h("button", { class: `plate ${open ? "" : "locked"}`, type: "button", "aria-disabled": String(!open) },
      g.el, h("span", { class: "under" }, under));
    node.addEventListener("click", () => {
      if (!open) { haptic("error"); return; }
      haptic("light");
      startGame(g, words);
    });
    return node;
  });

  const summary = lessons === 0
    ? "Слова появятся после первого урока. Буквы можно учить уже сейчас."
    : `${words.length} ${plural(words.length, "слово", "слова", "слов")} из ${lessons} ${plural(lessons, "урока", "уроков", "уроков")}`;

  mount(
    h("header", { class: "head" },
      h("div", {}, h("h1", { class: "title" }, "Игры"), h("p", { class: "sub" }, summary))),
    h("div", { class: "controls" }, paceControl(), scopeChips),
    h("div", { class: "stack" }, plates));
  backButton(null);
  mainButton(state.rounds.length && state.fromKeyboard ? "Готово" : "Закрыть", finishSession);
}

function startGame(game, words) {
  stopSound();
  mainButton(null);
  backButton(() => screenHome());
  setChrome(() => backLink("К играм", () => screenHome()));   // the same way back on every round
  games[game.id]({ pool: words, finish: (score, total) => screenResult(game, score, total, words) });
}

// ---- result ----------------------------------------------------------------------------------

function screenResult(game, score, total, words) {
  setChrome(null);
  stopSound();
  if (total > 0) state.rounds.push([game.id, score, total]);
  const ratio = total ? score / total : 0;
  const lemons = score === 0 ? 0 : ratio >= 0.9 ? 3 : ratio >= 0.7 ? 2 : 1;
  const best = store.get(`best:${game.id}`, 0);
  const record = score > best;
  if (record) store.set(`best:${game.id}`, score);
  haptic(lemons >= 2 ? "success" : "light");

  const line = game.id === "blitz" ? `${score} верных за полминуты` : `${score} из ${total}`;
  mount(
    h("div", { class: "center" },
      h("div", { class: "lemons", "aria-label": `Лимонов: ${lemons} из 3` },
        [0, 1, 2].map((k) => h("span", { class: k < lemons ? "on" : "" }, "🍋"))),
      h("div", { class: "score" }, line),
      h("p", { class: "record" }, record && score > 0 ? "Новый рекорд!" : best ? `Рекорд: ${best}` : ""),
      h("p", { class: "sub" }, `${game.el} — ${game.ru.split(":")[0]}`)),
    h("div", { class: "spacer" }),
    h("div", { class: "stack" },
      h("button", { class: "btn primary", type: "button", onclick: () => startGame(game, words) }, "Ещё раунд"),
      h("button", { class: "btn", type: "button", onclick: () => screenHome() }, "К играм")));
  backButton(() => screenHome());
  mainButton(state.fromKeyboard ? "Готово" : "Закрыть", finishSession);
}

// ---- start ---------------------------------------------------------------------------------------

async function boot() {
  if (inTelegram) {
    tg.ready();
    tg.expand();
    try { tg.disableVerticalSwipes?.(); } catch { /* old client */ }
  }
  try {
    state.index = await getJson("data/index.json");
  } catch {
    return mount(h("p", { class: "empty" }, "Не удалось загрузить слова. Проверь интернет и открой окно ещё раз."));
  }
  if (state.mode === "words" && state.lessonId) return screenWords();
  return screenHome();
}

boot();
