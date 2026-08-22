// Wiring. Owns the view switch, the file input, the keyboard choreography,
// and the share orchestration.

import cfg from "./config.js";
import { h, clear } from "./ui.js";
import {
  state, set, subscribe, days, refreshWindow,
  loadCaptions, saveCaptions, clearAll,
} from "./state.js";
import { composeText } from "./compose.js";
import { ingest, assignDays, stopVideo } from "./media.js";
import { renderPrint } from "./print.js";
import { copyText, runShareLadder, shareWords, sharePhotos } from "./share.js";
import { renderIntake, renderWindow } from "./views/intake.js";
import { renderSort, resetSort } from "./views/sort.js";
import { renderDeck, resetDeck } from "./views/deck.js";
import { renderStepper, renderSent, renderFallback } from "./views/send.js";
import { renderDebug, installLogging, record } from "./views/debug.js";

const app = document.getElementById("app");
const body = document.getElementById("body");
const picker = document.getElementById("picker");

installLogging();
loadCaptions();

// ---------------------------------------------------------------------------
// The keyboard is the whole ballgame.
//
// iOS does not shrink the layout viewport when the keyboard opens, so 100vh
// keeps reporting the full screen height and the crescent ends up hidden behind
// the keys — which is precisely the annoyance this app exists to remove.
// visualViewport is the only thing that tells the truth here.
// ---------------------------------------------------------------------------
function syncViewport() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${Math.round(height)}px`);
  const keyboard = window.innerHeight - height;
  body.classList.toggle("kb-open", keyboard > 120);
}
if (window.visualViewport) {
  visualViewport.addEventListener("resize", syncViewport);
  visualViewport.addEventListener("scroll", syncViewport);
}
window.addEventListener("orientationchange", () => setTimeout(syncViewport, 250));
window.addEventListener("resize", syncViewport);
syncViewport();

// ---------------------------------------------------------------------------
// The print is rendered ahead of the tap, never inside it. Anything async
// between the tap and navigator.share() burns the user-activation window.
// ---------------------------------------------------------------------------
let printFile = null;
let printSig = null;
let printTimer = null;

function schedulePrint() {
  clearTimeout(printTimer);
  printTimer = setTimeout(async () => {
    const sig = JSON.stringify(state.captions) + state.endIso;
    if (sig === printSig && printFile) return;
    try {
      printFile = await renderPrint(days(), state.captions, cfg);
      printSig = sig;
      record("print", printFile ? `${printFile.size} bytes` : "empty");
    } catch (e) {
      printFile = null;
      record("print", e);
    }
  }, 450);
}
document.addEventListener("captions-changed", schedulePrint);

// --- picking ---------------------------------------------------------------

const fingerprint = (f) => `${f.name}|${f.size}|${f.lastModified}`;

function openPicker() {
  picker.value = "";           // so re-picking the same photos still fires change
  picker.click();
}

picker.addEventListener("change", async () => {
  const files = Array.from(picker.files || []);
  if (!files.length) return;

  const seen = new Set(state.items.map((i) => fingerprint(i.file)));
  const fresh = files.filter((f) => !seen.has(fingerprint(f)));
  if (!fresh.length) { set({ view: "sort" }); return; }

  set({ busy: { done: 0, total: fresh.length } });
  try {
    const added = await ingest(fresh, (done, total) => set({ busy: { done, total } }));
    state.items = state.items.concat(added);
    refreshWindow();
    assignDays(state.items, new Set(days()));
    record("intake", `${added.length} items, ${state.items.filter((i) => !i.day).length} unsorted`);
    resetSort();
    resetDeck();
    set({ busy: null, view: "sort" });
    schedulePrint();
  } catch (e) {
    record("intake", e);
    set({ busy: null, view: "sort" });
  }
});

// --- sharing ---------------------------------------------------------------

function payload() {
  const text = composeText(days(), state.captions, cfg);
  const files = state.items.map((i) => i.file);
  if (printFile) files.unshift(printFile);
  return { text, files };
}

function handleOutcome(res) {
  record("share", JSON.stringify(res.outcome ? { outcome: res.outcome, rung: res.rung } : res));
  if (res.outcome === "sent") { set({ view: "sent", shareStep: null }); return; }
  if (res.outcome === "cancelled") return;
  if (res.outcome === "stepper") { set({ view: "send", shareStep: "words" }); return; }
  set({ view: "fallback" });
}

// Note the deliberate absence of `await` before the ladder: the clipboard write
// is fired and left to settle on its own so the tap's activation survives.
function doShare() {
  const { text, files } = payload();
  copyText(text);
  if (!files.length) { set({ view: "fallback" }); return; }
  stopVideo();
  runShareLadder({ text, files }).then(handleOutcome).catch((e) => {
    record("share", e);
    set({ view: "fallback" });
  });
}

function doShareWords() {
  const { text } = payload();
  copyText(text);
  shareWords(text).then((res) => {
    if (res.outcome === "sent") { set({ shareStep: "photos" }); return; }
    if (res.outcome === "cancelled") return;
    set({ view: "fallback" });
  });
}

function doSharePhotos() {
  const { files } = payload();
  stopVideo();
  sharePhotos(files).then((res) => {
    if (res.outcome === "sent") { set({ view: "sent", shareStep: null }); return; }
    if (res.outcome === "cancelled") return;
    set({ view: "fallback" });
  });
}

// --- rendering -------------------------------------------------------------

function renderBusy(root) {
  clear(root);
  const { done, total } = state.busy;
  root.append(
    h("div", { class: "spacer" }),
    h("div", { class: "orb pulse" }),
    h("p", { class: "warmline centred", text: `iOS is getting your ${total} ${total === 1 ? "item" : "items"} ready…` }),
    h("p", { class: "helper" }, `${done} of ${total}`, h("br"), "Don't close the app."),
    h("div", { class: "spacer" })
  );
}

function paint() {
  if (location.hash === "#debug") { renderDebug(app); return; }
  if (state.busy) { renderBusy(app); return; }

  switch (state.view) {
    case "window":   renderWindow(app); break;
    case "sort":     renderSort(app, { onDone: () => { resetDeck(); set({ view: "deck", deckIndex: 0 }); schedulePrint(); }, onAddMore: openPicker }); break;
    case "deck":     renderDeck(app, { onShare: doShare }); break;
    case "send":     renderStepper(app, { onWords: doShareWords, onPhotos: doSharePhotos }); break;
    case "sent":     renderSent(app, { onNew: () => { stopVideo(); clearAll(); printFile = null; printSig = null; resetSort(); resetDeck(); set({ view: "intake" }); } }); break;
    case "fallback": renderFallback(app, { onRetry: () => set({ view: "deck" }) }); break;
    default:         renderIntake(app, { onPick: openPicker });
  }
}

// Animate only when the screen actually changes. Selecting a tile or editing a
// day re-renders too, and smearing on every one of those would be seasickness.
// Read live rather than cached, so turning Reduce Motion on in iOS Settings
// takes effect without relaunching the app.
const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let lastScreen = null;
let midTransition = false;

function screenKey() {
  if (location.hash === "#debug") return "debug";
  if (state.busy) return "busy";
  return state.view;
}

function fallbackTransition() {
  midTransition = true;
  app.classList.add("leaving");
  setTimeout(() => {
    paint();
    app.classList.remove("leaving");
    app.classList.add("entering");
    setTimeout(() => { app.classList.remove("entering"); midTransition = false; }, 280);
  }, 130);
}

function render() {
  const key = screenKey();
  const changed = lastScreen !== null && key !== lastScreen;
  lastScreen = key;

  if (!changed || midTransition || prefersReducedMotion()) { paint(); return; }
  if (document.startViewTransition) { document.startViewTransition(() => paint()); return; }
  fallbackTransition();
}

subscribe(render);
window.addEventListener("hashchange", render);
render();

// --- the escape hatch ------------------------------------------------------
//
// A standalone PWA has no reload button and no URL bar, so a bad cached shell
// would trap her with no way out. Three taps on the version stamp clears every
// cache and hard-reloads.
const stamp = document.getElementById("stamp");
stamp.textContent = `v${cfg.version}`;
let taps = 0;
let tapTimer = null;
stamp.addEventListener("click", async () => {
  taps++;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => { taps = 0; }, 1200);
  if (taps < 3) return;
  taps = 0;
  try {
    if (window.caches) for (const key of await caches.keys()) await caches.delete(key);
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    for (const reg of regs) await reg.unregister();
  } catch {}
  location.reload();
});

// --- service worker --------------------------------------------------------
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => record("sw", e));
  });
}

// Captions are the irreplaceable part; flush them if iOS is about to kill us.
window.addEventListener("pagehide", saveCaptions);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { saveCaptions(); stopVideo(); }
});
