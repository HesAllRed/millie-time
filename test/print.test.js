// The print: which photos go on it, the choice she makes about it, and that
// the choice is honoured by the share.
//
// The first half is pure and runs anywhere. The second drives the real Send
// card in Chromium, because the two promises that matter — every style turns
// out a light image, and "off" means the print is not in the share — are only
// true if they are true of the array handed to navigator.share().

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { rm } from "node:fs/promises";
import { hasBrowser } from "../tools/harness/cdp.mjs";
import { openApp } from "../tools/harness/app.mjs";
import { makeFixtures } from "../tools/harness/fixtures.mjs";

const PREFS_KEY = "millie.print.v1";

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

let P, store;

before(async () => {
  store = installLocalStorage();
  P = await import("../public/js/print.js");
});

beforeEach(() => store.clear());

const WEEK = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
let nextId = 0;
const item = (day, kind = "photo", url = "blob:x") => ({ id: `i${nextId++}`, day, kind, url });

// --- which photos -----------------------------------------------------------

test("photos are spread across the week, not taken from the front of it", () => {
  const items = [
    item(WEEK[0]), item(WEEK[0]), item(WEEK[0]), item(WEEK[0]),
    item(WEEK[2]),
    item(WEEK[5]), item(WEEK[5]),
  ];
  const picked = P.pickPhotos(items, WEEK, 3);
  assert.deepEqual(picked.map((i) => i.day), [WEEK[0], WEEK[2], WEEK[5]],
    "one from each day before a second from any");
});

test("once every day has one, the next go round takes a second from each", () => {
  const items = [item(WEEK[0]), item(WEEK[0]), item(WEEK[0]), item(WEEK[3]), item(WEEK[3])];
  const picked = P.pickPhotos(items, WEEK, 4);
  assert.deepEqual(picked.map((i) => i.day), [WEEK[0], WEEK[0], WEEK[3], WEEK[3]]);
  assert.deepEqual(picked.map((i) => i.id), [items[0], items[1], items[3], items[4]].map((i) => i.id),
    "and keeps the order she put them in");
});

test("they come back in the order the week reads, whatever order they were added in", () => {
  const items = [item(WEEK[4]), item(WEEK[1]), item(WEEK[6]), item(WEEK[1])];
  const picked = P.pickPhotos(items, WEEK, 4);
  assert.deepEqual(picked.map((i) => i.day), [WEEK[1], WEEK[1], WEEK[4], WEEK[6]]);
});

test("a real photo is preferred over a video's poster frame on the same day", () => {
  const items = [item(WEEK[2], "video"), item(WEEK[2], "photo")];
  assert.equal(P.pickPhotos(items, WEEK, 1)[0].kind, "photo");
  assert.equal(P.photoForDay(items, WEEK[2]).kind, "photo");
});

test("nothing that cannot be drawn is picked", () => {
  const items = [item(WEEK[1], "photo", null), item(WEEK[2])];
  assert.deepEqual(P.pickPhotos(items, WEEK, 6).map((i) => i.day), [WEEK[2]]);
  assert.equal(P.photoForDay(items, WEEK[1]), null);
});

test("photos not on a day are only used when nothing on a day is drawable", () => {
  const loose = item(null);
  assert.deepEqual(P.pickPhotos([loose, item(WEEK[1])], WEEK, 2).map((i) => i.day), [WEEK[1]]);
  assert.deepEqual(P.pickPhotos([loose], WEEK, 2), [loose]);
});

test("asking for none, or having none, is an empty list", () => {
  assert.deepEqual(P.pickPhotos([item(WEEK[0])], WEEK, 0), []);
  assert.deepEqual(P.pickPhotos([], WEEK, 6), []);
});

// --- her choice -------------------------------------------------------------

test("the styles offered are the six, words first", () => {
  assert.deepEqual(P.PRINT_STYLES.map((s) => s.id),
    ["words", "strip", "beside", "mosaic", "crescent", "hero"]);
});

test("nonsense in storage falls back to a words print that is switched on", () => {
  assert.deepEqual(P.readPrintPrefs(null), { style: "words", on: true });
  assert.deepEqual(P.readPrintPrefs({ style: "collage", on: "yes" }), { style: "words", on: true });
  assert.deepEqual(P.readPrintPrefs({ style: "hero", on: false }), { style: "hero", on: false });
});

test("a choice is remembered for next time", () => {
  P.setPrintPrefs({ style: "mosaic" });
  P.setPrintPrefs({ on: false });
  assert.deepEqual(JSON.parse(store.get(PREFS_KEY)), { style: "mosaic", on: false },
    "both halves kept, neither overwriting the other");
  assert.deepEqual(P.printPrefs(), { style: "mosaic", on: false });
});

// --- in the real app --------------------------------------------------------

const runnable = await hasBrowser();
const options = { skip: runnable ? false : "no Chromium to drive" };
const dir = path.join(os.tmpdir(), "millie-print-fixtures");
after(() => rm(dir, { recursive: true, force: true }));

const DAY = 86400000;
const isoBack = (back) => {
  const d = new Date(Date.now() - back * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const at = (back, hour) => {
  const d = new Date(Date.now() - back * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/** Open the app on the Send card of a week with photos and words in it. */
async function sendCard() {
  const app = await openApp({});
  await app.page.eval(`
    window.__prints = [];
    document.addEventListener("print-ready", (e) => window.__prints.push(e.detail));
  `);
  const specs = await makeFixtures(app.page, dir, [
    { label: "a", takenAt: at(3, 9) },
    { label: "b", takenAt: at(3, 15) },
    { label: "c", takenAt: at(2, 10) },
    { label: "d", takenAt: at(1, 12) },
  ]);
  await app.pick(specs.map((s) => s.file));
  await app.write({ [isoBack(3)]: "the park, and the long way home", [isoBack(1)]: "rain 🌧️" });
  await app.toDeck();
  await app.page.eval(`document.querySelector(".dots .dot:last-child").click();`);
  await app.page.waitFor("!!document.querySelector('.card-send .switch')", { label: "send card" });
  return app;
}

/** Tap a style and wait for its print to land in the preview. */
async function choose(app, id) {
  const seen = await app.page.eval(`return window.__prints.length`);
  await app.page.eval(`
    const chip = [...document.querySelectorAll(".print-styles .chip")]
      .find((c) => c.textContent.toLowerCase() === ${JSON.stringify(id)});
    if (!chip) throw new Error("no chip for " + ${JSON.stringify(id)});
    chip.click();
  `);
  await app.page.waitFor(
    `window.__prints.length > ${seen} && window.__prints.at(-1).style === ${JSON.stringify(id)}
       && !!window.__prints.at(-1).file && !!document.querySelector(".card-send img.print-img")`,
    { timeout: 15000, label: `${id} print` });
  return app.page.eval(`
    const f = window.__prints.at(-1).file;
    return { name: f.name, type: f.type, size: f.size,
             shown: document.querySelector(".card-send img.print-img").src.startsWith("blob:") };
  `);
}

test("every style draws a print, light enough to stay first in the share", { ...options, timeout: 120000 }, async () => {
  const app = await sendCard();
  try {
    // Words first, explicitly — it is the default, so tapping it is a no-op
    // the first time, and the loop below starts from a different style.
    for (const id of ["strip", "beside", "mosaic", "crescent", "hero", "words"]) {
      const print = await choose(app, id);
      assert.ok(print.shown, `${id}: the preview is the real file`);
      assert.match(print.name, /^00-millie-time-\d{4}-\d{2}-\d{2}\.(png|jpg)$/, `${id}: still named to sort first`);
      assert.equal(print.type, id === "words" ? "image/png" : "image/jpeg", `${id}: format`);
      assert.ok(print.size < 450 * 1024, `${id}: ${Math.round(print.size / 1024)} KB is too heavy`);
    }
    assert.deepEqual(await app.page.eval(`return JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)}))`),
      { style: "words", on: true }, "and the last one chosen is the one remembered");
  } finally {
    await app.close();
  }
});

test("switching the print off takes it out of the share, and on puts it back", { ...options, timeout: 120000 }, async () => {
  const app = await sendCard();
  try {
    await choose(app, "mosaic");

    await app.page.eval(`document.querySelector(".card-send .switch").click();`);
    const off = await app.page.eval(`
      const card = document.querySelector(".card-send");
      return { chips: !!card.querySelector(".print-styles"), img: !!card.querySelector("img.print-img"),
               checked: card.querySelector(".switch").getAttribute("aria-checked"), text: card.innerText };
    `);
    assert.equal(off.checked, "false");
    assert.ok(!off.chips && !off.img, "no styles and no preview while it is off");
    assert.match(off.text, /no print/i);

    await app.share();
    let shares = await app.payloads();
    assert.ok(shares.at(-1).files.length > 0, "the photos still went");
    assert.ok(!shares.at(-1).files.some((f) => f.name.startsWith("00-")), "and the print did not");

    await app.page.eval(`document.querySelector(".card-send .switch").click();`);
    await app.page.waitFor(`!!document.querySelector(".card-send img.print-img")`, { timeout: 15000, label: "print back" });
    await app.share();
    shares = await app.payloads();
    const first = shares.at(-1).files[0];
    assert.match(first.name, /^00-millie-time-.*\.jpg$/, "back on, it leads the share again — as the mosaic she chose");
  } finally {
    await app.close();
  }
});
