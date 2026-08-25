// Screen 01 — the entry point, and 01b, the week window picker.
// Opens here every launch. No history, no menu.

import cfg from "../config.js";
import { h, clear } from "../ui.js";
import { state, set, days, refreshWindow } from "../state.js";
import { dayLabel, windowDays, addDays, isoDay } from "../dates.js";
import { weekIndex } from "../dates.js";

function tagline() {
  const list = cfg.taglines || [];
  if (!list.length) return "";
  return list[weekIndex() % list.length];
}

function rangeBlock(onEdit) {
  const d = days();
  const a = dayLabel(d[0]);
  const b = dayLabel(d[d.length - 1]);
  return h("div", {},
    h("div", { class: "range wk" },
      h("span", { class: "wd", text: a.wd }), ` ${a.dm}`,
      h("br"),
      h("span", { class: "arw", text: "→" }), " ",
      h("span", { class: "wd", text: b.wd }), ` ${b.dm}`
    ),
    h("button", {
      type: "button", class: "editchip", onclick: onEdit,
      "aria-label": "Change the week",
    }, `${cfg.weekLength} days · `, h("b", { text: "change" }))
  );
}

export function renderIntake(root, { onPick }) {
  clear(root);
  root.append(
    h("p", { class: "brandline", text: cfg.name }),
    h("div", { class: "spacer" }),
    rangeBlock(() => set({ view: "window" })),
    h("p", { class: `penline font-${cfg.taglineFont}`, text: tagline() }),
    h("div", { class: "spacer" }),
    h("button", { class: "btn", type: "button", onclick: onPick, text: "Pick photos" }),
  );
}

// --- 01b -------------------------------------------------------------------

export function renderWindow(root) {
  clear(root);
  const d = days();
  const a = dayLabel(d[0]);
  const b = dayLabel(d[d.length - 1]);

  // Candidate starts: a fortnight back from today, newest first.
  const today = isoDay(new Date());
  const candidates = windowDays(today, 14);

  const list = h("div", { class: "pick" });
  for (const iso of candidates) {
    const label = dayLabel(iso);
    const on = iso === d[0];
    list.append(h("button", {
      type: "button",
      class: `pick-row${on ? " on" : ""}`,
      onclick: () => {
        state.autoWindow = false;
        set({ startIso: iso, endIso: addDays(iso, cfg.weekLength - 1) });
      },
    },
      h("span", {}, h("b", { text: label.wd }), `  ${label.dm}`),
      h("span", { class: "tick", text: on ? "✓" : "" })
    ));
  }

  root.append(
    h("button", { type: "button", class: "brandline linkish", text: "← The week",
      onclick: () => set({ view: state.items.length ? "sort" : "intake" }) }),
    h("div", { class: "range wk small" },
      h("span", { class: "wd", text: a.wd }), ` ${a.dm} `,
      h("span", { class: "arw", text: "→" }), " ",
      h("span", { class: "wd", text: b.wd }), ` ${b.dm}`),
    h("button", {
      type: "button",
      class: `toggle${state.autoWindow ? " on" : ""}`,
      onclick: () => {
        state.autoWindow = !state.autoWindow;
        refreshWindow();
        set({});
      },
    },
      h("div", {},
        h("div", { class: "lbl", text: "Follow my newest photo" }),
        h("div", { class: "sub", text: state.autoWindow ? `Ends ${b.wd} ${b.dm}` : "Off — pinned by hand" })),
      h("span", { class: "sw2" })
    ),
    h("p", { class: "brandline", text: "Or start on…", style: "margin-top:18px" }),
    list,
    h("div", { class: "spacer" }),
    h("button", { class: "btn", type: "button", text: "Done",
      onclick: () => set({ view: state.items.length ? "sort" : "intake" }) }),
  );
}
