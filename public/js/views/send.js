// Screens 09–11 — the two-step fallback, the sent state, and plan B.

import cfg from "../config.js";
import { h, clear } from "../ui.js";
import { state, set } from "../state.js";
import { totalBytes, formatBytes } from "../compose.js";

/**
 * Rung 3. Only reached when a one-tap share failed on this device.
 * Each step re-runs independently, so a failure in one never re-sends the other.
 */
export function renderStepper(root, { onWords, onPhotos }) {
  clear(root);
  const wordsSent = state.shareStep === "photos";
  const bytes = totalBytes(state.items);
  const photos = state.items.filter((i) => i.kind === "photo").length;
  const videos = state.items.filter((i) => i.kind === "video").length;

  root.append(
    h("p", { class: "brandline centred", text: wordsSent ? "Nearly there" : "Let's do it in two" }),

    h("button", {
      type: "button",
      class: `step${wordsSent ? " ok" : " now"}`,
      onclick: onWords,
    },
      h("span", { class: "n", text: wordsSent ? "✓" : "1" }),
      h("div", {},
        h("h4", { text: wordsSent ? "Words sent" : "Send the words" }),
        h("p", { text: wordsSent ? "Tap to send them again if you need." : "Your whole week as text — pick who gets it." })
      )
    ),

    h("button", {
      type: "button",
      class: `step${wordsSent ? " now" : ""}`,
      onclick: wordsSent ? onPhotos : null,
      disabled: !wordsSent,
    },
      h("span", { class: "n", text: "2" }),
      h("div", {},
        h("h4", { text: "Send the photos" }),
        h("p", { text: wordsSent ? "Pick the same chat you just used." : "Right after the words." }),
        h("div", { class: "meta", text: `${photos} PHOTOS · ${videos} VIDEOS · ${formatBytes(bytes)}` })
      )
    ),

    h("div", { class: "spacer" }),
    h("button", {
      class: "btn", type: "button",
      text: wordsSent ? "Send the photos" : "Send the words",
      onclick: wordsSent ? onPhotos : onWords,
    }),
    h("button", {
      class: "btn ghost sm", type: "button", text: "← Back",
      style: "margin-top:10px",
      onclick: () => set({ view: "deck", shareStep: null }),
    })
  );
}

export function renderSent(root, { onNew }) {
  clear(root);
  root.append(
    h("div", { class: "spacer" }),
    h("div", { class: "orb" }),
    h("div", { class: "range centred", style: "font-size:38px;margin-top:26px", text: "SENT" }),
    h("p", { class: `penline centred font-${cfg.taglineFont}`, text: cfg.sentWord }),
    h("div", { class: "spacer" }),
    h("button", { class: "btn ghost", type: "button", text: "Start a new week", onclick: onNew })
  );
}

/**
 * Plan B. Everything she needs is already on her phone, so this offers no
 * downloads — it points at what's already true and gets her to a sent message.
 */
export function renderFallback(root, { onRetry }) {
  clear(root);
  root.append(
    h("p", { class: "brandline", text: "Plan B" }),
    h("div", { class: "range", style: "font-size:34px;margin-top:12px" }, "SHARING", h("br"), "DIDN'T OPEN"),
    h("div", { class: "notice" },
      h("h4", { text: "Your words are copied" }),
      h("p", { text: "Open Messages and paste — the whole week is on your clipboard already." })),
    h("div", { class: "notice mag" },
      h("h4", { text: "Then the photos" }),
      h("p", { text: "They're in your camera roll. Attach them from there." })),
    h("div", { class: "spacer" }),
    h("button", { class: "btn ghost", type: "button", text: "Try again", onclick: onRetry })
  );
}
