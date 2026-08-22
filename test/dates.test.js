import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isoDay, addDays, windowDays, dayLabel, rangeLabel, resolveEnd,
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
