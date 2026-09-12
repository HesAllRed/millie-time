// Wiring. Owns the view switch, the file input, the keyboard choreography,
// and the share orchestration.

import cfg from "./config.js";
import { h, clear, orb, prefersReducedMotion } from "./ui.js";
import {
  state, set, subscribe, days, refreshWindow, unsortedCount,
  loadSession, saveSession, writeSession, clearAll,
} from "./state.js";
import { composeText, shareOrder, captureSequence, weightPlan } from "./compose.js";
import { ingest, assignDays, stopVideo, prepareForShare } from "./media.js";
import { shrinkAll } from "./resize.js";
import { renderPrint } from "./print.js";
import { copyText, runShareLadder, shareWords, sharePhotos } from "./share.js";
import { renderIntake } from "./views/intake.js";
import { renderSort, resetSort } from "./views/sort.js";
import { renderDeck, resetDeck } from "./views/deck.js";
import { renderStepper, renderSent, renderFallback } from "./views/send.js";
import { renderDebug, installLogging, record } from "./views/debug.js";
import { loadLook, applyLook, lookLabel } from "./theme.js";
import { installMenu } from "./menu.js";
import { installConfetti } from "./confetti.js";

const app = document.getElementById("app");
const body = document.getElementById("body");
const picker = document.getElementById("picker");

installLogging();

// Before anything is drawn: the whole palette is custom properties, so this is
// one write to the root element rather than a repaint of a rendered screen.
loadLook();
applyLook();
record("look", lookLabel());

loadSession();

// ---------------------------------------------------------------------------
// The keyboard is the whole ballgame.
//
// iOS does not shrink the layout viewport when the keyboard opens, so 100vh
// keeps reporting the full screen height and the crescent ends up hidden behind
// the keys — which is precisely the annoyance this app exists to remove.
// visualViewport is the only thing that tells the truth here.
// ---------------------------------------------------------------------------
let viewportBaseline = 0;

function syncViewport() {
  const vv = window.visualViewport;
  const height = Math.round(vv ? vv.height : window.innerHeight);
  const offsetTop = Math.round(vv ? vv.offsetTop : 0);

  // The tallest we have ever been is the no-keyboard height. Safer than
  // window.innerHeight, which also moves when browser chrome hides.
  viewportBaseline = Math.max(viewportBaseline, height);
  const keyboard = Math.max(0, viewportBaseline - height);
  const open = keyboard > 120;

  const root = document.documentElement;
  root.style.setProperty("--vvh", `${height}px`);

  // Follow the visual viewport down the page. Without this the shell stays
  // pinned to the layout viewport and the top of the screen disappears
  // upward as soon as the keyboard opens.
  body.style.top = `${offsetTop}px`;
  if (window.scrollY) window.scrollTo(0, 0);

  body.classList.toggle("kb-open", open);

  // One knob for the crescent: wrapper height and tile scale move together, so
  // the photos always fit the space left over.
  root.style.setProperty("--cres-scale", open ? "0.55" : height < 640 ? "0.78" : "1");
}

if (window.visualViewport) {
  visualViewport.addEventListener("resize", syncViewport);
  visualViewport.addEventListener("scroll", syncViewport);
}
window.addEventListener("orientationchange", () => {
  viewportBaseline = 0;
  setTimeout(syncViewport, 300);
});
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
    const sig = JSON.stringify(state.captions) + state.startIso + state.endIso;
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

    // Done here, while she is already watching a progress line, rather than
    // inside the share tap — which has no time to spare — or on the deck,
    // where it would stall the first thing she wants to do.
    if (cfg.resizeForShare) {
      const count = await shrinkAll(added, {
        pixels: cfg.sharePixels,
        targetBytes: cfg.shareTargetKb * 1024,
        floorBytes: cfg.shareFloorKb * 1024,
      }, (done, total) => set({ busy: { done, total, shrinking: true } }));
      const managed = added.filter((i) => i.share).length;
      record("resize", `${managed} of ${count} shrunk`);
    }

    refreshWindow();
    assignDays(state.items, new Set(days()));
    saveSession();                       // the window moved; persist it with the captions
    record("intake",
      `${added.length} added · window ${state.startIso}→${state.endIso} · ${unsortedCount()} unsorted`);
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

const MB = 1048576;

function payload() {
  const week = days();
  const text = composeText(week, state.captions, cfg);
  const ordered = shareOrder(state.items, week, cfg.videosLast);
  const stamps = captureSequence(ordered, week[week.length - 1]);

  // The print leads, keeping its descriptive "00-" name, and is the lightest
  // thing in the batch — which is exactly where the ladder wants it.
  const entries = ordered.map((item, i) => ({
    // The shrunk copy where there is one: a week of equal weights is a week of
    // ties, and ties arrive in the order we sent them. See resize.js.
    file: item.share || item.file,
    kind: item.kind,
    // A shrunk copy is always a JPEG, and already carries its date if it had one.
    container: item.share ? "jpeg" : item.container,
    hasExifDate: item.share ? !!item.takenAt : item.hasExifDate,
    // The truth, wherever the file knows it. Stamping "now" on everything is
    // what filed a clip from the 2nd under the 10th.
    time: stamps[i].getTime(),
    // Only ever for a file that doesn't already say when it was taken. A real
    // capture date is the truth and stays untouched.
    captureDate: (item.share || item.container) && !(item.share ? item.takenAt : item.hasExifDate)
      ? stamps[i] : null,
  }));
  if (printFile) entries.unshift({ file: printFile, name: printFile.name, time: Date.now() });

  // Messages lands attachments as their uploads finish, so weight is the only
  // ordering signal it acts on. See compose.js.
  const ladder = cfg.renumberOnShare && cfg.orderByWeight
    ? weightPlan(entries.map((e) => ({ size: e.file.size, kind: e.kind })), {
        stepMb: cfg.weightStepMb,
        budgetMb: cfg.maxPayloadMb,
      })
    : null;

  const photos = entries.filter((e) => !e.name).length;

  let numbered = 0;
  const files = entries.map((entry, i) => {
    if (!cfg.renumberOnShare) return entry.file;
    if (!entry.name) numbered++;             // the print keeps its own 00- name
    return prepareForShare(entry.file, {
      name: entry.name || null,
      position: numbered,
      count: photos,
      time: entry.time,
      container: entry.container,
      captureDate: entry.captureDate,
      padTo: ladder ? ladder.targets[i] : 0,
    });
  });

  const invented = entries.filter((e) => e.captureDate).length;
  const weighed = files.reduce((sum, f) => sum + f.size, 0);
  record("payload", `${files.length} files, ${invented} dated by us, ${(weighed / MB).toFixed(1)} MB`);
  record("weight", ladder
    ? `ladder step ${(ladder.step / MB).toFixed(2)} MB · ${files.map((f) => (f.size / MB).toFixed(2)).join(" ")}`
    : cfg.orderByWeight ? "NO LADDER — over budget, sending at real sizes" : "off");
  record("order", files.map((f, i) => `${i}:${f.name}`).join(" "));
  return { text, files };
}

// A successful share does NOT end the session. She sends the week to several
// people — landing on a "sent" screen after the first one means reopening the
// app to send it again. She leaves via "Finished" instead.
function handleOutcome(res) {
  record("share", JSON.stringify(res.outcome ? { outcome: res.outcome, rung: res.rung } : res));
  if (res.outcome === "sent") { set({ view: "deck", sharedOnce: true, shareStep: null }); return; }
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
    if (res.outcome === "sent") { set({ view: "deck", sharedOnce: true, shareStep: null }); return; }
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
    orb(true),
    h("p", { class: "warmline centred", text: state.busy.shrinking
      ? `Getting ${total} ${total === 1 ? "photo" : "photos"} ready to send…`
      : `iOS is getting your ${total} ${total === 1 ? "item" : "items"} ready…` }),
    h("p", { class: "helper", text: `${done} of ${total}` }),
    h("div", { class: "spacer" })
  );
}

function paint() {
  app.dataset.view = screenKey();       // lets CSS style a screen without a wrapper
  if (location.hash === "#debug") { renderDebug(app); return; }
  if (state.busy) { renderBusy(app); return; }

  switch (state.view) {
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
let lastScreen = null;
let midTransition = false;

function screenKey() {
  if (location.hash === "#debug") return "debug";
  if (state.busy) return "busy";
  return state.view;
}

/**
 * Which screen changes travel sideways instead of smearing.
 *
 * Exactly one pair: "Looks right" is the first of the run of sideways swipes
 * that carries her through the deck to "Share the week", so it should move the
 * way those do. Backwards out of the deck is the same gesture, reversed.
 * Everything else — the Continue tap included — keeps the blur.
 */
function slideDirection(from, to) {
  if (from === "sort" && to === "deck") return "fwd";
  if (from === "deck" && to === "sort") return "back";
  return null;
}

function fallbackTransition(dir, done) {
  midTransition = true;
  const nav = dir ? `nav-${dir}` : null;
  app.classList.add("leaving");
  if (nav) app.classList.add(nav);
  setTimeout(() => {
    paint();
    app.classList.remove("leaving");
    app.classList.add("entering");
    setTimeout(() => {
      app.classList.remove("entering");
      if (nav) app.classList.remove(nav);
      midTransition = false;
      done();
    }, 520);
  }, 300);
}

function render() {
  const key = screenKey();
  const changed = lastScreen !== null && key !== lastScreen;
  const dir = changed ? slideDirection(lastScreen, key) : null;
  lastScreen = key;

  if (!changed || midTransition || prefersReducedMotion()) { paint(); return; }

  // The direction rides on the root element, because that is the only thing the
  // ::view-transition pseudo-elements hang off — they are children of the root,
  // not of #app.
  const root = document.documentElement;
  if (dir) root.classList.add(`nav-${dir}`);
  const done = () => { if (dir) root.classList.remove(`nav-${dir}`); };

  if (document.startViewTransition) {
    document.startViewTransition(() => paint()).finished.then(done, done);
    return;
  }
  fallbackTransition(dir, done);
}

subscribe(render);
window.addEventListener("hashchange", render);
render();

// --- the menu --------------------------------------------------------------
installConfetti(document.getElementById("confetti"));
installMenu({
  button: document.getElementById("menubtn"),
  menu: document.getElementById("menu"),
  shell: body,
});

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

// Captions are the irreplaceable part, and iOS kills backgrounded PWAs freely —
// including when she flips to the camera roll to check a date. Write
// synchronously here: a debounced save would never land.
window.addEventListener("pagehide", writeSession);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { writeSession(); stopVideo(); }
});
