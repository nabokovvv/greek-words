// Shared pieces: Telegram bridge, DOM helper, sound, storage, small utilities.

export const tg = window.Telegram?.WebApp ?? null;
// telegram-web-app.js also loads in a plain browser, where the platform is "unknown".
export const inTelegram = Boolean(tg && tg.platform && tg.platform !== "unknown");

/** h("button", {class: "btn", onclick: fn}, "text", child) */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const app = document.getElementById("app");
let leaving = [];
let chrome = null;

/** Show a screen. Anything registered with onLeave (timers) is stopped first. */
export function mount(...nodes) {
  leaving.forEach((fn) => fn());
  leaving = [];
  app.replaceChildren(...(chrome ? [chrome()] : []), ...nodes.flat().filter(Boolean));
  window.scrollTo(0, 0);
}
export function onLeave(fn) { leaving.push(fn); }
/** A node shown above every screen until changed (the way back out of a game). */
export function setChrome(make) { chrome = make; }

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const sample = (list, n) => shuffle(list).slice(0, n);

/** 1 слово, 2 слова, 5 слов */
export function plural(n, one, few, many) {
  const d = n % 10, t = n % 100;
  if (d === 1 && t !== 11) return one;
  if (d >= 2 && d <= 4 && (t < 12 || t > 14)) return few;
  return many;
}

export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("gw:" + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("gw:" + key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

export function haptic(kind) {
  const hf = tg?.HapticFeedback;
  if (!hf) return;
  try {
    if (kind === "success" || kind === "error") hf.notificationOccurred(kind);
    else hf.impactOccurred(kind || "light");
  } catch { /* old client */ }
}

// ---- sound ------------------------------------------------------------------
// The recordings are at the voice's natural pace; the browser slows them down
// without lowering the pitch, so the learner chooses the pace.

export const PACES = [
  { id: "slow", label: "медленно", rate: 0.7 },
  { id: "calm", label: "спокойно", rate: 0.85 },
  { id: "real", label: "как в жизни", rate: 1 },
];
let pace = store.get("pace", "calm");
export const getPace = () => pace;
export function setPace(id) { pace = id; store.set("pace", id); }

const sounds = new Map();
let current = null;

function sound(id) {
  if (!sounds.has(id)) {
    const a = new Audio(`audio/${id}.mp3`);
    a.preload = "auto";
    sounds.set(id, a);
  }
  return sounds.get(id);
}
/** Start loading these recordings, so a tap plays at once. */
export function preload(ids) { ids.filter(Boolean).forEach(sound); }

/** Play a recording now; resolves when it has finished (or failed). */
export function play(id) {
  if (!id) return Promise.resolve();
  const a = sound(id);
  if (current && current !== a) current.pause();
  current = a;
  const rate = (PACES.find((p) => p.id === pace) || PACES[1]).rate;
  a.pause();
  a.currentTime = 0;
  a.defaultPlaybackRate = rate;
  a.playbackRate = rate;
  a.preservesPitch = true;
  a.webkitPreservesPitch = true;
  return new Promise((resolve) => {
    const done = () => { a.removeEventListener("ended", done); a.removeEventListener("error", done); resolve(); };
    a.addEventListener("ended", done);
    a.addEventListener("error", done);
    a.play().catch(done);
  });
}
export function stopSound() { if (current) current.pause(); }

/** A plate rings once when tapped. */
export function ring(el) {
  el.classList.remove("ringing");
  void el.offsetWidth; // restart the animation
  el.classList.add("ringing");
}
export function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
