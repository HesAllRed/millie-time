// One store. Views read from it and emit intents; nothing else mutates it.
// Deliberately tiny — this app has one user and one session.

import cfg from "./config.js";
import { rangeBetween, addDays, resolveWindow } from "./dates.js";
import { activeDays } from "./compose.js";

const SESSION_KEY = "millie.session.v2";
const LEGACY_CAPTIONS_KEY = "millie.captions.v1";

const listeners = new Set();

const opening = resolveWindow({
  weekLength: cfg.weekLength,
  maxDays: cfg.maxWindowDays,
});

export const state = {
  view: "intake",          // intake | sort | deck | send | sent | fallback | debug
  items: [],               // { id, file, kind, url, takenAt, day, poster }
  captions: {},            // ISO day -> text
  startIso: opening.startIso,
  endIso: opening.endIso,
  autoWindow: cfg.weekEndsOn === "newestPhoto",
  deckIndex: 0,
  busy: null,              // null | { done, total }
  playingId: null,         // at most one video is ever live
  shareStep: null,         // null | "words" | "photos"
  sharedOnce: false,       // she can send the same week to several people
  lastError: null,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(state);
}

/** Apply a patch and re-render. */
export function set(patch) {
  Object.assign(state, patch);
  notify();
}

export function days() {
  return rangeBetween(state.startIso, state.endIso);
}

export function deckDays() {
  return activeDays(days(), state.captions, state.items);
}

export function unsortedCount() {
  return state.items.filter((i) => !i.day).length;
}

/**
 * Recompute the window from what's actually in it.
 *
 * `base` keeps an existing window covered rather than replacing it — used when
 * resuming, so a restored week can't shrink to just the days she happened to
 * have written about yet.
 */
export function refreshWindow(base = null) {
  if (!state.autoWindow) {
    // A pinned window. Nothing in the UI sets this any more — the start-day
    // picker is gone — so it arrives only from `weekEndsOn: "today"` in config,
    // or from a session saved back when the picker existed. Honour it exactly.
    state.endIso = addDays(state.startIso, cfg.weekLength - 1);
    return;
  }
  const { startIso, endIso } = resolveWindow({
    items: state.items,
    captions: state.captions,
    weekLength: cfg.weekLength,
    maxDays: cfg.maxWindowDays,
    base,
  });
  state.startIso = startIso;
  state.endIso = endIso;
}

// ---------------------------------------------------------------------------
// Session autosave.
//
// Captions and the window — never photos. Photos would mean IndexedDB, blob
// serialization and quota handling, for something that costs her three taps to
// redo. Captions are the typed, irreplaceable part, and iOS kills backgrounded
// PWAs freely.
//
// Captions are NEVER pruned against the current window. Doing that is what
// silently deleted a day's writing when the window moved, and at boot the
// window is anchored to today, so a relaunch could wipe most of a week.
// Staleness of the whole session is the only thing that clears anything.
// ---------------------------------------------------------------------------

const isIsoDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function cleanCaptions(raw) {
  const out = {};
  for (const [iso, text] of Object.entries(raw || {})) {
    if (isIsoDay(iso) && typeof text === "string" && text.trim()) out[iso] = text;
  }
  return out;
}

export function loadSession() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch { /* unreadable — treat as absent */ }

  if (!raw || typeof raw !== "object") { adoptLegacyCaptions(); return; }

  const ageHours = (Date.now() - (raw.savedAt || 0)) / 3600000;
  if (!(ageHours >= 0 && ageHours <= cfg.resumeWithinHours)) {
    // A week left for days is a finished week, not one to resume into.
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    return;
  }

  state.captions = cleanCaptions(raw.captions);
  if (raw.autoWindow === false) state.autoWindow = false;

  const base = isIsoDay(raw.startIso) && isIsoDay(raw.endIso)
    ? { startIso: raw.startIso, endIso: raw.endIso }
    : null;
  if (base) { state.startIso = base.startIso; state.endIso = base.endIso; }
  refreshWindow(base);
}

/** One-time upgrade from the v1 captions-only blob, so a week in progress survives. */
function adoptLegacyCaptions() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_CAPTIONS_KEY) || "null");
    if (legacy && typeof legacy === "object") {
      state.captions = cleanCaptions(legacy);
      refreshWindow();
      saveSession();
    }
    localStorage.removeItem(LEGACY_CAPTIONS_KEY);
  } catch { /* nothing to adopt */ }
}

let saveTimer = null;
export function saveSession() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSession, 400);
}

/** Synchronous write, for pagehide — a debounced save would never land. */
export function writeSession() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      savedAt: Date.now(),
      startIso: state.startIso,
      endIso: state.endIso,
      autoWindow: state.autoWindow,
      captions: state.captions,
    }));
  } catch { /* private mode or full — losing autosave is survivable */ }
}

export function clearAll() {
  for (const item of state.items) {
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.poster && item.poster !== item.url) URL.revokeObjectURL(item.poster);
  }
  state.items = [];
  state.captions = {};
  state.deckIndex = 0;
  state.playingId = null;
  state.shareStep = null;
  state.sharedOnce = false;
  state.autoWindow = cfg.weekEndsOn === "newestPhoto";

  const fresh = resolveWindow({ weekLength: cfg.weekLength, maxDays: cfg.maxWindowDays });
  state.startIso = fresh.startIso;
  state.endIso = fresh.endIso;

  clearTimeout(saveTimer);
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}
