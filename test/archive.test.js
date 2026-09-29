// The archive.
//
// Two things matter here. That a week which is put in twice — sent on Sunday,
// replaced on Monday when the next one starts — is one week and not two. And
// that a week which goes stale is kept rather than deleted, which is the hole
// this closed: before it, writing on Sunday and next opening the app on
// Wednesday lost every word, silently and for good.

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const KEY = "millie.archive.v1";
const SESSION_KEY = "millie.session.v2";
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

let A, S, store;

before(async () => {
  store = installLocalStorage();
  A = await import("../public/js/archive.js");
  S = await import("../public/js/state.js");
});

beforeEach(() => {
  store.clear();
  S.state.items = [];
  S.state.captions = {};
  S.state.autoWindow = true;
});

const week = (startIso, endIso, captions) => ({ startIso, endIso, captions });
const stored = () => JSON.parse(store.get(KEY) || "[]");

test("a week with nothing written in it is not kept", () => {
  A.keepWeek(week("2026-09-07", "2026-09-14", {}));
  A.keepWeek(week("2026-09-07", "2026-09-14", { "2026-09-08": "   " }));
  assert.deepEqual(A.archivedWeeks(), [], "blank days are not a week");
});

test("a week goes in with its words and comes back out with them", () => {
  A.keepWeek(week("2026-09-07", "2026-09-14", {
    "2026-09-08": "the park, and the long way home",
    "2026-09-11": "  first proper rain  ",
  }));

  const [kept] = A.archivedWeeks();
  assert.equal(kept.startIso, "2026-09-07");
  assert.equal(kept.captions["2026-09-08"], "the park, and the long way home");
  assert.equal(kept.captions["2026-09-11"], "first proper rain", "trimmed, not padded");
  assert.ok(kept.savedAt > 0, "and stamped, so it can be ordered");
});

// The same week arriving twice is the normal path, not an edge case: it is
// kept when she sends it, and again when she starts the next one.
test("keeping the same span twice updates it rather than duplicating it", () => {
  A.keepWeek(week("2026-09-07", "2026-09-14", { "2026-09-08": "the park" }));
  A.keepWeek(week("2026-09-07", "2026-09-14", {
    "2026-09-08": "the park", "2026-09-09": "and the day after",
  }));

  const weeks = A.archivedWeeks();
  assert.equal(weeks.length, 1, "one week, not two");
  assert.equal(Object.keys(weeks[0].captions).length, 2, "and the fuller version of it");
});

test("weeks come back newest first", () => {
  A.keepWeek(week("2026-08-31", "2026-09-07", { "2026-09-01": "older" }));
  A.keepWeek(week("2026-09-14", "2026-09-21", { "2026-09-15": "newest" }));
  A.keepWeek(week("2026-09-07", "2026-09-14", { "2026-09-08": "middle" }));

  assert.deepEqual(A.archivedWeeks().map((w) => w.endIso),
    ["2026-09-21", "2026-09-14", "2026-09-07"]);
});

test("a week can be forgotten, and only that week", () => {
  A.keepWeek(week("2026-09-07", "2026-09-14", { "2026-09-08": "one" }));
  A.keepWeek(week("2026-09-14", "2026-09-21", { "2026-09-15": "two" }));

  A.forgetWeek("2026-09-07", "2026-09-14");
  assert.deepEqual(A.archivedWeeks().map((w) => w.endIso), ["2026-09-21"]);
});

test("the archive never grows without bound", () => {
  const full = [];
  for (let i = 0; i < 12; i++) {
    full.push({ startIso: "2026-01-01", endIso: `2026-01-${String(i + 2).padStart(2, "0")}`,
                savedAt: 1, captions: { "2026-01-01": `week ${i}` } });
  }
  const capped = full.reduce((list, w) => A.addWeek(list, w, 5), []);
  assert.equal(capped.length, 5);
  assert.equal(capped[0].endIso, "2026-01-13", "and it is the oldest that goes");
});

test("nonsense in storage is skipped, not thrown over", () => {
  store.set(KEY, JSON.stringify([
    null,
    { startIso: "nope", endIso: "2026-09-14", captions: { "2026-09-08": "x" } },
    { startIso: "2026-09-21", endIso: "2026-09-14", captions: { "2026-09-08": "backwards" } },
    { startIso: "2026-09-07", endIso: "2026-09-14", captions: { "2026-09-08": "good" } },
  ]));
  const weeks = A.archivedWeeks();
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].captions["2026-09-08"], "good");

  store.set(KEY, "{not json");
  assert.deepEqual(A.archivedWeeks(), [], "and unreadable storage is an empty archive");
});

test("copying it out gives something readable", () => {
  A.keepWeek(week("2026-09-07", "2026-09-14", {
    "2026-09-08": "the park", "2026-09-11": "rain",
  }));
  const text = A.archiveText(A.archivedWeeks());
  assert.match(text, /2026-09-07 → 2026-09-14/);
  assert.match(text, /2026-09-08\s+the park/);
  assert.match(text, /2026-09-11\s+rain/);
});

// The hole this was built to close.
test("a week left too long to resume is kept instead of deleted", () => {
  store.set(SESSION_KEY, JSON.stringify({
    savedAt: Date.now() - 96 * HOUR,           // four days — well past resuming
    startIso: "2026-09-07", endIso: "2026-09-14",
    autoWindow: true,
    captions: { "2026-09-08": "the park, and the long way home" },
  }));

  S.loadSession();

  assert.deepEqual(S.state.captions, {}, "too old to resume into, as before");
  assert.equal(store.get(SESSION_KEY), undefined, "and the session is cleared, as before");

  const [kept] = A.archivedWeeks();
  assert.ok(kept, "but the words are not gone");
  assert.equal(kept.captions["2026-09-08"], "the park, and the long way home");
});

test("starting a new week keeps the one being left behind", () => {
  S.state.startIso = "2026-09-07";
  S.state.endIso = "2026-09-14";
  S.state.captions = { "2026-09-09": "swimming, then chips on the wall" };

  S.clearAll();

  assert.deepEqual(S.state.captions, {}, "the new week is empty");
  assert.equal(A.archivedWeeks()[0].captions["2026-09-09"], "swimming, then chips on the wall");
});

test("a blank week left behind does not clutter the archive", () => {
  S.state.startIso = "2026-09-07";
  S.state.endIso = "2026-09-14";
  S.state.captions = {};

  S.clearAll();
  assert.deepEqual(A.archivedWeeks(), []);
  assert.equal(stored().length, 0);
});
