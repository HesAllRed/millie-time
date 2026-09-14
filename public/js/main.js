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
import { loadLook, applyLook, lookLabel, holdMotion } from "./theme.js";
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
//
// What it cannot tell us is *when*. iOS reports the new height as the keyboard
// finishes arriving, so a crescent that waits to be told shrinks after the
// keyboard has already landed — two movements, one then the other, which is
// what made tapping into a caption feel slow. The focus event comes first, so
// that is what starts the shrink; the viewport stays the authority on what the
// height actually is.
// ---------------------------------------------------------------------------
let viewportBaseline = 0;

/** One knob: wrapper height and tile scale move together, so the crescent
    always fits the space left over. */
function setCrescent(open, height) {
  body.classList.toggle("kb-open", open);
  document.documentElement.style.setProperty(
    "--cres-scale", open ? "0.55" : height < 640 ? "0.78" : "1");
  // A palette that repaints twelve times a second is competing with the
  // keyboard for the same main thread, over a screen she is about to fill with
  // her own words rather than watch. See theme.js.
  holdMotion(open);
}

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

  setCrescent(open, height);
}

// Tapping into a field is the earliest possible notice that the keyboard is on
// its way. The guard timer is for when it never comes — a hardware keyboard, or
// a desktop browser — where the viewport never moves and nothing would
// otherwise put the crescent back.
let kbGuard = null;

/**
 * Whether tapping a field will actually summon a keyboard.
 *
 * A coarse pointer is the honest test. On a desktop browser nothing moves when
 * a field takes focus, so shrinking the crescent in anticipation and putting it
 * back a moment later is a flinch for no reason.
 */
const softKeyboard = () =>
  !!window.visualViewport && !!window.matchMedia?.("(pointer: coarse)").matches;

function expectKeyboard() {
  clearTimeout(kbGuard);
  setCrescent(true, 0);
  kbGuard = setTimeout(syncViewport, 700);
}

app.addEventListener("focusin", (e) => {
  if (e.target?.classList?.contains("editor-field") && softKeyboard()) expectKeyboard();
});
app.addEventListener("focusout", (e) => {
  if (!e.target?.classList?.contains("editor-field")) return;
  if (softKeyboard()) {
    clearTimeout(kbGuard);
    // Not straight away: moving from one day's field to the next keeps the
    // keyboard up, and only the viewport knows that.
    kbGuard = setTimeout(syncViewport, 120);
  }
  schedulePrint(PRINT_SOON);          // she has stopped writing; catch up now
});

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
//
// But never while she is still typing, either. Drawing it is 30-50ms on a
// laptop and several times that on a phone, all of it on the main thread — and
// at the old 450ms it landed in every pause long enough to think, which is what
// made the caption field feel like it was catching. Nothing needs the print
// until the Send card, which is a swipe away, so it waits for her to stop.
// ---------------------------------------------------------------------------
const PRINT_AFTER  = 900;    // quiet before we even consider drawing it
const PRINT_SOON   = 250;    // she left the field — catch up
const PRINT_RETRY  = 700;    // how often to re-ask while she is still in there
const PRINT_LATEST = 3000;   // ...but it is never put off longer than this

let printFile = null;
let printSig = null;
let printTimer = null;
let lastKeystroke = 0;

const stillWriting = () =>
  !!document.activeElement?.classList?.contains("editor-field");

function schedulePrint(delay = PRINT_AFTER, now = false) {
  clearTimeout(printTimer);
  printTimer = setTimeout(async () => {
    if (!now && stillWriting() && Date.now() - lastKeystroke < PRINT_LATEST) {
      schedulePrint(PRINT_RETRY);
      return;
    }
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
  }, delay);
}

document.addEventListener("captions-changed", () => {
  lastKeystroke = Date.now();
  schedulePrint();
});

// The Send card is where the print is actually used, and arriving at it is the
// one moment worth interrupting anything for: it draws while she is reading the
// card, rather than while she is typing into the one before it. The deck says
// so on arrival — see fillSend().
document.addEventListener("print-wanted", () => schedulePrint(PRINT_SOON, true));

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

// --- the version stamp -----------------------------------------------------
//
// Two jobs, in one quiet line of type at the bottom of the screen.
//
// The escape hatch: a standalone PWA has no reload button and no URL bar, so a
// bad cached shell would trap her with no way out. Three taps clears every
// cache and hard-reloads.
//
// And the notice: when a newer version has been fetched and is sitting in the
// cache, an exclamation mark appears beside the version and one tap takes it.
// Without it the update waits for a cold launch and she has no way of knowing
// there is one — which, for an app that gets fixed in response to something she
// told you about, is the difference between "it's still doing it" and "oh, it's
// there now".
const stamp = document.getElementById("stamp");
stamp.textContent = `v${cfg.version}`;

let updateReady = false;
let taps = 0;
let tapTimer = null;

function showUpdate() {
  if (updateReady) return;
  updateReady = true;
  stamp.append(h("span", { class: "bang", text: "!" }));
  stamp.setAttribute("aria-label", `Version ${cfg.version}. An update is ready — tap to load it.`);
  record("update", "ready");
}

/**
 * Take the waiting version.
 *
 * Ours calls skipWaiting() as it installs, so by the time the mark appears the
 * new worker is usually already in charge and a reload is the whole story. The
 * message is for the version that isn't: a worker cached before that line
 * existed sits in `waiting` for ever, and a reload alone would not shift it.
 */
async function loadUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.waiting) {
      await new Promise((done) => {
        navigator.serviceWorker.addEventListener("controllerchange", done, { once: true });
        reg.waiting.postMessage("skip-waiting");
        setTimeout(done, 600);                 // never hang on it
      });
    }
  } catch { /* reload anyway — it is the part that matters */ }
  location.reload();
}

stamp.addEventListener("click", async () => {
  if (updateReady) { loadUpdate(); return; }

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
//
// The browser only checks sw.js of its own accord on a navigation and about
// once a day, which for a home-screen app that gets launched cold is usually
// enough. It is not enough for the app she left open, so coming back to it asks
// as well — throttled, because it is a request she did not ask for.
const UPDATE_CHECK_EVERY = 10 * 60 * 1000;

if ("serviceWorker" in navigator && window.isSecureContext) {
  // A controller that was already there means this page is running a version
  // that something else has now replaced. On a first install there is none, and
  // claiming it is not news.
  let hadController = !!navigator.serviceWorker.controller;
  // Optional, like every other call on this object in here: where service
  // workers are blocked or stubbed out, `navigator.serviceWorker` can be a
  // shape that has almost nothing on it — and this runs at the top level, so
  // throwing would take the rest of the file's wiring with it.
  navigator.serviceWorker.addEventListener?.("controllerchange", () => {
    if (hadController) showUpdate();
    hadController = true;
  });

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");

      // One left over from a previous visit, still waiting to be taken.
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate();

      reg.addEventListener("updatefound", () => {
        const fresh = reg.installing;
        fresh?.addEventListener("statechange", () => {
          if (fresh.state === "installed" && navigator.serviceWorker.controller) showUpdate();
        });
      });

      // Zero, not now: coming back to the app is a good moment to ask, and the
      // first time she does is the most likely to be the one that matters.
      let checkedAt = 0;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (updateReady || Date.now() - checkedAt < UPDATE_CHECK_EVERY) return;
        checkedAt = Date.now();
        reg.update().catch(() => { /* offline, or nothing to say */ });
      });
    } catch (e) {
      record("sw", e);
    }
  });
}

// Captions are the irreplaceable part, and iOS kills backgrounded PWAs freely —
// including when she flips to the camera roll to check a date. Write
// synchronously here: a debounced save would never land.
window.addEventListener("pagehide", writeSession);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { writeSession(); stopVideo(); }
});
