import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isoDay, addDays, windowDays, dayLabel, rangeLabel, resolveEnd,
  rangeBetween, daysBetween, resolveWindow,
} from "../public/js/dates.js";

test("isoDay uses local calendar fields, not UTC", () => {
  assert.equal(isoDay(new Date(2026, 7, 21, 23, 30)), "2026-08-21");
  assert.equal(isoDay(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("addDays survives a daylight-saving transition", () => {
  // Dates are anchored at local noon precisely so a 23- or 25-hour day cannot
  // push the result onto the wrong date.
  for (const start of ["2026-03-07", "2026-03-08", "2026-10-31", "2026-11-01"]) {
    const forward = addDays(start, 1);
    assert.equal(addDays(forward, -1), start, `round trip failed at ${start}`);
  }
});

test("windowDays returns an inclusive ascending run ending on endIso", () => {
  const days = windowDays("2026-08-21", 8);
  assert.equal(days.length, 8);
  assert.equal(days[0], "2026-08-14");
  assert.equal(days[7], "2026-08-21");
  for (let i = 1; i < days.length; i++) {
    assert.equal(days[i], addDays(days[i - 1], 1));
  }
});

test("dayLabel reports weekday and short date", () => {
  const label = dayLabel("2026-08-21");
  assert.equal(label.wd, "FRI");
  assert.equal(label.dm, "AUG 21");
  assert.equal(label.day, 21);
});

test("rangeLabel collapses within a month and expands across one", () => {
  assert.equal(rangeLabel(windowDays("2026-08-21", 8)), "AUG 14 — 21");
  assert.equal(rangeLabel(windowDays("2026-09-02", 8)), "AUG 26 — SEP 2");
  assert.equal(rangeLabel([]), "");
});

test("resolveEnd follows the newest dated item", () => {
  const items = [
    { takenAt: new Date(2026, 7, 15, 9) },
    { takenAt: new Date(2026, 7, 19, 18) },
    { takenAt: null },
  ];
  assert.equal(resolveEnd(items, "newestPhoto"), "2026-08-19");
});

test("resolveEnd falls back to today when nothing is dated", () => {
  const now = new Date(2026, 7, 21, 10);
  assert.equal(resolveEnd([{ takenAt: null }], "newestPhoto", now), "2026-08-21");
  assert.equal(resolveEnd([], "newestPhoto", now), "2026-08-21");
});

test("resolveEnd ignores item dates in today mode", () => {
  const now = new Date(2026, 7, 21, 10);
  const items = [{ takenAt: new Date(2026, 6, 1) }];
  assert.equal(resolveEnd(items, "today", now), "2026-08-21");
});

// --- the window ------------------------------------------------------------

const item = (iso, h = 12) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { takenAt: new Date(y, m - 1, d, h) };
};
const WEEK = { weekLength: 8, maxDays: 21 };

test("rangeBetween is inclusive and ascending", () => {
  assert.deepEqual(rangeBetween("2026-08-20", "2026-08-23"),
    ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"]);
  assert.deepEqual(rangeBetween("2026-08-20", "2026-08-20"), ["2026-08-20"]);
  // Reversed input must still yield a usable day rather than an empty deck.
  assert.deepEqual(rangeBetween("2026-08-25", "2026-08-20"), ["2026-08-20"]);
});

test("daysBetween counts whole days in both directions", () => {
  assert.equal(daysBetween("2026-08-15", "2026-08-22"), 7);
  assert.equal(daysBetween("2026-08-22", "2026-08-15"), -7);
  assert.equal(daysBetween("2026-08-22", "2026-08-22"), 0);
});

test("resolveWindow with no content is weekLength days ending today", () => {
  const now = new Date(2026, 7, 22, 10);
  assert.deepEqual(resolveWindow({ ...WEEK, now }),
    { startIso: "2026-08-15", endIso: "2026-08-22" });
});

// THE REGRESSION. Adding a photo newer than the newest used to slide the whole
// window forward and drop the oldest day, taking its photos and caption with it.
test("resolveWindow grows forward without dropping the oldest day", () => {
  const monday = "2026-08-10";
  const items = [item(monday), item("2026-08-13"), item("2026-08-16")];
  const captions = { [monday]: "coffee walk" };

  const before = resolveWindow({ ...WEEK, items, captions });
  assert.ok(rangeBetween(before.startIso, before.endIso).includes(monday));

  // …now she adds one taken two days after the previous newest.
  const after = resolveWindow({ ...WEEK, items: [...items, item("2026-08-18")], captions });
  const span = rangeBetween(after.startIso, after.endIso);
  assert.ok(span.includes(monday), "Monday must survive a newer photo");
  assert.ok(span.includes("2026-08-18"), "and the new photo must be covered");
  assert.equal(after.startIso, monday);
  assert.equal(after.endIso, "2026-08-18");
});

test("resolveWindow keeps a captioned day even with no photo on it", () => {
  const items = [item("2026-08-20")];
  const captions = { "2026-08-05": "written long before anything was picked" };
  const { startIso, endIso } = resolveWindow({ ...WEEK, items, captions });
  assert.ok(rangeBetween(startIso, endIso).includes("2026-08-05"));
});

test("resolveWindow never shrinks below weekLength", () => {
  const { startIso, endIso } = resolveWindow({ ...WEEK, items: [item("2026-08-22")] });
  assert.equal(rangeBetween(startIso, endIso).length, 8);
  assert.equal(endIso, "2026-08-22");
});

test("resolveWindow clamps a stray ancient photo at maxDays", () => {
  const items = [item("2025-01-01"), item("2026-08-22")];
  const { startIso, endIso } = resolveWindow({ ...WEEK, items });
  const span = rangeBetween(startIso, endIso);
  assert.equal(span.length, 21);
  assert.equal(endIso, "2026-08-22");
  assert.ok(!span.includes("2025-01-01"), "the outlier stays unsorted, not stretching the deck");
});

test("resolveWindow keeps a base window covered when resuming", () => {
  // Restored week ran Mon-Sun, but only Monday has been written about so far.
  const base = { startIso: "2026-08-15", endIso: "2026-08-22" };
  const captions = { "2026-08-15": "just the first day so far" };
  const { startIso, endIso } = resolveWindow({ ...WEEK, captions, base });
  assert.equal(startIso, "2026-08-15");
  assert.equal(endIso, "2026-08-22", "resuming must not shrink the week to what she's written");
});
