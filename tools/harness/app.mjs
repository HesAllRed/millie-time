// Drives the real app in a real browser: picks files into the real <input>,
// walks the real screens, and captures exactly what navigator.share() was
// handed. Everything up to the OS boundary is testable from here.
//
// What it CANNOT tell us is what Messages does with the payload afterwards.
// That is the other half of the problem and it only exists on the phone —
// see the order probe on the #debug screen.

import { serve } from "../dev-server.mjs";
import { launch } from "./cdp.mjs";

/**
 * Replaces the share sheet with a recorder, and models the capability quirks
 * that matter: iOS routinely refuses { files, text } together while accepting
 * { files } alone, which is the entire reason the share ladder exists.
 */
function stubScript(caps) {
  return `
(() => {
  window.__caps = ${JSON.stringify(caps)};
  window.__shares = [];
  window.__canShareCalls = [];

  navigator.canShare = (data) => {
    const hasFiles = !!(data && data.files && data.files.length);
    const hasText = !!(data && typeof data.text === "string");
    window.__canShareCalls.push({ hasFiles, hasText });
    if (hasFiles && hasText) return !!window.__caps.filesWithText;
    if (hasFiles) return !!window.__caps.files;
    return !!window.__caps.text;
  };

  navigator.share = async (data) => {
    if (window.__caps.rejectWith) {
      const e = new Error(window.__caps.rejectWith);
      e.name = window.__caps.rejectWith === "AbortError" ? "AbortError" : "NotAllowedError";
      throw e;
    }
    window.__shares.push(data);
  };

  // A service worker would serve a stale shell between runs, which is the
  // last thing a harness that exists to catch ordering bugs needs.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    get: () => ({
      register: () => Promise.reject(new Error("disabled in harness")),
      getRegistrations: () => Promise.resolve([]),
    }),
  });

  // Finds the MILLIE:<label> stamp the fixtures carry, so a renamed file in
  // the payload can still be traced back to the photo it came from.
  window.__marker = (buffer) => {
    const b = new Uint8Array(buffer);
    const needle = [77, 73, 76, 76, 73, 69, 58];
    for (let i = 0; i + needle.length < b.length; i++) {
      let hit = true;
      for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) { hit = false; break; }
      if (!hit) continue;
      let s = "";
      let k = i + needle.length;
      while (k < b.length && b[k] !== 0) s += String.fromCharCode(b[k++]);
      return s;
    }
    return null;
  };
})();
`;
}

export async function openApp({ headless = true, caps = {}, hash = "" } = {}) {
  const capabilities = { filesWithText: true, files: true, text: true, ...caps };
  const server = await serve(0);
  const browser = await launch({ headless });
  const page = await browser.newPage();

  await page.onNewDocument(stubScript(capabilities));

  const app = {
    page,
    url: server.url,

    async open() {
      await page.goto(`${server.url}/${hash}`);
      await page.waitFor("document.getElementById('picker')", { label: "app shell" });
    },

    /** Hand the picker files, exactly as the change handler would see them. */
    async pick(paths) {
      await page.setFiles("#picker", paths);
      // Chrome fires change itself for setFileInputFiles, but say so out loud
      // rather than depending on it silently.
      const fired = await page.waitFor(
        "document.getElementById('app').dataset.view === 'sort' || document.getElementById('app').dataset.view === 'busy'",
        { timeout: 5000, label: "picker change handled" },
      ).catch(() => false);
      if (!fired) {
        await page.eval(`document.getElementById("picker").dispatchEvent(new Event("change"));`);
      }
      await page.waitFor("document.getElementById('app').dataset.view === 'sort'",
        { timeout: 60000, label: "sort screen (ingest finished)" });
    },

    /** What the app decided about each item, before any share happens. */
    items() {
      return page.eval(`
        const { state } = await import("/js/state.js");
        return state.items.map((i) => ({
          kind: i.kind,
          name: i.file.name,
          takenAt: i.takenAt ? i.takenAt.toISOString() : null,
          day: i.day,
        }));
      `);
    },

    window() {
      return page.eval(`
        const { state, days } = await import("/js/state.js");
        return { startIso: state.startIso, endIso: state.endIso, days: days() };
      `);
    },

    /** Move an item onto a day by hand, the way the Sort screen does. */
    async assign(name, iso) {
      await page.eval(`
        const { state, set } = await import("/js/state.js");
        const item = state.items.find((i) => i.file.name === ${JSON.stringify(name)});
        if (!item) throw new Error("no item named " + ${JSON.stringify(name)});
        item.day = ${JSON.stringify(iso)};
        set({});
      `);
    },

    async write(captions) {
      await page.eval(`
        const { state, saveSession } = await import("/js/state.js");
        Object.assign(state.captions, ${JSON.stringify(captions)});
        saveSession();
        document.dispatchEvent(new Event("captions-changed"));
      `);
    },

    async toDeck() {
      await page.eval(`
        const btns = [...document.querySelectorAll("button")];
        const go = btns.find((b) => b.textContent.includes("Looks right"));
        if (!go) throw new Error("no 'Looks right' button on the sort screen");
        go.click();
      `);
      await page.waitFor("document.getElementById('app').dataset.view === 'deck'", { label: "deck" });
      // The print is rendered ahead of the tap, on a debounce. Waiting for it
      // is the difference between testing the real payload and testing one
      // that happens to be missing its first file.
      await page.waitFor(`
        (async () => (await import("/js/views/debug.js")).log.some((l) => l.includes("[print]")))()
      `, { timeout: 15000, label: "print rendered" }).catch(() => {});
    },

    async share() {
      await page.eval(`
        const btn = document.querySelector(".card-send .btn");
        if (!btn) throw new Error("no share button on the send card");
        btn.click();
      `);
      await page.waitFor("window.__shares.length > 0 || document.getElementById('app').dataset.view === 'send' || document.getElementById('app').dataset.view === 'fallback'",
        { timeout: 15000, label: "share attempt to settle" });
    },

    /**
     * Every share call, with each file traced back to the photo it came from and
     * read back the way a receiving app would read it — including the capture
     * date, which is the whole point: if these do not ascend, an app that sorts
     * by "date taken" disagrees with the order we handed over.
     */
    payloads() {
      return page.eval(`
        const { fromJpeg, fromMp4 } = await import("/js/exif.js");
        const out = [];
        for (const share of window.__shares) {
          const files = [];
          for (const f of share.files || []) {
            const head = await f.slice(0, 262144).arrayBuffer();
            const taken = fromJpeg(head) || fromMp4(head);
            files.push({
              name: f.name,
              type: f.type,
              size: f.size,
              lastModified: f.lastModified,
              taken: taken ? taken.getTime() : null,
              from: window.__marker(head),
            });
          }
          out.push({ text: typeof share.text === "string" ? share.text : null, files });
        }
        return out;
      `);
    },

    log() {
      return page.eval(`return (await import("/js/views/debug.js")).log.slice();`);
    },

    consoleLines() { return page.consoleLines; },

    screenshot(file) { return page.screenshot(file); },

    async close() {
      await browser.close();
      await server.close();
    },
  };

  await app.open();
  return app;
}
