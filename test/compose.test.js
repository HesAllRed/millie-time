import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeText, activeDays, dayStatus, totalBytes, formatBytes, itemsForDay, orderedItems, messageDays,
  captureSequence,
} from "../public/js/compose.js";
import { prepareForShare, orderedName, stampTime } from "../public/js/media.js";
import { windowDays, isoDay } from "../public/js/dates.js";
import { fromJpeg } from "../public/js/exif.js";

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

// The entry screen's row of dots. Writing outranks photos: a day she has written
// about reads as done whether or not anything is attached to it.
test("dayStatus reports what a day holds", () => {
  const items = [{ day: "2026-08-16" }, { day: "2026-08-19" }];
  const captions = { "2026-08-19": "both", "2026-08-20": "words only" };

  assert.equal(dayStatus("2026-08-16", captions, items), "photos");
  assert.equal(dayStatus("2026-08-20", captions, items), "written");
  assert.equal(dayStatus("2026-08-19", captions, items), "written");
  assert.equal(dayStatus("2026-08-18", captions, items), "empty");
});

test("dayStatus ignores a caption that is only whitespace", () => {
  assert.equal(dayStatus("2026-08-19", { "2026-08-19": "  " }, []), "empty");
  assert.equal(dayStatus("2026-08-19", { "2026-08-19": "  " }, [{ day: "2026-08-19" }]), "photos");
});

test("dayStatus ignores undated items, which belong to no day", () => {
  assert.equal(dayStatus("2026-08-19", {}, [{ day: null }]), "empty");
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

test("an undated item placed on a day sorts to the END of that day", () => {
  // The screenshot she moved onto Tuesday by hand has no capture time. Treating
  // that as zero put it in front of the photos actually taken that morning, and
  // did it in the deck and in the share alike.
  const items = [
    { id: "screenshot", day: "2026-08-16", takenAt: null },
    { id: "morning",    day: "2026-08-16", takenAt: at("2026-08-16", 9) },
    { id: "evening",    day: "2026-08-16", takenAt: at("2026-08-16", 20) },
  ];
  assert.deepEqual(itemsForDay(items, "2026-08-16").map((i) => i.id),
    ["morning", "evening", "screenshot"]);
  assert.deepEqual(orderedItems(items, week).map((i) => i.id),
    ["morning", "evening", "screenshot"]);
});

test("several undated items on one day keep the order she picked them in", () => {
  const items = [
    { id: "second", day: "2026-08-16", takenAt: null },
    { id: "third",  day: "2026-08-16", takenAt: null },
    { id: "first",  day: "2026-08-16", takenAt: at("2026-08-16", 9) },
  ];
  assert.deepEqual(orderedItems(items, week).map((i) => i.id), ["first", "second", "third"]);
});

test("orderedItems puts undated items last rather than first", () => {
  const items = [
    { id: "nodate", day: null, takenAt: null },
    { id: "dated", day: "2026-08-16", takenAt: at("2026-08-16", 9) },
  ];
  assert.deepEqual(orderedItems(items, week).map((i) => i.id), ["dated", "nodate"]);
});

test("orderedName zero-pads and keeps the extension", () => {
  assert.equal(orderedName(new File(["x"], "IMG_4821.HEIC", { type: "image/heic" }), 7), "07.HEIC");
  assert.equal(orderedName(new File(["x"], "clip.mov", { type: "video/quicktime" }), 12), "12.mov");
});

test("orderedName invents an extension when iOS hands over a bare name", () => {
  // A name with nothing after the dot is no better than no dot at all, and a
  // receiving app with no extension to go on treats the photo as a document.
  assert.equal(orderedName(new File(["x"], "image", { type: "image/jpeg" }), 3), "03.jpg");
  assert.equal(orderedName(new File(["x"], "trailing.", { type: "image/png" }), 3), "03.png");
  assert.equal(orderedName(new File(["x"], "clip", { type: "video/quicktime" }), 3), "03.mov");
  assert.equal(orderedName(new File(["x"], "mystery", { type: "" }), 3), "03.jpg");
});

test("orderedName widens the padding so 100 cannot sort between 10 and 11", () => {
  const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
  const names = [9, 10, 100].map((n) => orderedName(file, n, 120));
  assert.deepEqual(names, ["009.jpg", "010.jpg", "100.jpg"]);
  assert.deepEqual([...names].sort(), names, "and they still sort into send order");
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

test("prepareForShare makes names AND timestamps ascend together", () => {
  const base = 1_700_000_000_000;
  const files = ["a.jpg", "b.HEIC", "c.mov"].map((n, i) =>
    prepareForShare(new File(["x"], n, { type: "image/jpeg" }),
      { position: i + 1, count: 3, time: base + (i + 1) * 1000 }));

  assert.deepEqual(files.map((f) => f.name), ["01.jpg", "02.HEIC", "03.mov"]);
  for (let i = 1; i < files.length; i++) {
    assert.ok(files[i].lastModified > files[i - 1].lastModified,
      "anything sorting by file date must land on the same order as the names");
  }
});

test("prepareForShare overrides Safari's export timestamp rather than keeping it", () => {
  const stale = new File(["x"], "IMG_1.jpg", { type: "image/jpeg", lastModified: 999 });
  const out = prepareForShare(stale, { position: 4, count: 9, time: 1_700_000_004_000 });
  assert.notEqual(out.lastModified, 999);
  assert.equal(out.lastModified, 1_700_000_004_000);
});

// --- making every ordering rule agree --------------------------------------

test("captureSequence leaves a real capture date exactly as it is", () => {
  const morning = at("2026-08-16", 9);
  const evening = at("2026-08-16", 20);
  const out = captureSequence([{ takenAt: morning, day: "2026-08-16" },
                               { takenAt: evening, day: "2026-08-16" }], "2026-08-21");
  assert.deepEqual(out.map((d) => d.getTime()), [morning.getTime(), evening.getTime()]);
});

test("captureSequence invents a date that lands late on the item's own day", () => {
  const morning = at("2026-08-16", 9);
  const nextDay = at("2026-08-17", 8);
  const out = captureSequence([
    { takenAt: morning, day: "2026-08-16" },
    { takenAt: null,    day: "2026-08-16" },     // the hand-placed screenshot
    { takenAt: nextDay, day: "2026-08-17" },
  ], "2026-08-21");

  assert.equal(out[0].getTime(), morning.getTime());
  assert.ok(out[1] > morning, "after the photos that day that do know their time");
  assert.ok(out[1] < nextDay, "and still before the next day begins");
  assert.equal(isoDay(out[1]), "2026-08-16", "and on the day she put it on");
});

test("captureSequence is strictly ascending, so date order IS send order", () => {
  const items = [
    { takenAt: at("2026-08-16", 9), day: "2026-08-16" },
    { takenAt: null,                day: "2026-08-16" },
    { takenAt: null,                day: "2026-08-16" },
    { takenAt: at("2026-08-17", 9), day: "2026-08-17" },
    { takenAt: null,                day: null },        // a stray, sent last
  ];
  const out = captureSequence(items, "2026-08-21");
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i] > out[i - 1],
      `#${i} must be later than #${i - 1} or a date-sorting app disagrees with us`);
  }
});

test("prepareForShare writes a capture date into a photo that had none", async () => {
  const bare = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "IMG.jpg", { type: "image/jpeg" });
  assert.equal(fromJpeg(await bare.arrayBuffer()), null, "nothing to read to begin with");

  const when = at("2026-08-16", 23);
  const out = prepareForShare(bare, { position: 1, count: 4, time: 5, captureDate: when });
  const read = fromJpeg(await out.arrayBuffer());
  assert.ok(read, "and now a date-sorting app has something to sort by");
  assert.equal(read.getTime(), when.getTime());
  assert.equal(out.name, "01.jpg");
});

test("prepareForShare leaves the bytes alone when no capture date is given", async () => {
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const file = new File([original], "IMG.jpg", { type: "image/jpeg" });
  const out = prepareForShare(file, { position: 2, count: 4, time: 5 });
  assert.deepEqual(new Uint8Array(await out.arrayBuffer()), original);
});

test("stampTime keeps the name and only moves the clock", () => {
  const print = new File(["x"], "00-millie-time-2026-08-22.png", { type: "image/png" });
  const out = stampTime(print, 12345);
  assert.equal(out.name, "00-millie-time-2026-08-22.png");
  assert.equal(out.lastModified, 12345);
});
