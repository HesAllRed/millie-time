import { test } from "node:test";
import assert from "node:assert/strict";
import { composeText, activeDays, totalBytes, formatBytes } from "../public/js/compose.js";
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

test("totalBytes and formatBytes", () => {
  assert.equal(totalBytes([{ file: { size: 1000 } }, { file: { size: 24 } }]), 1024);
  assert.equal(totalBytes([]), 0);
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});
