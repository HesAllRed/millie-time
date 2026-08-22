// #debug — the on-device diagnostics screen.
//
// Safari's remote inspector needs a Mac, and this project is built on Windows,
// so there is no console on the phone. This screen is the substitute: it reports
// what the device actually did, and COPY DIAGNOSTICS puts the lot on the
// clipboard so it can be pasted straight back into a chat.

import cfg from "../config.js";
import { h, clear } from "../ui.js";
import { state, set, days } from "../state.js";
import { copyText } from "../share.js";
import { formatBytes } from "../compose.js";

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
  lines.push(`window: ${days()[0]} → ${state.endIso} (auto=${state.autoWindow})`);
  lines.push(`items: ${state.items.length}`);
  for (const item of state.items) {
    lines.push(`  ${item.kind} ${item.file?.type || "?"} ${formatBytes(item.file?.size || 0)} ` +
      `taken=${item.takenAt ? item.takenAt.toISOString() : "NONE"} day=${item.day || "unsorted"} ` +
      `poster=${item.kind === "video" ? (item.poster ? "ok" : "FAILED") : "-"}`);
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

  root.append(
    h("p", { class: "brandline", text: `Debug · v${cfg.version}` }),
    h("div", { class: "scroll" },
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
