// One store. Views read from it and emit intents; nothing else mutates it.
// Deliberately tiny — this app has one user and one session.

import cfg from "./config.js";
import { isoDay, windowDays, resolveEnd } from "./dates.js";
import { activeDays } from "./compose.js";

const CAPTION_KEY = "millie.captions.v1";

const listeners = new Set();

export const state = {
  view: "intake",          // intake | sort | deck | send | sent | fallback | debug
  items: [],               // { id, file, kind, url, takenAt, day, poster }
  captions: {},            // ISO day -> text
  endIso: isoDay(new Date()),
  autoWindow: cfg.weekEndsOn === "newestPhoto",
  deckIndex: 0,
  busy: null,              // null | { label }
  playingId: null,         // at most one video is ever live
  shareStep: null,         // null | "words" | "photos"
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
  return windowDays(state.endIso, cfg.weekLength);
}

export function deckDays() {
  return activeDays(days(), state.captions, state.items);
}

/** Recompute the window end from the items, unless she pinned it manually. */
export function refreshWindow() {
  if (!state.autoWindow) return;
  state.endIso = resolveEnd(state.items, cfg.weekEndsOn);
}

// ---------------------------------------------------------------------------
// Caption autosave.
//
// Captions only — never photos. Photos would mean IndexedDB, blob serialization
// and quota handling, for something that costs her three taps to redo. Captions
// are the typed, irreplaceable part, and iOS kills backgrounded PWAs freely.
//
// Keyed by ISO day so a restore is photo-independent, and pruned to the current
// window on load so this never quietly becomes the "history" we don't want.
// ---------------------------------------------------------------------------

export function loadCaptions() {
  try {
    const raw = JSON.parse(localStorage.getItem(CAPTION_KEY) || "{}");
    const live = new Set(days());
    const kept = {};
    for (const [iso, text] of Object.entries(raw)) {
      if (live.has(iso) && typeof text === "string" && text.trim()) kept[iso] = text;
    }
    state.captions = kept;
    if (Object.keys(kept).length !== Object.keys(raw).length) saveCaptions();
  } catch {
    state.captions = {};
  }
}

let saveTimer = null;
export function saveCaptions() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(CAPTION_KEY, JSON.stringify(state.captions));
    } catch { /* private mode or full — losing autosave is survivable */ }
  }, 400);
}

export function clearAll() {
  for (const item of state.items) {
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.poster) URL.revokeObjectURL(item.poster);
  }
  state.items = [];
  state.captions = {};
  state.deckIndex = 0;
  state.playingId = null;
  state.shareStep = null;
  state.autoWindow = cfg.weekEndsOn === "newestPhoto";
  state.endIso = isoDay(new Date());
  try { localStorage.removeItem(CAPTION_KEY); } catch {}
}
