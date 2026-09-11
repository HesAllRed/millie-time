// The menu — the three-line button, the box that bounces out of it, and the two
// things inside: options and etc.
//
// It lives outside #app, in <body>, for one reason: every view render clears
// #app outright, so anything inside it would be thrown away the moment she
// sorted a photo. Absolutely positioned rather than fixed, because the shell
// follows the *visual* viewport (see main.js) and a fixed button drifts out of
// step with it the moment the keyboard opens.

import { h, clear, prefersReducedMotion } from "./ui.js";
import { schemes, icons, currentScheme, currentIcon, setScheme, setIcon } from "./theme.js";
import { spray } from "./confetti.js";

const OUT_MS = 170;

let btn = null;
let host = null;
let shell = null;
let open = false;
let panel = "root";        // root | options
let closeTimer = null;

/** Where a click happened, in client coordinates. Keyboard taps have no point. */
function tapPoint(e) {
  if (e && (e.clientX || e.clientY)) return { x: e.clientX, y: e.clientY };
  const rect = e?.currentTarget?.getBoundingClientRect?.();
  if (!rect) return { x: 0, y: 0 };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// --- the two panels --------------------------------------------------------

function rootPanel() {
  return [
    h("button", {
      type: "button", class: "menu-item",
      onclick: () => { panel = "options"; fill(); },
    }, h("span", { text: "options" }), h("span", { class: "cue", text: "→" })),

    h("button", {
      type: "button", class: "menu-item",
      // No menu of its own, no screen, no setting. It throws confetti at your
      // thumb, and that is the whole feature.
      onclick: (e) => { const p = tapPoint(e); spray(p.x, p.y); },
    }, h("span", { text: "etc" }), h("span", { class: "cue", text: "✦" })),
  ];
}

/**
 * A moving scheme's swatch, made of the colours it will actually show: eight
 * accents from around its own cycle, closed back on the first. Two moving
 * schemes therefore never look alike unless they really do move alike.
 */
function wheel(scheme) {
  const stops = [];
  for (let i = 0; i < 8; i++) stops.push(scheme.frame(i / 8).accent);
  return `conic-gradient(${stops.concat(stops[0]).join(",")})`;
}

function swatch(scheme) {
  const on = scheme.id === currentScheme().id;
  return h("button", {
    type: "button",
    // A moving scheme shows the whole wheel turning rather than three bars of
    // one frame of it, which would say nothing about what it does.
    class: `swatch${on ? " on" : ""}${scheme.moving ? " moving" : ""}`,
    style: `background:${scheme.vars.ground}`,
    title: scheme.name,
    "aria-label": scheme.moving ? `${scheme.name}, moving` : scheme.name,
    "aria-pressed": String(on),
    onclick: () => { setScheme(scheme.id); fill(); },
  },
    scheme.moving ? h("i", { class: "wheel", style: `background:${wheel(scheme)}` }) : [
      h("i", { style: `top:0;background:${scheme.vars.accent}` }),
      h("i", { style: `top:33.34%;background:${scheme.vars.magenta}` }),
      h("i", { style: `top:66.68%;background:${scheme.vars.cyan}` }),
    ]
  );
}

function iconPick(icon) {
  const on = icon.id === currentIcon().id;
  return h("button", {
    type: "button",
    class: `iconpick${on ? " on" : ""}`,
    title: icon.name,
    "aria-label": icon.name,
    "aria-pressed": String(on),
    onclick: () => { setIcon(icon.id); fill(); },
  }, h("img", { src: icon.apple, alt: "", width: "44", height: "44" }));
}

function optionsPanel() {
  return [
    h("div", { class: "menu-h" },
      h("button", { type: "button", class: "back", text: "←",
        "aria-label": "Back to the menu",
        onclick: () => { panel = "root"; fill(); } }),
      h("span", { text: "options" })),

    h("p", { class: "menu-sec", text: "colour scheme" }),
    h("div", { class: "swatches" }, schemes.map(swatch)),

    h("p", { class: "menu-sec", text: "app icon" }),
    h("div", { class: "picks" }, icons.map(iconPick)),

    // The one thing in here that cannot take effect where she is standing: iOS
    // reads the icon once, when the shortcut is added, and never again.
    h("p", { class: "menu-note",
      text: "Pick before adding it to your Home Screen — iOS keeps the icon it was added with." }),
  ];
}

// --- the box ---------------------------------------------------------------

// Held across repaints. Rebuilding it to switch panel or tick a swatch would
// restart the bounce animation, so the box would leap out of the corner again
// every time she tried a colour.
let box = null;

function fill() {
  if (!box) return;
  clear(box);
  for (const el of panel === "options" ? optionsPanel() : rootPanel()) box.append(el);
}

/**
 * @param {Object} [how]
 * @param {boolean} [how.viaKeyboard]  move focus into the box, and show a ring
 */
export function openMenu({ viaKeyboard = false } = {}) {
  if (open) return;
  clearTimeout(closeTimer);
  open = true;
  panel = "root";
  host.hidden = false;
  host.classList.remove("closing");
  shell.classList.add("menu-open");
  btn.setAttribute("aria-expanded", "true");
  btn.setAttribute("aria-label", "Close menu");

  clear(host);
  box = h("div", { class: "menu-box", role: "menu", "aria-label": "Menu" });
  host.append(h("div", { class: "menu-scrim", onclick: () => closeMenu() }), box);
  fill();
  // Only for a keyboard open. Pulling focus on a tap leaves a focus ring around
  // the button afterwards, which reads as a control stuck half-pressed.
  if (viaKeyboard) box.querySelector(".menu-item")?.focus({ preventScroll: true });
}

export function closeMenu() {
  if (!open) return;
  open = false;
  shell.classList.remove("menu-open");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-label", "Open menu");

  // Only when we are about to delete whatever has focus — otherwise focus would
  // land on <body> and a keyboard user would be back at the top of the page.
  if (host.contains?.(document.activeElement)) btn.focus?.({ preventScroll: true });

  const done = () => { host.hidden = true; host.classList.remove("closing"); clear(host); box = null; };
  if (prefersReducedMotion()) { done(); return; }
  host.classList.add("closing");
  clearTimeout(closeTimer);
  closeTimer = setTimeout(done, OUT_MS);
}

/**
 * Wire the button, the box and the keyboard. Called once at boot.
 *
 * @param {Object} parts
 * @param {HTMLElement} parts.button  the three-line button
 * @param {HTMLElement} parts.menu    the (empty) box host
 * @param {HTMLElement} parts.shell   carries the .menu-open class, for the X
 */
export function installMenu({ button, menu, shell: shellEl }) {
  btn = button;
  host = menu;
  shell = shellEl;
  if (!btn || !host || !shell) return;

  host.hidden = true;
  // detail 0 is a click with no pointer behind it: Enter or Space on the button.
  btn.addEventListener("click", (e) => (open ? closeMenu() : openMenu({ viaKeyboard: e.detail === 0 })));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) closeMenu();
  });
}
