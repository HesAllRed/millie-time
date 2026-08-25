// Screen 01 — the entry point, and the one screen she can always get back to.
//
// The week range here is context, not a control. It used to be tappable and
// opened a start-day picker, which was a fiction three times over: before any
// photos exist the range is just "the 8 days ending today"; in the default mode
// `refreshWindow()` recomputes it from EXIF the moment photos land; and pinning
// it by hand bypassed `resolveWindow`'s stretching, so photos outside the pinned
// span silently fell into the Unsorted tray. She can still pick photos from
// before the range and the week grows backwards to take them — which is what the
// picker was pretending to offer.

import cfg from "../config.js";
import { h, clear } from "../ui.js";
import { state, set, days } from "../state.js";
import { dayLabel, weekIndex } from "../dates.js";
import { dayStatus } from "../compose.js";

function tagline() {
  const list = cfg.taglines || [];
  if (!list.length) return "";
  return list[weekIndex() % list.length];
}

function rangeBlock(week) {
  const a = dayLabel(week[0]);
  const b = dayLabel(week[week.length - 1]);
  return h("div", { class: "range wk" },
    h("span", { class: "wd", text: a.wd }), ` ${a.dm}`,
    h("br"),
    h("span", { class: "arw", text: "→" }), " ",
    h("span", { class: "wd", text: b.wd }), ` ${b.dm}`
  );
}

/**
 * The shape of the week: one dot per day, filled as it fills up.
 *
 * Deliberately a different shape from the deck's dots, which track position
 * rather than content — they must not read as the same control.
 */
function weekDots(week) {
  const row = h("div", { class: "wkdots", "aria-hidden": "true" });
  for (const iso of week) {
    row.append(h("i", { class: dayStatus(iso, state.captions, state.items) }));
  }
  return row;
}

/** Anything worth coming back to — photos picked, or a day written about. */
function hasWork() {
  return state.items.length > 0 ||
    Object.values(state.captions).some((t) => (t || "").trim());
}

export function renderIntake(root, { onPick }) {
  clear(root);
  const week = days();
  const resuming = hasWork();

  root.append(
    h("p", { class: "brandline", text: cfg.name }),
    h("div", { class: "spacer" }),
    rangeBlock(week),
    weekDots(week),
    h("p", { class: `penline font-${cfg.taglineFont}`, text: tagline() }),
    h("div", { class: "spacer" }),
  );

  // She reaches this screen mid-session now, so it needs a way onward as well as
  // a way in. Picking always appends, so "add more" is the honest verb once
  // there is something to add to.
  if (resuming) {
    root.append(
      h("button", { class: "btn", type: "button", text: "Continue →",
        onclick: () => set({ view: "sort" }) }),
      h("button", { class: "btn ghost sm", type: "button", text: "Add more photos",
        style: "margin-top:10px", onclick: onPick }),
    );
  } else {
    root.append(h("button", { class: "btn", type: "button", text: "Pick photos", onclick: onPick }));
  }

  // The one thing about this app that isn't discoverable: the picker appends
  // rather than replaces, so a fast first pass costs her nothing.
  root.append(h("p", { class: "helper",
    text: "Newest are at the top of your roll. You can come back and add more." }));
}
