// The keyboard's arrival, and how many times the shell moves during it.
//
// This is the bug the recording showed: iOS slides the keyboard, shrinks the
// visual viewport and scrolls it down to lift the caret clear, all at once and
// all in separate events. Answering each one with a layout write sent the whole
// app to the bottom of the screen and back before it settled — three or four
// visible positions for one tap.
//
// So what is asserted here is not "the layout is right at the end" — it was
// always right at the end. It is *how many distinct positions the shell passes
// through on the way*, which is the thing an eye reads as judder. One.
//
// visualViewport cannot be driven from outside, so it is replaced before the
// app loads with one that reports whatever the test says and fires events on
// demand — in the order and at the pace a real iPhone does.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { rm } from "node:fs/promises";
import { hasBrowser } from "../tools/harness/cdp.mjs";
import { openApp } from "../tools/harness/app.mjs";
import { makeFixtures } from "../tools/harness/fixtures.mjs";

const SCREEN = 852;          // an iPhone's portrait viewport, near enough
const KEYBOARD = 336;        // and what its keyboard costs
const dir = path.join(os.tmpdir(), "millie-keyboard-fixtures");

const runnable = await hasBrowser();
const options = { skip: runnable ? false : "no Chromium to drive" };

/** A visualViewport the test can move, installed before the app's own scripts. */
const FAKE_VIEWPORT = `
(() => {
  const state = { height: ${SCREEN}, offsetTop: 0, listeners: {} };
  window.__vv = state;
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      get height() { return state.height; },
      get width() { return 393; },
      get offsetTop() { return state.offsetTop; },
      get offsetLeft() { return 0; },
      get scale() { return 1; },
      addEventListener(type, fn) { (state.listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) {
        state.listeners[type] = (state.listeners[type] || []).filter((f) => f !== fn);
      },
    },
  });

  // Every distinct geometry the shell is painted in, in order. A repeat write
  // of the same values is not a move and does not count.
  window.__moves = [];
  const read = () => [
    getComputedStyle(document.documentElement).getPropertyValue("--vvh").trim(),
    document.body.style.top,
    document.body.classList.contains("kb-open") ? "up" : "down",
  ].join(" ");
  const watch = () => {
    const now = read();
    if (now !== window.__moves[window.__moves.length - 1]) window.__moves.push(now);
    requestAnimationFrame(watch);
  };
  addEventListener("DOMContentLoaded", () => requestAnimationFrame(watch));

  // Start a fresh count from where it is standing now. Emptying the log
  // outright would record the very next frame as a move, even when nothing has
  // moved — which is the one answer this file must never get wrong.
  window.__mark = () => { window.__moves = [read()]; };

  window.__viewport = (height, offsetTop, type) => {
    state.height = height;
    state.offsetTop = offsetTop;
    for (const fn of state.listeners[type] || []) fn();
  };
})();
`;

let app = null;
let page = null;

before(async () => {
  if (!runnable) return;
  app = await openApp({});
  page = app.page;
  await page.onNewDocument(FAKE_VIEWPORT);
  // A soft keyboard only exists where the pointer is coarse, which is what the
  // app tests before it anticipates anything.
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await app.open();

  const specs = await makeFixtures(page, dir, [{ label: "one", takenAt: new Date() }]);
  await app.pick(specs.map((s) => s.file));
  await page.eval(`
    const { state, set } = await import("/js/state.js");
    state.items[0].day = state.endIso;
    set({ view: "deck", deckIndex: 0 });
  `);
  await page.waitFor('!!document.querySelector(".editor-field")', { label: "a caption field" });
});

after(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  if (!runnable) return;
  await page.eval(`
    document.activeElement?.blur?.();
    localStorage.removeItem("millie.keyboard.v1");
    window.__viewport(${SCREEN}, 0, "resize");
  `);
  await new Promise((r) => setTimeout(r, 500));   // past any settle window
});

/**
 * One keyboard arrival, the way iOS stages it: the scroll that lifts the caret
 * lands before the height has finished changing, and the height arrives in more
 * than one piece.
 */
async function raiseKeyboard() {
  await page.eval(`
    window.__mark();
    document.querySelector(".editor-field").focus();

    const step = (ms, h, top, type) => new Promise((done) => setTimeout(() => {
      window.__viewport(h, top, type);
      done();
    }, ms));

    await step(30,  ${SCREEN},              300, "scroll");   // caret lifted clear
    await step(30,  ${SCREEN - 150},        300, "resize");   // keyboard half up
    await step(60,  ${SCREEN - KEYBOARD},   ${KEYBOARD}, "resize");
    await step(80,  ${SCREEN - KEYBOARD},   0,   "scroll");   // and Safari settles
    await step(60,  ${SCREEN - KEYBOARD},   0,   "resize");
  `);
  await new Promise((r) => setTimeout(r, 700));    // past the settle window
}

/** The positions the shell has passed through since the last mark. */
const moves = () => page.eval("return window.__moves.slice(1);");

test("the first tap on a device learns what the keyboard costs", options, async () => {
  await raiseKeyboard();

  assert.equal(await page.eval(`return localStorage.getItem("millie.keyboard.v1");`),
    String(KEYBOARD), "measured from the viewport it was handed");

  const seen = await moves();
  assert.equal(seen[seen.length - 1], `${SCREEN - KEYBOARD}px 0px up`,
    "and it ends up in the right place either way");

  // It guesses on the first tap rather than standing still, precisely so this
  // holds even on a device it has never met: a shell that has already made
  // roughly the right room is one iOS has no reason to haul up the screen.
  for (const move of seen) {
    const top = Number(move.split(" ")[1].replace("px", ""));
    assert.ok(top < 40, `even the first tap must not be shoved: ${move}`);
  }
  assert.ok(seen.length <= 2, `at most a guess and a correction, not ${seen.length}`);
});

test("once it knows, the shell moves exactly once", options, async () => {
  await raiseKeyboard();                 // the tap that teaches it
  await page.eval(`
    document.activeElement.blur();
    window.__viewport(${SCREEN}, 0, "resize");
  `);
  await new Promise((r) => setTimeout(r, 600));

  await raiseKeyboard();                 // and the tap that benefits

  const seen = await moves();
  assert.deepEqual(seen, [`${SCREEN - KEYBOARD}px 0px up`],
    `the shell should pass through one position, not ${seen.length}: ${seen.join("  →  ")}`);
});

// The frame that gave the bug away: the whole app shoved to the bottom of the
// screen, because a transient offsetTop was written to the shell's top.
test("a mid-flight scroll never shoves the shell down the screen", options, async () => {
  await raiseKeyboard();
  await page.eval(`
    document.activeElement.blur();
    window.__viewport(${SCREEN}, 0, "resize");
  `);
  await new Promise((r) => setTimeout(r, 600));

  await raiseKeyboard();

  for (const move of await moves()) {
    const top = Number(move.split(" ")[1].replace("px", ""));
    assert.ok(top < 40, `the shell was pushed to ${top}px down the screen: ${move}`);
  }
});

test("letting go puts it back in one move as well", options, async () => {
  await raiseKeyboard();

  await page.eval(`
    window.__mark();
    document.activeElement.blur();

    // The keyboard slides away in pieces too.
    const step = (ms, h, type) => new Promise((done) => setTimeout(() => {
      window.__viewport(h, 0, type);
      done();
    }, ms));
    await step(40, ${SCREEN - 200}, "resize");
    await step(60, ${SCREEN},       "resize");
  `);
  await new Promise((r) => setTimeout(r, 700));

  const seen = await moves();
  assert.deepEqual(seen, [`${SCREEN}px 0px down`],
    `one move back, not ${seen.length}: ${seen.join("  →  ")}`);
});

test("a browser with a real keyboard attached is left alone", options, async () => {
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page.eval(`
    window.__mark();
    document.querySelector(".editor-field").focus();
  `);
  await new Promise((r) => setTimeout(r, 200));

  assert.deepEqual(await moves(), [], "nothing moved, because nothing was going to");
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
});
