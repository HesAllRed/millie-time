// The look: which colour scheme the app wears — one of seven, or one she mixed
// herself on the two sliders.
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
 * A whole palette built from one hue — what the moving schemes ride on, and
 * what the picker hands to anything she mixes herself.
 *
 * The three roles keep their distance as the wheel turns: the accent leads on
 * the hue itself, the mark sits a third of the way round from it, and the
 * information colour two thirds. Turning the hue therefore recolours the app
 * without ever collapsing two roles into the same colour.
 *
 * Every lightness here is fixed, and only the saturations move with `vivid`
 * (0 to 1, all the way to grey). That is what makes the picker safe to hand
 * over: no hue and no setting of that slider can produce a palette that puts
 * dark ink on a dark button, because the accent is always light and the ground
 * is always nearly black.
 */
export function spectrum(hue, vivid = 1) {
  const v = Math.min(1, Math.max(0, vivid));
  const sat = (base) => base * v;
  const mark = hue + 130;
  const info = hue + 230;
  return {
    ground:      hsl(hue, sat(18), 7),
    surface:     hsl(hue, sat(16), 11),
    "surface-2": hsl(hue, sat(15), 15),
    edge:        hsl(hue, sat(14), 23),
    "edge-soft": hsl(hue, sat(14), 16),
    // Barely tinted, on purpose. At 24% saturation a yellow frame turned every
    // word on the screen olive: the accent is what should carry the colour, and
    // the type should only ever catch a cast of it.
    bone:        hsl(hue, sat(14), 94),
    "bone-dim":  hsl(hue, sat(8), 70),
    "bone-mute": hsl(hue, sat(6), 46),
    accent:      hsl(hue, sat(90), 82),
    magenta:     hsl(mark, sat(78), 64),
    cyan:        hsl(info, sat(70), 62),
    ink:         hsl(hue, sat(60), 9),
  };
}

/**
 * Back the other way: a hex colour to where it sits on the two sliders.
 *
 * Used to park the thumbs on the colour already in play, so nudging the hue
 * from Mint starts at Mint rather than jumping to red.
 */
export function hslOf(hex) {
  const [r, g, b] = [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: Math.round((h + 360) % 360), s: Math.round(s * 100), l: Math.round(l * 100) };
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

// ---------------------------------------------------------------------------
// Hers.
//
// Not in the list above, because it is not a fixed palette — it is wherever the
// two sliders are standing. It answers to an id like the rest so that storing,
// restoring and selecting all work the same way.
// ---------------------------------------------------------------------------

export const CUSTOM = "custom";
const DEFAULT_CUSTOM = { hue: 260, vivid: 100 };

export function customScheme(custom) {
  const { hue, vivid } = custom || look.custom;
  return { id: CUSTOM, name: "Your own", vars: spectrum(hue, vivid / 100) };
}

// The first of the list is the default, and the fallback for anything unknown.
export function schemeById(id) {
  if (id === CUSTOM) return customScheme();
  return schemes.find((s) => s.id === id) || schemes[0];
}

// ---------------------------------------------------------------------------
// The choice itself. Held in memory so every view can read it without touching
// storage, and written through on change.
// ---------------------------------------------------------------------------

let look = { scheme: schemes[0].id, custom: { ...DEFAULT_CUSTOM } };

/**
 * A number from storage, or the default if it is anything else. Hue wraps.
 *
 * Deliberately not a bare `Number(value)`: null, "" and [] all coerce to 0,
 * which would come back as a real setting of zero — a grey app, restored from
 * a stored value that was never a number at all.
 */
function clean(value, fallback, max, wrap = false) {
  const n = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value)
    : NaN;
  if (!Number.isFinite(n)) return fallback;
  return wrap ? ((n % max) + max) % max : Math.min(max, Math.max(0, n));
}

/** Whatever was stored, reduced to something we can paint. Pure; tested. */
export function readLook(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const custom = src.custom && typeof src.custom === "object" ? src.custom : {};
  return {
    scheme: schemeById(src.scheme).id,
    custom: {
      hue: clean(custom.hue, DEFAULT_CUSTOM.hue, 360, true),
      vivid: clean(custom.vivid, DEFAULT_CUSTOM.vivid, 100),
    },
  };
}

export function currentLook() { return { scheme: look.scheme, custom: { ...look.custom } }; }
export function currentScheme() { return schemeById(look.scheme); }

/** For the version stamp and the diagnostics screen. */
export function lookLabel() {
  return look.scheme === CUSTOM
    ? `custom ${Math.round(look.custom.hue)}° at ${Math.round(look.custom.vivid)}%`
    : look.scheme;
}

export function loadLook() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); }
  catch { /* unreadable — the defaults are a perfectly good look */ }
  look = readLook(raw);
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

/**
 * Wherever the sliders have got to. Painted at once and stored a moment later:
 * a drag is a hundred of these, and localStorage does not need to hear about
 * every pixel of it. menu.js also flushes on the drag's end.
 */
export function setCustom({ hue, vivid }) {
  look.custom = {
    hue: clean(hue, look.custom.hue, 360, true),
    vivid: clean(vivid, look.custom.vivid, 100),
  };
  look.scheme = CUSTOM;
  applyLook();
  saveSoon();
  return currentScheme();
}

let saveTimer = null;
function saveSoon() {
  if (typeof setTimeout !== "function") { saveLook(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLook, 200);
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

/** Apply the whole look: the palette, the motion, the status-bar tint. */
export function applyLook() {
  const scheme = currentScheme();
  paintVars(scheme.vars);
  startMotion(scheme);

  // Set once per change rather than per frame. The ground is all but black in
  // every palette, so a moving scheme never drifts far enough from it to show.
  const meta = document.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", scheme.vars.ground);
}
