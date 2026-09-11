// The look: a colour scheme, and which colour the app icon is.
//
// Three rules hold this file together.
//
// 1. Every scheme repaints the *same* set of custom properties — the still ones
//    from a table, the moving ones from a function, and the function has to
//    return the same set on every frame. A scheme that left one out would
//    silently inherit the previous scheme's value and produce a palette nobody
//    designed, so there is a test for it.
//
// 2. Every scheme keeps a dark ground under a light accent. A dozen rules in
//    app.css put dark ink (--ink) on an accent or magenta fill; inverting that
//    is a light theme, which is a different and much larger change than a
//    palette. The roles stay fixed too: the accent leads, magenta marks whatever
//    is being touched, cyan carries information.
//
// 3. Nothing here runs at module load. The tests import it with a stub document
//    and no window at all.
//
// Stored under its own key, deliberately separate from the session: the week
// expires after 48 hours and "Start a new week" wipes it, and neither of those
// should quietly undo a choice she made about how her app looks.

const KEY = "millie.look.v1";

/** h 0-360, s and l per cent, out as #rrggbb. */
export function hsl(h, s, l) {
  const H = ((h % 360) + 360) % 360;
  const S = Math.min(100, Math.max(0, s)) / 100;
  const L = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] =
    H < 60  ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] :
    H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * A whole palette built from one hue — what the moving schemes ride on.
 *
 * The three roles keep their distance as the wheel turns: the accent leads on
 * the hue itself, the mark sits a third of the way round from it, and the
 * information colour two thirds. Turning the hue therefore recolours the app
 * without ever collapsing two roles into the same colour.
 */
export function spectrum(hue) {
  const mark = hue + 130;
  const info = hue + 230;
  return {
    ground:      hsl(hue, 18, 7),
    surface:     hsl(hue, 16, 11),
    "surface-2": hsl(hue, 15, 15),
    edge:        hsl(hue, 14, 23),
    "edge-soft": hsl(hue, 14, 16),
    // Barely tinted, on purpose. At 24% saturation a yellow frame turned every
    // word on the screen olive: the accent is what should carry the colour, and
    // the type should only ever catch a cast of it.
    bone:        hsl(hue, 14, 94),
    "bone-dim":  hsl(hue, 8, 70),
    "bone-mute": hsl(hue, 6, 46),
    accent:      hsl(hue, 90, 82),
    magenta:     hsl(mark, 78, 64),
    cyan:        hsl(info, 70, 62),
    ink:         hsl(hue, 60, 9),
  };
}

const TURN = Math.PI * 2;

export const schemes = [
  {
    id: "lavender", name: "Lavender",
    vars: {
      ground: "#101116", surface: "#191B22", "surface-2": "#20222B",
      edge: "#2C2F3A", "edge-soft": "#22242D",
      bone: "#F0E7E1", "bone-dim": "#A9A29E", "bone-mute": "#6E6A69",
      accent: "#D3D3FF", magenta: "#E0479E", cyan: "#4FC3D9", ink: "#141024",
    },
  },
  {
    id: "sunset", name: "Sunset",
    vars: {
      ground: "#16100F", surface: "#201817", "surface-2": "#29201E",
      edge: "#3A2E2A", "edge-soft": "#2B2220",
      bone: "#F7E9DE", "bone-dim": "#BCA695", "bone-mute": "#7E6A5E",
      accent: "#FFC49B", magenta: "#F2607F", cyan: "#6EC7BE", ink: "#24120A",
    },
  },
  {
    id: "mint", name: "Mint",
    vars: {
      ground: "#0D1413", surface: "#151E1B", "surface-2": "#1C2723",
      edge: "#29372F", "edge-soft": "#1E2925",
      bone: "#EAF2EC", "bone-dim": "#A2B4A8", "bone-mute": "#6B7B71",
      accent: "#A9EFC9", magenta: "#F075A8", cyan: "#6FC9E6", ink: "#0A2016",
    },
  },
  {
    id: "gold", name: "Gold",
    vars: {
      ground: "#15120C", surface: "#1F1B13", "surface-2": "#29241A",
      edge: "#3A3324", "edge-soft": "#2B261B",
      bone: "#F6EEDC", "bone-dim": "#BDB093", "bone-mute": "#7D735C",
      accent: "#F2C879", magenta: "#EE5C93", cyan: "#63C3D6", ink: "#241A06",
    },
  },
  {
    id: "midnight", name: "Midnight",
    vars: {
      ground: "#0C1017", surface: "#141A24", "surface-2": "#1A2230",
      edge: "#27334A", "edge-soft": "#1D2534",
      bone: "#E6EDF7", "bone-dim": "#9FAEC4", "bone-mute": "#68768C",
      accent: "#A8D4FF", magenta: "#F26DA8", cyan: "#6FE3D9", ink: "#0A1626",
    },
  },

  // The moving two. `frame` is the palette at a point in the cycle; `vars` is
  // the frame it stands still on — what Reduce Motion gets, and what the swatch
  // and the status bar are painted from.
  {
    id: "rainbow", name: "Rainbow", moving: true, cycle: 26,
    frame: (t) => spectrum(360 * t),
    vars: spectrum(300),
  },
  {
    id: "aurora", name: "Aurora", moving: true, cycle: 48,
    // Green through teal and blue to violet, and back the way it came. A full
    // turn would take it through orange, which is not what an aurora does.
    frame: (t) => spectrum(170 + 90 * Math.sin(TURN * t)),
    vars: spectrum(170),
  },
];

/**
 * The app icon, in six colours.
 *
 * These are real PNGs — generated by tools/icon-maker.html, which draws the
 * same artwork from the same palettes. iOS takes its home-screen icon from the
 * apple-touch-icon link, and it takes it *once*, when the shortcut is added:
 * choosing here decides what the next install gets, and the menu says so.
 */
export const icons = [
  { id: "lavender", name: "Lavender", apple: "./icons/apple-touch-icon.png",          tab: "./icons/icon-192.png" },
  { id: "sunset",   name: "Sunset",   apple: "./icons/apple-touch-icon-sunset.png",   tab: "./icons/icon-192-sunset.png" },
  { id: "mint",     name: "Mint",     apple: "./icons/apple-touch-icon-mint.png",     tab: "./icons/icon-192-mint.png" },
  { id: "gold",     name: "Gold",     apple: "./icons/apple-touch-icon-gold.png",     tab: "./icons/icon-192-gold.png" },
  { id: "midnight", name: "Midnight", apple: "./icons/apple-touch-icon-midnight.png", tab: "./icons/icon-192-midnight.png" },
  { id: "rainbow",  name: "Rainbow",  apple: "./icons/apple-touch-icon-rainbow.png",  tab: "./icons/icon-192-rainbow.png" },
];

// The first of each list is the default, and the fallback for anything unknown.
export function schemeById(id) {
  return schemes.find((s) => s.id === id) || schemes[0];
}

export function iconById(id) {
  return icons.find((i) => i.id === id) || icons[0];
}

// ---------------------------------------------------------------------------
// The choice itself. Held in memory so every view can read it without touching
// storage, and written through on change.
// ---------------------------------------------------------------------------

let look = { scheme: schemes[0].id, icon: icons[0].id };

/** Whatever was stored, reduced to two ids we recognise. Pure; tested. */
export function readLook(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    scheme: schemeById(src.scheme).id,
    icon: iconById(src.icon).id,
  };
}

export function currentLook() { return { ...look }; }
export function currentScheme() { return schemeById(look.scheme); }
export function currentIcon() { return iconById(look.icon); }

export function loadLook() {
  try {
    look = readLook(JSON.parse(localStorage.getItem(KEY) || "null"));
  } catch { /* unreadable — the defaults are a perfectly good look */ }
  return currentLook();
}

export function saveLook() {
  try { localStorage.setItem(KEY, JSON.stringify(look)); }
  catch { /* private mode or full — she just re-picks next time */ }
}

export function setScheme(id) {
  look.scheme = schemeById(id).id;
  saveLook();
  applyLook();
  return currentScheme();
}

export function setIcon(id) {
  look.icon = iconById(id).id;
  saveLook();
  applyLook();
  return currentIcon();
}

// ---------------------------------------------------------------------------
// Painting it.
// ---------------------------------------------------------------------------

/** Write a palette onto a root element. Everything else follows. */
export function paintVars(vars, root) {
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el || !el.style) return;
  for (const [name, value] of Object.entries(vars)) {
    el.style.setProperty(`--${name}`, value);
  }
}

const reduceMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// The moving schemes.
//
// Driven from here rather than from CSS, because animating a custom property
// needs @property and would then run at the compositor's pace whether anyone is
// looking or not. This way the rate is ours: twelve or so frames a second,
// which is smooth at these speeds and is a twelfth of the style recalculations.
// requestAnimationFrame stops on its own while the app is in the background.
// ---------------------------------------------------------------------------

const STEP_MS = 80;
let motion = null;      // the live rAF handle
let motionAt = 0;

function stopMotion() {
  if (motion && typeof cancelAnimationFrame === "function") cancelAnimationFrame(motion);
  motion = null;
}

function startMotion(scheme) {
  stopMotion();
  if (!scheme.frame || reduceMotion()) return;         // the still frame is already painted
  if (typeof requestAnimationFrame !== "function") return;

  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  motionAt = 0;
  const step = (now) => {
    if (now - motionAt >= STEP_MS) {
      motionAt = now;
      paintVars(scheme.frame(((now - started) / 1000 / scheme.cycle) % 1));
    }
    motion = requestAnimationFrame(step);
  };
  motion = requestAnimationFrame(step);
}

/** Apply the whole look: the palette, the status-bar tint, the icon links. */
export function applyLook() {
  const scheme = currentScheme();
  paintVars(scheme.vars);
  startMotion(scheme);

  // Set once per change rather than per frame. The ground is all but black in
  // every palette, so a moving scheme never drifts far enough from it to show.
  const meta = document.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", scheme.vars.ground);

  // Both links, because iOS reads the first for a home-screen icon and every
  // browser reads the second for the tab — and only the second is visible from
  // inside the app, which is the only feedback the choice can give her here.
  const icon = currentIcon();
  document.querySelector?.('link[rel="apple-touch-icon"]')?.setAttribute("href", icon.apple);
  document.querySelector?.('link[rel="icon"]')?.setAttribute("href", icon.tab);
}
