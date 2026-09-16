// The update mark, against a real service worker and a real deploy.
//
// Everything else in here that drives a browser goes through the harness in
// tools/harness/app.mjs, which stubs `navigator.serviceWorker` out on purpose —
// a stale shell is the last thing an ordering test needs. So this one serves
// its own copy of public/ and drives Chromium straight at it, and the "deploy"
// is a byte change to that copy, which is all a Cloudflare Pages deploy amounts
// to from the phone's point of view.
//
// It is here because the failure it guards against is silent: a mark that never
// appears looks exactly like an app with no update waiting, and the only way to
// tell them apart on a phone is to already know.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { cp, readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { hasBrowser, launch } from "../tools/harness/cdp.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

const source = fileURLToPath(new URL("../public", import.meta.url));
const runnable = await hasBrowser();
const options = { skip: runnable ? false : "no Chromium to drive" };

let root = null;       // the served copy, which the test is free to rewrite
let server = null;
let browser = null;
let page = null;
let origin = "";
let shipped = "";      // the cache name in sw.js right now
let next = "";         // and the one the "deploy" below moves it to

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  if (!runnable) return;

  root = await mkdtemp(path.join(os.tmpdir(), "millie-update-"));
  await cp(source, root, { recursive: true });

  // Read rather than written down, so a release can bump the version without
  // quietly turning this file into a test of nothing.
  const sw = await readFile(path.join(root, "sw.js"), "utf8");
  shipped = /const CACHE_VERSION = "([^"]+)"/.exec(sw)?.[1] || "";
  assert.ok(shipped, "sw.js no longer declares a CACHE_VERSION the way this test reads it");
  next = `${shipped}-next`;

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const file = url.pathname === "/"
      ? path.join(root, "index.html")
      : path.join(root, decodeURIComponent(url.pathname));
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] || "application/octet-stream",
        // What _headers promises in production, and the whole reason an update
        // can ever be noticed: sw.js is always revalidated.
        "cache-control": "no-cache",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  // 127.0.0.1 counts as a secure context, which service workers require.
  origin = `http://127.0.0.1:${server.address().port}/`;

  browser = await launch({ headless: true });
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
  server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

const stamp = () => page.eval(`
  const el = document.getElementById("stamp");
  return {
    text: el.textContent,
    bang: !!el.querySelector(".bang"),
    label: el.getAttribute("aria-label"),
  };
`);

/** Rewrite the served copy the way a deploy would. */
async function deploy() {
  const sw = path.join(root, "sw.js");
  await writeFile(sw, (await readFile(sw, "utf8")).replace(shipped, next));

  const css = path.join(root, "app.css");
  await writeFile(css, `${await readFile(css, "utf8")}\n/* the next version */\n`);
}

/** Leave the app and come back, which is what asks whether there is one. */
const returnToApp = () => page.eval(`
  for (const state of ["hidden", "visible"]) {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }
`);

test("a first install is not news", options, async () => {
  await page.goto(origin);
  await page.waitFor("navigator.serviceWorker.controller !== null",
    { timeout: 15000, label: "service worker in charge" });
  await wait(300);

  const shown = await stamp();
  assert.equal(shown.bang, false, "nothing to announce on the very first launch");
  assert.match(shown.text, /^v\d+\.\d+\.\d+$/);
  assert.deepEqual(await page.eval("return await caches.keys();"), [shipped]);
});

test("coming back to the app finds a new version and marks it", options, async () => {
  await deploy();
  await returnToApp();

  await page.waitFor('!!document.querySelector("#stamp .bang")',
    { timeout: 15000, label: "the update mark" });

  const shown = await stamp();
  assert.match(shown.text, /^v\d+\.\d+\.\d+!$/, "the version, and one exclamation mark");
  assert.match(shown.label, /update is ready/i, "and it says what it is, for a screen reader");
});

test("one tap on it loads the update", options, async () => {
  await page.eval('document.getElementById("stamp").click();');
  await wait(1200);
  await page.waitFor('document.readyState === "complete" && !!document.getElementById("stamp")',
    { timeout: 15000, label: "the reload" });

  assert.equal((await stamp()).bang, false, "nothing left to announce");
  assert.deepEqual(await page.eval("return await caches.keys();"), [next],
    "the old shell is gone, not merely shadowed");
  assert.ok(await page.eval(`
    const r = await fetch("./app.css");
    return (await r.text()).includes("the next version");
  `), "and the new files are the ones being served");
});

// The mark shares its button with the reset, so it has to leave it working.
test("three taps still clear everything out", options, async () => {
  await page.eval("window.__stillHere = true;");
  await page.eval(`
    const el = document.getElementById("stamp");
    el.click(); el.click();
  `);
  await wait(150);
  assert.equal(await page.eval("return window.__stillHere === true;"), true,
    "two taps are not three");

  await page.eval('document.getElementById("stamp").click();');
  await wait(1500);
  await page.waitFor('document.readyState === "complete" && !!document.getElementById("stamp")',
    { timeout: 15000, label: "the reload" });
  assert.equal(await page.eval("return window.__stillHere === undefined;"), true);
});
