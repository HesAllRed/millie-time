// Screen 03/04 — get every item onto the right day.
//
// Deliberately not where she writes: separating sorting from writing is what
// lets the deck stay calm. When capture dates come through cleanly the Unsorted
// tray is empty and she scrolls straight past it.

import cfg from "../config.js";
import { h, clear, tile } from "../ui.js";
import { state, set, days } from "../state.js";
import { dayLabel } from "../dates.js";
import { stopVideo } from "../media.js";

let selectedId = null;

export function resetSort() { selectedId = null; }

function strip(items, onTap) {
  const row = h("div", { class: "strip" });
  for (const item of items) {
    row.append(tile(item, { onTap, selected: item.id === selectedId }));
  }
  return row;
}

export function renderSort(root, { onDone, onAddMore }) {
  clear(root);
  stopVideo();

  const window = days();
  const unsorted = state.items.filter((i) => !i.day);
  const onTap = (item) => { selectedId = selectedId === item.id ? null : item.id; set({}); };

  root.append(h("p", { class: "brandline", text: "Step 2 of 3 · Sort" }));

  const scroller = h("div", { class: "scroll" });

  if (unsorted.length) {
    scroller.append(h("div", { class: "tray" },
      h("div", { class: "tray-h" }, "No date found ", h("span", { class: "badge", text: String(unsorted.length) })),
      strip(unsorted, onTap)
    ));
  }

  for (const iso of window) {
    const mine = state.items.filter((i) => i.day === iso);
    const label = dayLabel(iso);
    const row = h("div", { class: `dayrow${mine.length ? "" : " empty"}` },
      h("div", { class: "dayrow-h" },
        h("span", {}, h("b", { text: label.wd }), ` ${label.dm}`),
        h("span", { text: mine.length ? `${mine.length}` : "" })
      ),
      mine.length ? strip(mine, onTap) : h("div", { class: "nowt", text: "nothing yet" })
    );
    scroller.append(row);
  }

  scroller.append(h("button", {
    type: "button", class: "btn ghost sm", text: "Add more photos",
    style: "margin:18px 0 6px", onclick: onAddMore,
  }));

  root.append(scroller);

  if (selectedId) {
    const chips = h("div", { class: "chips" });
    const item = state.items.find((i) => i.id === selectedId);
    chips.append(h("button", {
      type: "button", class: `chip${item && !item.day ? " on" : ""}`, text: "None",
      onclick: () => { if (item) item.day = null; selectedId = null; set({}); },
    }));
    for (const iso of window) {
      const label = dayLabel(iso);
      chips.append(h("button", {
        type: "button",
        class: `chip${item && item.day === iso ? " on" : ""}`,
        text: label.wd,
        title: label.dm,
        onclick: () => { if (item) item.day = iso; selectedId = null; set({}); },
      }));
    }
    root.append(h("div", { class: "sheet" },
      h("div", { class: "sheet-t", text: "Put this one on…" }),
      chips,
      h("button", { type: "button", class: "sheet-x", text: "Remove from the week",
        onclick: () => {
          const i = state.items.findIndex((x) => x.id === selectedId);
          if (i >= 0) {
            const [gone] = state.items.splice(i, 1);
            if (gone.url) URL.revokeObjectURL(gone.url);
            if (gone.poster && gone.poster !== gone.url) URL.revokeObjectURL(gone.poster);
          }
          selectedId = null;
          set({});
        } })
    ));
  } else {
    root.append(h("button", { class: "btn", type: "button", text: "Looks right →", onclick: onDone }));
  }
}
