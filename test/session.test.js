// Session persistence.
//
// These exist because the previous version pruned stored captions against the
// *current* window — and at boot the window is anchored to today, since no
// photos are loaded yet. Relaunching after iOS killed the app could therefore
// delete most of a week's writing permanently. Nothing here may ever drop a
// caption for being on the "wrong" day.

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const KEY = "millie.session.v2";
const HOUR = 3600000;

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

let S, cfg, store;

before(async () => {
  store = installLocalStorage();
  S = await import("../public/js/state.js");
  cfg = (await import("../public/js/config.js")).default;
});

beforeEach(() => {
  store.clear();
  S.state.items = [];
  S.state.captions = {};
  S.state.autoWindow = true;
});

const seed = (session) => store.set(KEY, JSON.stringify(session));
const stored = () => JSON.parse(store.get(KEY));

test("a recent session restores its captions and its window", () => {
  seed({
    savedAt: Date.now() - 2 * HOUR,
    startIso: "2026-08-10", endIso: "2026-08-17",
    autoWindow: true,
    captions: { "2026-08-10": "coffee walk", "2026-08-14": "the lake" },
  });

  S.loadSession();

  assert.equal(S.state.captions["2026-08-10"], "coffee walk");
  assert.equal(S.state.startIso, "2026-08-10");
  assert.equal(S.state.endIso, "2026-08-17");
});

test("resuming never shrinks the week to only the days written about", () => {
  seed({
    savedAt: Date.now() - HOUR,
    startIso: "2026-08-10", endIso: "2026-08-17",
    autoWindow: true,
    captions: { "2026-08-10": "only the first day so far" },
  });

  S.loadSession();

  assert.equal(S.state.endIso, "2026-08-17", "the rest of the week must stay in the deck");
  assert.equal(S.days().length, 8);
});

// The bug this file exists for.
test("loading never prunes a caption for being outside the window", () => {
  seed({
    savedAt: Date.now() - HOUR,
    startIso: "2026-08-14", endIso: "2026-08-21",
    autoWindow: true,
    captions: { "2026-08-09": "five days before the stored window" },
  });

  S.loadSession();

  assert.equal(S.state.captions["2026-08-09"], "five days before the stored window");
  assert.ok(S.days().includes("2026-08-09"), "the window stretches to cover it instead");
});

test("a stale session is dropped and the storage cleared", () => {
  seed({
    savedAt: Date.now() - (cfg.resumeWithinHours + 6) * HOUR,
    startIso: "2026-01-01", endIso: "2026-01-08",
    autoWindow: true,
    captions: { "2026-01-01": "a week from long ago" },
  });

  S.loadSession();

  assert.deepEqual(S.state.captions, {}, "an abandoned week starts fresh");
  assert.equal(store.get(KEY), undefined);
});

test("a session with a future savedAt is treated as stale, not resumed", () => {
  seed({
    savedAt: Date.now() + 10 * HOUR,       // clock change, or tampered storage
    startIso: "2026-08-10", endIso: "2026-08-17",
    captions: { "2026-08-10": "from the future" },
  });
  S.loadSession();
  assert.deepEqual(S.state.captions, {});
});

test("garbage in storage never throws", () => {
  store.set(KEY, "{ not json");
  assert.doesNotThrow(() => S.loadSession());
  store.set(KEY, JSON.stringify("a string"));
  assert.doesNotThrow(() => S.loadSession());
});

test("blank and malformed caption entries are dropped on load", () => {
  seed({
    savedAt: Date.now() - HOUR,
    startIso: "2026-08-14", endIso: "2026-08-21",
    captions: { "2026-08-15": "   ", "not-a-date": "x", "2026-08-16": "kept", "2026-08-17": 42 },
  });
  S.loadSession();
  assert.deepEqual(Object.keys(S.state.captions), ["2026-08-16"]);
});

test("writeSession round-trips the whole week", () => {
  S.state.captions = { "2026-08-16": "the lake" };
  S.state.startIso = "2026-08-12";
  S.state.endIso = "2026-08-19";
  S.state.autoWindow = false;

  S.writeSession();

  const out = stored();
  assert.equal(out.startIso, "2026-08-12");
  assert.equal(out.endIso, "2026-08-19");
  assert.equal(out.autoWindow, false);
  assert.equal(out.captions["2026-08-16"], "the lake");
  assert.ok(Date.now() - out.savedAt < 5000);
});

test("a manually pinned window survives a reload as pinned", () => {
  seed({
    savedAt: Date.now() - HOUR,
    startIso: "2026-08-11", endIso: "2026-08-18",
    autoWindow: false,
    captions: {},
  });
  S.loadSession();
  assert.equal(S.state.autoWindow, false);
  assert.equal(S.state.startIso, "2026-08-11");
});

test("clearAll wipes the week and the storage", () => {
  S.state.captions = { "2026-08-16": "the lake" };
  S.writeSession();
  assert.ok(store.get(KEY));

  S.clearAll();

  assert.deepEqual(S.state.captions, {});
  assert.equal(store.get(KEY), undefined);
  assert.equal(S.days().length, cfg.weekLength, "back to a fresh week");
});

test("unsortedCount counts only items with no day", () => {
  S.state.items = [{ day: "2026-08-16" }, { day: null }, { day: null }];
  assert.equal(S.unsortedCount(), 2);
});
