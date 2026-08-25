import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeText, activeDays, totalBytes, formatBytes, itemsForDay, orderedItems, messageDays,
} from "../public/js/compose.js";
import { renameForOrder, stampTime } from "../public/js/media.js";
import { windowDays } from "../public/js/dates.js";

const cfg = { printTitle: "This week", name: "Millie Time" };
const week = windowDays("2026-08-21", 8);

test("composeText heads the message with the title and range", () => {
  const out = composeText(week, { "2026-08-21": "nowhere to be" }, cfg);
  assert.equal(out.split("\n")[0], "This week · AUG 14 — 21");
});

test("composeText skips days with nothing written", () => {
  const out = composeText(week, {
    "2026-08-15": "coffee walk",
    "2026-08-17": "   ",
    "2026-08-19": "the lake",
  }, cfg);
  const body = out.split("\n").slice(2);
  assert.equal(body.length, 2);
  assert.match(body[0], /^SAT {2}coffee walk$/);
  assert.match(body[1], /^WED {2}the lake$/);
});

test("composeText keeps days in chronological order", () => {
  const out = composeText(week, { "2026-08-20": "later", "2026-08-15": "earlier" }, cfg);
  assert.ok(out.indexOf("earlier") < out.indexOf("later"));
});

test("composeText carries emoji through untouched", () => {
  const out = composeText(week, { "2026-08-19": "the lake 🏊 worth it 💛" }, cfg);
  assert.match(out, /the lake 🏊 worth it 💛/u);
});

test("composeText leaves no trailing blank lines", () => {
  const out = composeText(week, {}, cfg);
  assert.equal(out, "This week · AUG 14 — 21");
  assert.ok(!out.endsWith("\n"));
});

test("activeDays includes days with photos or with captions, and nothing else", () => {
  const items = [{ day: "2026-08-16" }, { day: null }];
  const captions = { "2026-08-19": "written but no photos" };
  assert.deepEqual(activeDays(week, captions, items), ["2026-08-16", "2026-08-19"]);
});

test("activeDays ignores a caption that is only whitespace", () => {
  assert.deepEqual(activeDays(week, { "2026-08-19": "  " }, []), []);
});

const at = (iso, hh, mm = 0) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

test("itemsForDay returns one day's items oldest first", () => {
  const items = [
    { id: "c", day: "2026-08-16", takenAt: at("2026-08-16", 18) },
    { id: "a", day: "2026-08-16", takenAt: at("2026-08-16", 8) },
    { id: "x", day: "2026-08-17", takenAt: at("2026-08-17", 9) },
    { id: "b", day: "2026-08-16", takenAt: at("2026-08-16", 12) },
  ];
  assert.deepEqual(itemsForDay(items, "2026-08-16").map((i) => i.id), ["a", "b", "c"]);
});

test("itemsForDay keeps pick order when capture times are missing", () => {
  const items = [
    { id: "first", day: "2026-08-16", takenAt: null },
    { id: "second", day: "2026-08-16", takenAt: null },
  ];
  assert.deepEqual(itemsForDay(items, "2026-08-16").map((i) => i.id), ["first", "second"]);
});

test("orderedItems reads the week day by day, oldest first", () => {
  const items = [
    { id: "sat", day: "2026-08-15", takenAt: at("2026-08-15", 10) },
    { id: "fri-late", day: "2026-08-14", takenAt: at("2026-08-14", 22) },
    { id: "fri-early", day: "2026-08-14", takenAt: at("2026-08-14", 7) },
  ];
  assert.deepEqual(
    orderedItems(items, week).map((i) => i.id),
    ["fri-early", "fri-late", "sat"]
  );
});

test("orderedItems puts undated items last rather than first", () => {
  const items = [
    { id: "nodate", day: null, takenAt: null },
    { id: "dated", day: "2026-08-16", takenAt: at("2026-08-16", 9) },
  ];
  assert.deepEqual(orderedItems(items, week).map((i) => i.id), ["dated", "nodate"]);
});

test("renameForOrder zero-pads and keeps the extension and type", () => {
  const file = new File(["x"], "IMG_4821.HEIC", { type: "image/heic" });
  const renamed = renameForOrder(file, 7);
  assert.equal(renamed.name, "07.HEIC");
  assert.equal(renamed.type, "image/heic");

  assert.equal(renameForOrder(new File(["x"], "clip.mov", { type: "video/quicktime" }), 12).name, "12.mov");
  assert.equal(renameForOrder(new File(["x"], "noext", { type: "" }), 3).name, "03");
});

test("totalBytes and formatBytes", () => {
  assert.equal(totalBytes([{ file: { size: 1000 } }, { file: { size: 24 } }]), 1024);
  assert.equal(totalBytes([]), 0);
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

// --- orphan captions can never be silently dropped -------------------------

test("messageDays unions the window with any captioned day, in date order", () => {
  const out = messageDays(["2026-08-16", "2026-08-17"], { "2026-08-09": "older", "2026-08-16": "in" });
  assert.deepEqual(out, ["2026-08-09", "2026-08-16", "2026-08-17"]);
});

test("messageDays ignores blank captions and tolerates no captions", () => {
  assert.deepEqual(messageDays(["2026-08-16"], { "2026-08-09": "  " }), ["2026-08-16"]);
  assert.deepEqual(messageDays(["2026-08-16"], null), ["2026-08-16"]);
});

test("composeText still carries a caption that fell outside the window", () => {
  const out = composeText(week, {
    "2026-08-09": "the day that went missing",
    "2026-08-16": "in the window",
  }, cfg);
  assert.match(out, /the day that went missing/);
  assert.match(out, /in the window/);
  assert.ok(out.indexOf("the day that went missing") < out.indexOf("in the window"),
    "and in date order");
});

test("composeText widens its header range to cover an orphan day", () => {
  const out = composeText(week, { "2026-08-09": "older than the window" }, cfg);
  assert.equal(out.split("\n")[0], "This week · AUG 9 — 21");
});

// --- share ordering --------------------------------------------------------

test("renameForOrder makes names AND timestamps ascend together", () => {
  const base = 1_700_000_000_000;
  const files = ["a.jpg", "b.HEIC", "c.mov"].map((n, i) =>
    renameForOrder(new File(["x"], n, { type: "image/jpeg" }), i + 1, base));

  assert.deepEqual(files.map((f) => f.name), ["01.jpg", "02.HEIC", "03.mov"]);
  for (let i = 1; i < files.length; i++) {
    assert.ok(files[i].lastModified > files[i - 1].lastModified,
      "Messages is reported to sort by timestamp, so these must ascend");
  }
  assert.equal(files[0].lastModified, base + 1000);
});

test("renameForOrder overrides Safari's export timestamp rather than keeping it", () => {
  const stale = new File(["x"], "IMG_1.jpg", { type: "image/jpeg", lastModified: 999 });
  const out = renameForOrder(stale, 4, 1_700_000_000_000);
  assert.notEqual(out.lastModified, 999);
  assert.equal(out.lastModified, 1_700_000_000_000 + 4000);
});

test("stampTime keeps the name and only moves the clock", () => {
  const print = new File(["x"], "00-millie-time-2026-08-22.png", { type: "image/png" });
  const out = stampTime(print, 12345);
  assert.equal(out.name, "00-millie-time-2026-08-22.png");
  assert.equal(out.lastModified, 12345);
});
