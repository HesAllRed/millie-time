// Screens 05–08 — the deck. One horizontally-swiped card per day, her photos
// above the field the whole time she's writing, and the Send card as the last
// card so the deck simply ends in the thing she came to do.

import cfg from "../config.js";
import { h, clear, crescent, tile } from "../ui.js";
import { state, set, days, deckDays, saveCaptions } from "../state.js";
import { dayLabel, rangeLabel } from "../dates.js";
import { composeText, totalBytes, formatBytes } from "../compose.js";
import { playVideo, stopVideo, playingId } from "../media.js";

let gridDay = null;      // ISO day whose full grid is open, or null
let gridPick = null;     // item id selected inside that grid

export function resetDeck() { gridDay = null; gridPick = null; }

function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, 260)}px`;
}

function dayCard(iso, onShare) {
  const mine = state.items.filter((i) => i.day === iso);
  const label = dayLabel(iso);

  const card = h("section", { class: "card", "data-day": iso });

  card.append(h("div", { class: "cres-wrap" },
    mine.length
      ? crescent(mine, {
          onTapTile: (item, el) => {
            if (item.kind === "video") {
              playVideo(item, el);
              set({ playingId: playingId() });
            } else {
              gridDay = iso; gridPick = null; set({});
            }
          },
          onTapMore: () => { gridDay = iso; gridPick = null; set({}); },
        })
      : h("p", { class: "nowt centred", text: "no photos on this day" })
  ));

  card.append(h("div", { class: "dayline" },
    h("span", { text: label.dm }),
    h("b", { text: label.weekday })
  ));

  const ta = h("textarea", {
    class: "editor-field",
    rows: "3",
    placeholder: "what happened…",
    "data-day": iso,
    "aria-label": `Caption for ${label.weekday}`,
  });
  ta.value = state.captions[iso] || "";
  ta.addEventListener("input", () => {
    state.captions[iso] = ta.value;
    saveCaptions();
    autoGrow(ta);
    const count = card.querySelector(".count b");
    if (count) count.textContent = String(ta.value.length);
    // Typing deliberately does not re-render the deck — it would blow away the
    // caret. The print listens for this instead so it can regenerate ahead of
    // the share tap.
    document.dispatchEvent(new Event("captions-changed"));
  });

  card.append(h("div", { class: "editor" },
    ta,
    h("div", { class: "count" }, h("b", { text: String(ta.value.length) }), " chars")
  ));

  card.append(h("p", { class: "swipe", text: "Swipe →" }));
  return card;
}

function sendCard(onShare) {
  const card = h("section", { class: "card card-send", "data-day": "__send" });
  fillSend(card, onShare);
  return card;
}

/**
 * Rebuild the Send card's contents from current state.
 *
 * Typing deliberately doesn't re-render the deck — that would kill the caret —
 * so this card would otherwise still be showing whatever the captions were when
 * she entered the deck. It gets refreshed on arrival instead.
 */
function fillSend(card, onShare) {
  clear(card);
  const window = days();
  const withText = window.filter((iso) => (state.captions[iso] || "").trim());
  const bytes = totalBytes(state.items);
  const photos = state.items.filter((i) => i.kind === "photo").length;
  const videos = state.items.filter((i) => i.kind === "video").length;

  card.append(h("p", { class: "brandline centred", text: "Your print" }));

  const paper = h("div", { class: "print" },
    h("div", { class: "p-h" },
      h("span", { text: rangeLabel(window) }),
      h("span", { text: cfg.name })),
    h("div", { class: "p-t", text: cfg.printTitle })
  );
  if (withText.length) {
    for (const iso of withText) {
      paper.append(h("div", { class: "p-row" },
        h("span", { class: "p-d", text: dayLabel(iso).wd }),
        h("span", { class: "p-c", text: state.captions[iso].trim() })
      ));
    }
  } else {
    paper.append(h("div", { class: "p-row" },
      h("span", { class: "p-c", text: "nothing written yet — swipe back and add a line or two." })));
  }
  card.append(h("div", { class: "print-scroll" }, paper));

  card.append(h("div", { class: "spacer" }));

  if (bytes > cfg.warnBytes) {
    card.append(h("div", { class: "notice" },
      h("h4", { text: "That's a big send" }),
      h("p", { text: "Large payloads can stall on cellular. Splitting the heaviest day out would help." })));
  }

  card.append(h("button", { class: "btn", type: "button", text: "Share the week", onclick: onShare }));
  card.append(h("div", { class: "tally" },
    h("b", { text: String(photos) }), " photos · ",
    h("b", { text: String(videos) }), " videos · ",
    h("b", { text: "1" }), " print · ",
    h("b", { text: formatBytes(bytes) })
  ));
  card.append(h("p", { class: "helper", text: "Captions get copied to your clipboard too." }));
}

function gridOverlay() {
  const iso = gridDay;
  const label = dayLabel(iso);
  const mine = state.items.filter((i) => i.day === iso);
  const window = days();

  const grid = h("div", { class: "grid" });
  for (const item of mine) {
    grid.append(tile(item, {
      selected: item.id === gridPick,
      onTap: (it) => { gridPick = gridPick === it.id ? null : it.id; set({}); },
    }));
  }

  const body = h("div", { class: "overlay-body" },
    h("div", { class: "overlay-h" },
      h("span", { text: `${label.wd} ${label.dm}` }),
      h("button", { type: "button", class: "x", text: "Done",
        onclick: () => { gridDay = null; gridPick = null; set({}); } })),
    grid
  );

  if (gridPick) {
    const item = state.items.find((i) => i.id === gridPick);
    const chips = h("div", { class: "chips" });
    for (const target of window) {
      chips.append(h("button", {
        type: "button",
        class: `chip${item && item.day === target ? " on" : ""}`,
        text: dayLabel(target).wd,
        onclick: () => { if (item) item.day = target; gridPick = null; set({}); },
      }));
    }
    body.append(
      h("div", { class: "sheet-t", text: "Move to…" }),
      chips,
      h("button", { type: "button", class: "sheet-x", text: "Remove from the week",
        onclick: () => {
          const at = state.items.findIndex((x) => x.id === gridPick);
          if (at >= 0) {
            const [gone] = state.items.splice(at, 1);
            if (gone.url) URL.revokeObjectURL(gone.url);
            if (gone.poster && gone.poster !== gone.url) URL.revokeObjectURL(gone.poster);
          }
          gridPick = null;
          set({});
        } })
    );
  }

  return h("div", { class: "overlay" }, body);
}

export function renderDeck(root, { onShare }) {
  clear(root);
  const list = deckDays();

  if (!list.length) {
    root.append(
      h("div", { class: "spacer" }),
      h("p", { class: "nowt centred", text: "nothing in this week yet." }),
      h("div", { class: "spacer" }),
      h("button", { class: "btn ghost", type: "button", text: "← Back to sorting",
        onclick: () => set({ view: "sort" }) })
    );
    return;
  }

  const dots = h("div", { class: "dots" });
  for (let i = 0; i <= list.length; i++) {
    dots.append(h("i", { class: i === state.deckIndex ? "on" : (i < state.deckIndex ? "done" : "") }));
  }
  root.append(dots);

  const deck = h("div", { class: "deck" });
  for (const iso of list) deck.append(dayCard(iso, onShare));
  const send = sendCard(onShare);
  deck.append(send);
  root.append(deck);

  // Keep the dots honest without re-rendering the whole deck on every swipe.
  let raf = null;
  deck.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const idx = Math.round(deck.scrollLeft / Math.max(1, deck.clientWidth));
      if (idx === state.deckIndex) return;
      state.deckIndex = idx;
      stopVideo();                                   // never leave a decoder running
      [...dots.children].forEach((d, i) => {
        d.className = i === idx ? "on" : (i < idx ? "done" : "");
      });
      if (idx === list.length) fillSend(send, onShare);   // show what she just wrote
    });
  }, { passive: true });

  // Restore position after a re-render (tile taps, grid edits).
  requestAnimationFrame(() => {
    deck.scrollLeft = state.deckIndex * deck.clientWidth;
    deck.querySelectorAll(".editor-field").forEach(autoGrow);
  });

  if (gridDay) root.append(gridOverlay());
}
