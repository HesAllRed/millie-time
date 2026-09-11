// #debug — the on-device diagnostics screen.
//
// Safari's remote inspector needs a Mac, and this project is built on Windows,
// so there is no console on the phone. This screen is the substitute: it reports
// what the device actually did, and COPY DIAGNOSTICS puts the lot on the
// clipboard so it can be pasted straight back into a chat.

import cfg from "../config.js";
import { h, clear } from "../ui.js";
import { state, set, days, unsortedCount } from "../state.js";
import { copyText, runShareLadder } from "../share.js";
import { buildProbe, buildHeavyProbe } from "../probe.js";
import { formatBytes, shareOrder, captureSequence, weightPlan } from "../compose.js";
import { orderedName } from "../media.js";
import { currentScheme, currentLogo } from "../theme.js";

/**
 * Exactly what the share would send, in order. If photos still arrive scrambled
 * after this, the manifest says whether we sent them wrong or Messages
 * reordered them — which is the difference between our bug and Apple's.
 */
const MB = 1048576;

function shareManifest() {
  const week = days();
  const ordered = shareOrder(state.items, week, cfg.videosLast);
  const stamps = captureSequence(ordered, week[week.length - 1]);

  // Weight is the signal Messages actually acts on, so the manifest has to show
  // the padded size rather than the size on disk — that is what will race.
  const ladder = cfg.renumberOnShare && cfg.orderByWeight
    ? weightPlan(ordered.map((i) => ({ size: i.file.size, kind: i.kind })), {
        stepMb: cfg.weightStepMb,
        budgetMb: cfg.maxPayloadMb,
      })
    : null;

  return ordered.map((item, i) => ({
    pos: i + 1,
    name: orderedName(item.file, i + 1, ordered.length),
    day: item.day || "unsorted",
    // "ours" means the file carried no capture date and we wrote this one in,
    // so that an app sorting by date taken agrees with the order we sent.
    taken: stamps[i],
    dateSource: item.kind === "video" ? "video"
      : item.hasExifDate ? "exif"
      : item.container ? `ours/${item.container}` : "none",
    weight: ladder ? ladder.targets[i] : item.file.size,
    padded: ladder ? ladder.targets[i] > item.file.size : false,
  }));
}

/** The ladder, or why there isn't one. */
function weightLine() {
  const rows = shareManifest();
  if (!rows.length) return "nothing to send yet";
  const total = rows.reduce((sum, r) => sum + r.weight, 0);
  const real = state.items.reduce((sum, i) => sum + i.file.size, 0);
  if (!cfg.orderByWeight) return `off · ${formatBytes(total)}`;
  const padded = rows.filter((r) => r.padded).length;
  if (!padded && total <= real) return `no padding needed · ${formatBytes(total)}`;
  return `${padded} padded · ${formatBytes(real)} → ${formatBytes(total)}`;
}

// ---------------------------------------------------------------------------
// The order probe. Built ahead of the tap, like the print — six numbered photos
// whose filename, capture date and timestamp each say a different order, so
// what comes back in the thread names the rule Messages actually uses. The
// reasoning is in probe.js.
// ---------------------------------------------------------------------------

let probe = null;
let probeState = "idle";       // idle | building | ready | failed
let probeResult = null;

function ensureProbe() {
  if (probeState !== "idle") return;
  probeState = "building";
  buildProbe()
    .then((built) => {
      probe = built;
      probeState = "ready";
      record("probe", `${built.files.length} files ready`);
      set({});
    })
    .catch((e) => { probeState = "failed"; record("probe", e); set({}); });
}

// The heavy probe is 28 MB, so it is never built unless she asks for it — but
// it still has to be built BEFORE the tap that shares it, like everything else
// that goes through the share sheet.
let heavy = null;
let heavyState = "idle";       // idle | building | ready | failed
let heavyAt = 0;
let heavyResult = null;

function prepareHeavy() {
  if (heavyState === "building") return;
  heavyState = "building";
  heavyAt = 0;
  set({});
  buildHeavyProbe((done) => { heavyAt = done; set({}); })
    .then((built) => {
      heavy = built;
      heavyState = "ready";
      record("heavy", `${built.files.length} files, ${(built.total / 1048576).toFixed(1)} MB`);
      set({});
    })
    .catch((e) => { heavyState = "failed"; record("heavy", e); set({}); });
}

function sendHeavy() {
  if (!heavy) return;
  copyText(heavy.key);
  runShareLadder({ files: heavy.files, text: "Millie Time heavy order test — these should read 1 to 11." })
    .then((res) => {
      heavyResult = res.outcome === "sent" ? `sent (rung ${res.rung})` : res.outcome;
      record("heavy", heavyResult);
      set({});
    })
    .catch((e) => { heavyResult = `failed: ${e.message}`; record("heavy", e); set({}); });
}

function sendProbe() {
  if (!probe) return;
  copyText(probe.key);                     // the answer key, on her clipboard
  runShareLadder({ files: probe.files, text: "Millie Time order test — these should read 1 2 3 4 5 6." })
    .then((res) => {
      probeResult = res.outcome === "sent" ? `sent (rung ${res.rung})` : res.outcome;
      record("probe", probeResult);
      set({});
    })
    .catch((e) => { probeResult = `failed: ${e.message}`; record("probe", e); set({}); });
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
  lines.push(`look: ${currentScheme().id} · ${currentLogo().id}`);
  lines.push(`window: ${state.startIso} → ${state.endIso} (${days().length}d, auto=${state.autoWindow})`);
  lines.push(`captions: ${Object.keys(state.captions).join(", ") || "none"}`);
  lines.push(`items: ${state.items.length}, unsorted: ${unsortedCount()}`);
  for (const item of state.items) {
    lines.push(`  ${item.kind} ${item.file?.type || "?"} ${formatBytes(item.file?.size || 0)} ` +
      `taken=${item.takenAt ? item.takenAt.toISOString() : "NONE"} day=${item.day || "unsorted"} ` +
      `poster=${item.kind === "video" ? (item.poster ? "ok" : "FAILED") : "-"}`);
  }
  lines.push("");
  lines.push(`share order (weight: ${weightLine()}):`);
  for (const row of shareManifest()) {
    lines.push(`  ${row.pos} ${row.name} ${row.day} ${(row.weight / MB).toFixed(2)}MB${row.padded ? "*" : ""} taken=${row.taken.toISOString()} (${row.dateSource})`);
  }
  lines.push("");
  lines.push("log:");
  lines.push(...log);
  return lines.join("\n");
}

export function renderDebug(root) {
  clear(root);
  ensureProbe();

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
      h("span", { text: `${row.pos}. ${row.name}  ${(row.weight / MB).toFixed(1)}MB${row.padded ? "*" : ""}` }),
      h("b", { class: row.dateSource === "none" ? "bad" : "", text: `${row.day} · ${row.dateSource}` })));
  }

  const probeBox = h("div", { class: "dbg" });
  probeBox.append(h("div", { class: "dbg-row" },
    h("span", { text: "six numbered photos" }),
    h("b", { class: probeState === "failed" ? "bad" : "", text: probeState })));
  if (probeResult) {
    probeBox.append(h("div", { class: "dbg-row" },
      h("span", { text: "last attempt" }), h("b", { text: probeResult })));
  }
  probeBox.append(h("button", {
    class: "btn ghost sm", type: "button", style: "margin:10px 0 4px",
    text: probeState === "ready" ? "Send the order test" : "Getting it ready…",
    disabled: probeState !== "ready",
    onclick: sendProbe,
  }));
  probeBox.append(h("p", { class: "helper", style: "text-align:left",
    text: "Send them to yourself, then read the big numbers in the order they land. " +
          "1 2 3 4 5 6 means the order we send is kept · 6 5 4 3 2 1 means it sorts by filename · " +
          "4 5 6 1 2 3 means capture date · 2 1 4 3 6 5 means file timestamp. " +
          "The answer key is copied to your clipboard when you tap." }));

  const heavyBox = h("div", { class: "dbg" });
  heavyBox.append(h("div", { class: "dbg-row" },
    h("span", { text: "eleven files, 28 MB" }),
    h("b", { class: heavyState === "failed" ? "bad" : "", text:
      heavyState === "building" ? `building ${heavyAt} of 11` : heavyState })));
  if (heavy) {
    heavyBox.append(h("div", { class: "dbg-row" },
      h("span", { text: "actual size" }),
      h("b", { text: `${(heavy.total / 1048576).toFixed(1)} MB` })));
  }
  if (heavyResult) {
    heavyBox.append(h("div", { class: "dbg-row" },
      h("span", { text: "last attempt" }), h("b", { text: heavyResult })));
  }
  heavyBox.append(h("button", {
    class: "btn ghost sm", type: "button", style: "margin:10px 0 4px",
    text: heavyState === "ready" ? "Send the heavy test"
      : heavyState === "building" ? `Building ${heavyAt} of 11…`
      : "Prepare the heavy test",
    disabled: heavyState === "building",
    onclick: heavyState === "ready" ? sendHeavy : prepareHeavy,
  }));
  heavyBox.append(h("p", { class: "helper", style: "text-align:left",
    text: "The shape of a real week: eleven files, 28 MB, sizes from 160 KB to 5.8 MB. " +
          "Here the filename, capture date and timestamp all agree with the order sent — " +
          "only the sizes vary, and the two smallest are 9th and 10th. " +
          "1 to 11 means size isn't it either · the small ones arriving first means it's a " +
          "race they win · a different order each send means a race with no rule. " +
          "Preparing it takes a few seconds and holds 28 MB, so it only builds when you ask." }));

  order.append(h("div", { class: "dbg-row" },
    h("span", { text: "weight ladder" }),
    h("b", { class: /NO LADDER/.test(weightLine()) ? "bad" : "", text: weightLine() })));

  root.append(
    h("p", { class: "brandline", text: `Debug · v${cfg.version}` }),
    h("div", { class: "scroll" },
      h("p", { class: "dbg-h", text: "The week" }), week,
      h("p", { class: "dbg-h", text: "Share order" }), order,
      h("p", { class: "dbg-h", text: "Order test" }), probeBox,
      h("p", { class: "dbg-h", text: "Heavy order test" }), heavyBox,
      h("p", { class: "dbg-h", text: "Capabilities" }), table,
      h("p", { class: "dbg-h", text: "Items" }), items,
      h("p", { class: "dbg-h", text: "Log" }),
      h("pre", { class: "dbg-log", text: log.join("\n") || "(empty)" }),
      // The clipboard is not always reachable — a locked-down browser, a copy
      // that reports success and lands nothing, a paste that arrives empty.
      // The same text is always here to be selected by hand or screenshotted,
      // because a diagnostics screen you cannot get the diagnostics off is not
      // one.
      h("p", { class: "dbg-h", text: "All of it, to select by hand" }),
      h("textarea", {
        class: "dbg-log", readonly: "", rows: "10", spellcheck: "false",
        style: "width:100%;resize:vertical",
        "aria-label": "Diagnostics text",
        onfocus: (e) => e.target.select(),
      }, diagnosticsText())
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
