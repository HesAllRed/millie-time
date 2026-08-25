// #debug — the on-device diagnostics screen.
//
// Safari's remote inspector needs a Mac, and this project is built on Windows,
// so there is no console on the phone. This screen is the substitute: it reports
// what the device actually did, and COPY DIAGNOSTICS puts the lot on the
// clipboard so it can be pasted straight back into a chat.

import cfg from "../config.js";
import { h, clear } from "../ui.js";
import { state, set, days, unsortedCount } from "../state.js";
import { copyText } from "../share.js";
import { formatBytes, orderedItems } from "../compose.js";
import { renameForOrder } from "../media.js";

/**
 * Exactly what the share would send, in order. If photos still arrive scrambled
 * after this, the manifest says whether we sent them wrong or Messages
 * reordered them — which is the difference between our bug and Apple's.
 */
function shareManifest() {
  const base = 1000000000000;   // fixed, so the listing is stable to read
  return orderedItems(state.items, days()).map((item, i) => {
    const f = renameForOrder(item.file, i + 1, base);
    return { pos: i + 1, name: f.name, day: item.day || "unsorted", stamp: f.lastModified };
  });
}

export const log = [];
const MAX_LOG = 120;

export function record(kind, ...args) {
  const line = `${new Date().toISOString().slice(11, 19)} [${kind}] ` +
    args.map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === "object") { try { return JSON.stringify(a); } catch { return "[object]"; } }
      return String(a);
    }).join(" ");
  log.push(line);
  if (log.length > MAX_LOG) log.shift();
}

/** Install global capture. Called once at boot. */
export function installLogging() {
  window.addEventListener("error", (e) => record("error", e.message, `${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => record("reject", e.reason));
  const realError = console.error.bind(console);
  console.error = (...a) => { record("console", ...a); realError(...a); };
  record("boot", `v${cfg.version}`);
}

function probes() {
  const sample = new File([new Uint8Array([1, 2, 3])], "probe.png", { type: "image/png" });
  const can = (payload) => {
    try { return navigator.canShare ? String(navigator.canShare(payload)) : "no canShare"; }
    catch (e) { return `threw ${e.name}`; }
  };
  return [
    ["share()", typeof navigator.share === "function" ? "yes" : "NO"],
    ["canShare {text}", can({ text: "hi" })],
    ["canShare {files}", can({ files: [sample] })],
    ["canShare {files,text}", can({ files: [sample], text: "hi" })],
    ["standalone", String(window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true)],
    ["secure context", String(window.isSecureContext)],
    ["service worker", "serviceWorker" in navigator ? "yes" : "NO"],
    ["Intl.Segmenter", typeof Intl !== "undefined" && Intl.Segmenter ? "yes" : "NO"],
    ["visualViewport", window.visualViewport ? "yes" : "NO"],
    ["viewport", `${window.innerWidth}×${window.innerHeight}`],
    ["visual vp", window.visualViewport ? `${Math.round(visualViewport.width)}×${Math.round(visualViewport.height)}` : "—"],
    ["devicePixelRatio", String(window.devicePixelRatio)],
    ["fonts loaded", document.fonts ? String(document.fonts.status) : "—"],
  ];
}

function diagnosticsText() {
  const lines = [];
  lines.push(`Millie Time v${cfg.version}`);
  lines.push(navigator.userAgent);
  lines.push("");
  for (const [k, v] of probes()) lines.push(`${k}: ${v}`);
  lines.push("");
  lines.push(`window: ${state.startIso} → ${state.endIso} (${days().length}d, auto=${state.autoWindow})`);
  lines.push(`captions: ${Object.keys(state.captions).join(", ") || "none"}`);
  lines.push(`items: ${state.items.length}, unsorted: ${unsortedCount()}`);
  for (const item of state.items) {
    lines.push(`  ${item.kind} ${item.file?.type || "?"} ${formatBytes(item.file?.size || 0)} ` +
      `taken=${item.takenAt ? item.takenAt.toISOString() : "NONE"} day=${item.day || "unsorted"} ` +
      `poster=${item.kind === "video" ? (item.poster ? "ok" : "FAILED") : "-"}`);
  }
  lines.push("");
  lines.push("share order:");
  for (const row of shareManifest()) {
    lines.push(`  ${row.pos} ${row.name} ${row.day} t=${row.stamp}`);
  }
  lines.push("");
  lines.push("log:");
  lines.push(...log);
  return lines.join("\n");
}

export function renderDebug(root) {
  clear(root);

  const table = h("div", { class: "dbg" });
  for (const [k, v] of probes()) {
    table.append(h("div", { class: "dbg-row" },
      h("span", { text: k }),
      h("b", { class: /NO|false|FAILED|threw/.test(v) ? "bad" : "", text: v })));
  }

  const items = h("div", { class: "dbg" });
  if (!state.items.length) {
    items.append(h("div", { class: "dbg-row" }, h("span", { text: "no items picked yet" })));
  }
  for (const item of state.items) {
    items.append(h("div", { class: "dbg-row" },
      h("span", { text: `${item.kind} ${formatBytes(item.file?.size || 0)}` }),
      h("b", { class: item.takenAt ? "" : "bad", text: item.takenAt ? item.day || "out of window" : "no date" })));
  }

  const week = h("div", { class: "dbg" });
  week.append(h("div", { class: "dbg-row" },
    h("span", { text: "window" }),
    h("b", { text: `${state.startIso} → ${state.endIso}` })));
  week.append(h("div", { class: "dbg-row" },
    h("span", { text: "span / auto" }),
    h("b", { text: `${days().length}d / ${state.autoWindow}` })));
  week.append(h("div", { class: "dbg-row" },
    h("span", { text: "unsorted" }),
    h("b", { class: unsortedCount() ? "bad" : "", text: String(unsortedCount()) })));
  week.append(h("div", { class: "dbg-row" },
    h("span", { text: "captions" }),
    h("b", { text: String(Object.keys(state.captions).length) })));

  const order = h("div", { class: "dbg" });
  const manifest = shareManifest();
  if (!manifest.length) {
    order.append(h("div", { class: "dbg-row" }, h("span", { text: "nothing to send yet" })));
  }
  for (const row of manifest) {
    order.append(h("div", { class: "dbg-row" },
      h("span", { text: `${row.pos}. ${row.name}` }),
      h("b", { class: row.day === "unsorted" ? "bad" : "", text: row.day })));
  }

  root.append(
    h("p", { class: "brandline", text: `Debug · v${cfg.version}` }),
    h("div", { class: "scroll" },
      h("p", { class: "dbg-h", text: "The week" }), week,
      h("p", { class: "dbg-h", text: "Share order" }), order,
      h("p", { class: "dbg-h", text: "Capabilities" }), table,
      h("p", { class: "dbg-h", text: "Items" }), items,
      h("p", { class: "dbg-h", text: "Log" }),
      h("pre", { class: "dbg-log", text: log.join("\n") || "(empty)" })
    ),
    h("button", {
      class: "btn", type: "button", text: "Copy diagnostics",
      onclick: async (e) => {
        const ok = await copyText(diagnosticsText());
        e.target.textContent = ok ? "Copied ✓" : "Copy failed";
      },
    }),
    h("button", {
      class: "btn ghost sm", type: "button", text: "← Back", style: "margin-top:10px",
      onclick: () => { location.hash = ""; set({ view: state.items.length ? "sort" : "intake" }); },
    })
  );
}
