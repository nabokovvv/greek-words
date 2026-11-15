// The six games. Each takes {pool, finish} and calls finish(score, total).
// `pool` is the learner's words: {el, ru, translit, emoji, a} (a = sound id).

import { h, mount, onLeave, shuffle, sample, play, preload, ring, shake, haptic, wait, fullForm,
         nameOf } from "./core.js";

const bar = () => {
  const fill = h("i");
  const el = h("div", { class: "progress" }, fill);
  return { el, set: (done, total) => { fill.style.width = `${Math.round((100 * done) / total)}%`; } };
};

/** Keep receiving this pointer's moves even when it leaves the element. */
function capture(el, e) {
  try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
}

const plate = (text, cls = "", under = "") =>
  h("button", { class: `plate ${cls}`, type: "button" }, text, under && h("span", { class: "under" }, under));

/** Up to n other translations, all different from this word's. */
function otherRu(pool, word, n) {
  return sample([...new Set(pool.filter((w) => w.ru !== word.ru).map((w) => w.ru))], n);
}

// ---- Κάρτες: flip a card, say whether you knew it ---------------------------

export function cards({ pool, finish }) {
  const deck = sample(pool, Math.min(12, pool.length));
  preload(deck.map((w) => w.a));
  const progress = bar();
  let i = 0, known = 0;

  function show() {
    if (i >= deck.length) return finish(known, deck.length);
    const w = deck[i];
    progress.set(i, deck.length);
    const front = h("div", { class: "plate face" }, nameOf(w),
      w.translit && h("span", { class: "under" }, `[${w.translit}]`),
      h("span", { class: "tap-hint" }, "нажми, чтобы увидеть перевод"));
    const back = h("div", { class: "plate reverse face back" },
      w.emoji && h("span", { class: "emoji-big" }, w.emoji), w.ru);
    const card = h("div", { class: "card", role: "button", tabindex: "0", "aria-label": fullForm(w) }, front, back);

    let startX = null, dx = 0, flipped = false, answered = false;
    const place = () => {
      card.style.transition = startX === null ? "" : "none";
      card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)${flipped ? " rotateY(180deg)" : ""}`;
    };
    const flip = () => { flipped = !flipped; dx = 0; startX = null; place(); if (!flipped) play(w.a); haptic("light"); };
    const answer = (know) => {
      if (answered) return;
      answered = true;
      if (know) known++;
      haptic(know ? "success" : "light");
      card.style.transition = "";
      card.style.transform = "";
      card.classList.add(know ? "fly-right" : "fly-left");
      i++;
      setTimeout(show, 260);
    };
    card.addEventListener("pointerdown", (e) => { startX = e.clientX; dx = 0; capture(card, e); });
    card.addEventListener("pointermove", (e) => { if (startX !== null) { dx = e.clientX - startX; place(); } });
    card.addEventListener("pointerup", () => {
      if (startX === null) return;
      const moved = dx;
      startX = null;
      if (Math.abs(moved) < 8) return flip();
      if (Math.abs(moved) > 90) return answer(moved > 0);
      dx = 0; place();
    });
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });

    mount(progress.el,
      h("p", { class: "small" }, "Знаешь слово — смахни вправо, ещё нет — влево."),
      h("div", { class: "card-zone" }, card),
      h("div", { class: "row" },
        h("button", { class: "btn no", type: "button", onclick: () => answer(false) }, "Ещё учу"),
        h("button", { class: "btn yes", type: "button", onclick: () => answer(true) }, "Знаю")));
    play(w.a);
  }
  show();
}

// ---- Ζευγάρια: find the pairs ------------------------------------------------

export function pairs({ pool, finish }) {
  const words = [];
  for (const w of shuffle(pool)) {
    if (words.length === 6) break;
    if (!words.some((x) => x.ru === w.ru || x.el === w.el)) words.push(w);
  }
  preload(words.map((w) => w.a));
  const total = words.length;
  const spoiled = new Set();          // pairs that took more than one try
  let picked = null, matched = 0, busy = false;
  const progress = bar();

  const items = shuffle(words.flatMap((w) => [{ w, side: "el" }, { w, side: "ru" }]));
  const grid = h("div", { class: "grid2" });
  for (const item of items) {
    const el = plate(item.side === "el" ? nameOf(item.w) : item.w.ru,
      `small ${item.side === "ru" ? "reverse" : ""}`);
    item.node = el;
    el.addEventListener("click", () => tap(item));
    grid.append(el);
  }

  async function tap(item) {
    if (busy || item.done) return;
    if (item.side === "el") play(item.w.a);
    if (!picked || picked.side === item.side) {
      picked?.node.classList.remove("picked");
      picked = picked === item ? null : item;
      picked?.node.classList.add("picked");
      return;
    }
    const first = picked;
    picked = null;
    first.node.classList.remove("picked");
    if (first.w === item.w) {
      first.done = item.done = true;
      matched++;
      progress.set(matched, total);
      haptic("success");
      for (const n of [first.node, item.node]) n.classList.add("right");
      busy = true;
      await wait(320);
      for (const n of [first.node, item.node]) n.classList.add("gone");
      busy = false;
      if (matched === total) { await wait(300); finish(total - spoiled.size, total); }
    } else {
      spoiled.add(first.w.el).add(item.w.el);
      haptic("error");
      shake(first.node); shake(item.node);
    }
  }

  mount(progress.el, h("p", { class: "small" }, "Нажми на слово и на его перевод."), grid);
}

// ---- Γράμματα: build the word from letter tiles -------------------------------

const GREEK_LETTERS = "αβγδεζηθικλμνξοπρστυφχψω";
const lettersOf = (word) => Array.from(word.toLowerCase().normalize("NFC")).filter((c) => /\p{L}/u.test(c));

export function spell({ pool, finish }) {
  const fit = pool.filter((w) => !/\s/.test(w.el.trim()) && lettersOf(w.el).length >= 2 && lettersOf(w.el).length <= 9);
  const words = sample(fit, Math.min(6, fit.length));
  if (!words.length) return finish(0, 0);
  preload(words.map((w) => w.a));
  const progress = bar();
  let round = 0, clean = 0;

  function show() {
    if (round >= words.length) return finish(clean, words.length);
    const w = words[round];
    const target = lettersOf(w.el);
    const extra = sample(Array.from(GREEK_LETTERS).filter((c) => !target.includes(c)), 2);
    let mistake = false, locked = false;
    progress.set(round, words.length);

    const slots = target.map(() => ({ tile: null, node: h("div", { class: "slot" }) }));
    const tiles = shuffle([...target, ...extra]).map((letter) => ({ letter, slot: null, node: h("div", { class: "tile", role: "button", tabindex: "0" }, letter) }));

    const paint = () => {
      slots.forEach((s) => {
        s.node.textContent = s.tile ? s.tile.letter : "";
        s.node.className = "slot" + (s.tile ? " filled" : "");
      });
      tiles.forEach((t) => t.node.classList.toggle("used", t.slot !== null));
    };
    const put = (tile, slot) => {
      if (locked || tile.slot || slot.tile) return;
      tile.slot = slot; slot.tile = tile;
      haptic("light");
      paint();
      if (slots.every((s) => s.tile)) check();
    };
    const take = (slot) => {
      if (locked || !slot.tile) return;
      slot.tile.slot = null; slot.tile = null;
      paint();
    };
    async function check() {
      locked = true;
      const wrong = slots.filter((s, k) => s.tile.letter !== target[k]);
      if (!wrong.length) {
        slots.forEach((s) => s.node.classList.add("right"));
        haptic("success");
        if (!mistake) clean++;
        await Promise.race([play(w.a), wait(1600)]);
        round++;
        return show();
      }
      mistake = true;
      haptic("error");
      wrong.forEach((s) => { s.node.classList.add("wrong"); shake(s.node); });
      await wait(650);
      locked = false;
      wrong.forEach(take);
    }

    slots.forEach((s) => s.node.addEventListener("click", () => take(s)));
    tiles.forEach((t) => {
      let start = null, dragging = false;
      t.node.addEventListener("pointerdown", (e) => {
        if (t.slot || locked) return;
        start = { x: e.clientX, y: e.clientY };
        capture(t.node, e);
      });
      t.node.addEventListener("pointermove", (e) => {
        if (!start) return;
        const far = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8;
        if (!dragging && far) {
          dragging = true;
          const box = t.node.getBoundingClientRect();
          t.offset = { x: start.x - box.left, y: start.y - box.top };
          t.node.classList.add("dragging");
        }
        if (dragging) {
          t.node.style.left = `${e.clientX - t.offset.x}px`;
          t.node.style.top = `${e.clientY - t.offset.y}px`;
          slots.forEach((s) => s.node.classList.remove("over"));
          const under = slotAt(e.clientX, e.clientY);
          if (under && !under.tile) under.node.classList.add("over");
        }
      });
      const drop = (e) => {
        if (!start) return;
        const wasDragging = dragging;
        start = null; dragging = false;
        t.node.classList.remove("dragging");
        t.node.style.left = t.node.style.top = "";
        slots.forEach((s) => s.node.classList.remove("over"));
        const under = wasDragging ? slotAt(e.clientX, e.clientY) : null;
        const free = under && !under.tile ? under : slots.find((s) => !s.tile);
        if (free && (!wasDragging || under)) put(t, free);
      };
      t.node.addEventListener("pointerup", drop);
      t.node.addEventListener("pointercancel", drop);
      t.node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const free = slots.find((s) => !s.tile); if (free) put(t, free); }
      });
    });
    function slotAt(x, y) {
      return slots.find((s) => {
        const r = s.node.getBoundingClientRect();
        return x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 10 && y <= r.bottom + 10;
      });
    }

    mount(progress.el,
      h("div", { class: "center" },
        h("div", { class: "emoji-big" }, w.emoji || "🔤"),
        h("p", { class: "prompt" }, w.ru),
        h("button", { class: "chip", type: "button", onclick: () => play(w.a) },
          h("span", { "aria-hidden": "true" }, "🔊"), " послушать")),
      h("div", { class: "slots" }, w.article && h("span", { class: "art" }, w.article),
        slots.map((s) => s.node)),
      h("div", { class: "tray" }, tiles.map((t) => t.node)),
      h("div", { class: "spacer" }),
      h("p", { class: "small center" }, "Нажимай на буквы по порядку или перетаскивай их. Две буквы лишние."));
    paint();
  }
  show();
}

// ---- Ακούω: hear a word, choose what it means ----------------------------------

const SPEAKER_ICON = `<svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M11 5 6.5 9H3v6h3.5L11 19z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>
  <path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;

export function listen({ pool, finish }) {
  const rounds = sample(pool.filter((w) => w.a), Math.min(8, pool.length));
  preload(rounds.map((w) => w.a));
  const progress = bar();
  let i = 0, right = 0;

  function show() {
    if (i >= rounds.length) return finish(right, rounds.length);
    const w = rounds[i];
    progress.set(i, rounds.length);
    const options = shuffle([w.ru, ...otherRu(pool, w, 3)]);
    let answered = false;
    const nodes = options.map((ru) => {
      const el = plate(ru, "small reverse");
      el.addEventListener("click", async () => {
        if (answered) return;
        answered = true;
        const ok = ru === w.ru;
        if (ok) right++;
        haptic(ok ? "success" : "error");
        el.classList.remove("reverse");
        el.classList.add(ok ? "right" : "wrong");
        if (!ok) {
          shake(el);
          const good = nodes[options.indexOf(w.ru)];
          good.classList.remove("reverse");
          good.classList.add("right");
        }
        await wait(ok ? 650 : 1300);
        i++;
        show();
      });
      return el;
    });
    const speaker = h("button", { class: "speaker", type: "button", "aria-label": "Послушать ещё раз",
      onclick: () => play(w.a) });
    speaker.innerHTML = SPEAKER_ICON;
    mount(progress.el,
      h("p", { class: "small center" }, "Что ты слышишь?"), speaker,
      h("div", { class: "grid2" }, nodes));
    play(w.a);
  }
  show();
}

// ---- Γρήγορα: thirty seconds of yes or no ---------------------------------------

const BLITZ_SECONDS = 30;

export function blitz({ pool, finish }) {
  preload(pool.slice(0, 40).map((w) => w.a));
  let right = 0, asked = 0, left = BLITZ_SECONDS, over = false;
  const fill = h("i", { style: { width: "100%" } });
  const timer = h("div", { class: "progress timer" }, fill);
  const zone = h("div", { class: "stack" });
  const count = h("p", { class: "small center" }, "");

  const tick = setInterval(() => {
    left--;
    fill.style.width = `${Math.max(0, (100 * left) / BLITZ_SECONDS)}%`;
    if (left <= 0) end();
  }, 1000);
  function end() {
    if (over) return;
    over = true;
    clearInterval(tick);
    finish(right, Math.max(asked, 1));
  }

  function next() {
    if (over) return;
    const w = pool[Math.floor(Math.random() * pool.length)];
    const others = otherRu(pool, w, 1);
    const truth = Math.random() < 0.5 || !others.length;
    const shown = truth ? w.ru : others[0];
    const top = h("div", { class: "plate" }, nameOf(w));
    const bottom = h("div", { class: "plate small reverse" }, shown);
    const answer = (yes) => {
      if (over) return;
      asked++;
      const ok = yes === truth;
      if (ok) right++;
      haptic(ok ? "light" : "error");
      count.textContent = `Верно: ${right}`;
      top.classList.add(ok ? "right" : "wrong");
      if (!ok) shake(top);
      setTimeout(next, ok ? 140 : 420);
    };
    zone.replaceChildren(top, h("p", { class: "small center" }, "это значит"), bottom,
      h("div", { class: "spacer" }),
      h("div", { class: "row" },
        h("button", { class: "btn no", type: "button", onclick: () => answer(false) }, "Нет"),
        h("button", { class: "btn yes", type: "button", onclick: () => answer(true) }, "Да")));
  }

  mount(timer, zone, count);
  onLeave(() => { over = true; clearInterval(tick); });   // after mount: mount runs the previous screen's leavers
  requestAnimationFrame(() => { fill.style.width = `${(100 * (BLITZ_SECONDS - 1)) / BLITZ_SECONDS}%`; });
  next();
}

// ---- Άρθρα: ο, η or το? ----------------------------------------------------------

export const SINGULAR = ["ο", "η", "το"];
const GENDER = { "ο": "он", "η": "она", "το": "оно" };

export function articles({ pool, finish }) {
  const nouns = pool.filter((w) => SINGULAR.includes(w.article));
  const rounds = sample(nouns, Math.min(10, nouns.length));
  preload(rounds.map((w) => w.a));
  const progress = bar();
  let i = 0, right = 0;

  function show() {
    if (i >= rounds.length) return finish(right, rounds.length);
    const w = rounds[i];
    progress.set(i, rounds.length);
    let answered = false;
    const word = h("div", { class: "plate" }, w.el, h("span", { class: "under" }, w.ru));
    const tiles = SINGULAR.map((article) => {
      const el = h("button", { class: "tile wide", type: "button", "aria-label": `${article} — ${GENDER[article]}` }, article);
      el.addEventListener("click", async () => {
        if (answered) return;
        answered = true;
        const ok = article === w.article;
        if (ok) right++;
        haptic(ok ? "success" : "error");
        el.classList.add(ok ? "right" : "wrong");
        if (!ok) { shake(el); tiles[SINGULAR.indexOf(w.article)].classList.add("right"); }
        word.replaceChildren(nameOf(w), h("span", { class: "under" }, `${w.ru} — ${GENDER[w.article]}`));
        await Promise.race([play(w.a), wait(1800)]);   // hear it with the right article
        await wait(ok ? 250 : 700);
        i++;
        show();
      });
      return el;
    });
    mount(progress.el,
      h("div", { class: "center" },
        h("div", { class: "emoji-big" }, w.emoji || "🏷"),
        h("p", { class: "small" }, "Какой артикль у этого слова?")),
      word,
      h("div", { class: "spacer" }),
      h("div", { class: "tray" }, tiles),
      h("div", { class: "spacer" }),
      h("p", { class: "small center" }, "ο — он, η — она, το — оно"));
  }
  show();
}

// ---- Αλφάβητο: a letter and its sound --------------------------------------------

export const ALPHABET = [
  ["Α α", "а"], ["Β β", "в"], ["Γ γ", "г, как в «ага»"], ["Δ δ", "д, как th в this"], ["Ε ε", "э"],
  ["Ζ ζ", "з"], ["Η η", "и"], ["Θ θ", "ф, как th в think"], ["Ι ι", "и"], ["Κ κ", "к"],
  ["Λ λ", "л"], ["Μ μ", "м"], ["Ν ν", "н"], ["Ξ ξ", "кс"], ["Ο ο", "о"],
  ["Π π", "п"], ["Ρ ρ", "р"], ["Σ σ ς", "с"], ["Τ τ", "т"], ["Υ υ", "и"],
  ["Φ φ", "ф"], ["Χ χ", "х"], ["Ψ ψ", "пс"], ["Ω ω", "о"],
];

export function letters({ finish }) {
  const rounds = sample(ALPHABET, 10);
  const sounds = [...new Set(ALPHABET.map(([, s]) => s))];
  const progress = bar();
  let i = 0, right = 0;

  function show() {
    if (i >= rounds.length) return finish(right, rounds.length);
    const [letter, soundOf] = rounds[i];
    progress.set(i, rounds.length);
    const options = shuffle([soundOf, ...sample(sounds.filter((s) => s !== soundOf), 3)]);
    let answered = false;
    const nodes = options.map((s) => {
      const el = plate(s, "small reverse");
      el.addEventListener("click", async () => {
        if (answered) return;
        answered = true;
        const ok = s === soundOf;
        if (ok) right++;
        haptic(ok ? "success" : "error");
        el.classList.remove("reverse");
        el.classList.add(ok ? "right" : "wrong");
        if (!ok) {
          shake(el);
          const good = nodes[options.indexOf(soundOf)];
          good.classList.remove("reverse");
          good.classList.add("right");
        }
        await wait(ok ? 550 : 1300);
        i++;
        show();
      });
      return el;
    });
    mount(progress.el,
      h("div", { class: "center" },
        h("p", { class: "small" }, "Как читается эта буква?"),
        h("div", { class: "tile big", style: { margin: "10px 0 24px", fontSize: letter.length > 3 ? "40px" : "" } }, letter)),
      h("div", { class: "grid2" }, nodes));
  }
  show();
}
