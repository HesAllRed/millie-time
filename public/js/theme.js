// The look: a colour scheme and a logo, chosen from the menu and remembered.
//
// Two rules hold this file together.
//
// 1. Every scheme repaints the *same* set of custom properties. A scheme that
//    left one out would silently inherit the previous scheme's value and
//    produce a palette nobody designed — so there is a test that they all carry
//    identical keys.
//
// 2. Every scheme keeps a dark ground under a light accent. A dozen rules in
//    app.css put dark ink (--ink) on an accent or magenta fill; inverting that
//    is a light theme, which is a different and much larger change than a
//    palette. The roles stay fixed too: the accent leads, magenta marks whatever
//    is being touched, cyan carries information.
//
// Stored under its own key, deliberately separate from the session: the week
// expires after 48 hours and "Start a new week" wipes it, and neither of those
// should quietly undo a choice she made about how her app looks.

const KEY = "millie.look.v1";

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
];

// The mark inside the app — the one on the entry screen, the one that breathes
// while iOS is thinking, the one on the SENT screen.
//
// Not the home-screen icon: iOS snapshots that when the app is added and never
// looks at it again, so no amount of choosing here can change it. Deleting and
// re-adding the shortcut is the only way, and that clears her captions with it.
// See DEPLOY.md.
export const logos = [
  { id: "invader", name: "Invader", glyph: "👾" },
  { id: "paw",     name: "Paw",     glyph: "🐾" },
  { id: "bloom",   name: "Bloom",   glyph: "🌸" },
  { id: "star",    name: "Star",    glyph: "⭐" },
  { id: "moon",    name: "Moon",    glyph: "🌙" },
  { id: "camera",  name: "Camera",  glyph: "📸" },
];

// The first of each list is the default, and the fallback for anything unknown.
export function schemeById(id) {
  return schemes.find((s) => s.id === id) || schemes[0];
}

export function logoById(id) {
  return logos.find((l) => l.id === id) || logos[0];
}

// ---------------------------------------------------------------------------
// The choice itself. Held in memory so every view can read it without touching
// storage, and written through on change.
// ---------------------------------------------------------------------------

let look = { scheme: schemes[0].id, logo: logos[0].id };

/** Whatever was stored, reduced to two ids we recognise. Pure; tested. */
export function readLook(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    scheme: schemeById(src.scheme).id,
    logo: logoById(src.logo).id,
  };
}

export function currentLook() { return { ...look }; }
export function currentScheme() { return schemeById(look.scheme); }
export function currentLogo() { return logoById(look.logo); }
export function logoGlyph() { return currentLogo().glyph; }

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

export function setLogo(id) {
  look.logo = logoById(id).id;
  saveLook();
  applyLook();
  return currentLogo();
}

// ---------------------------------------------------------------------------
// Painting it.
// ---------------------------------------------------------------------------

/** Write a scheme's variables onto a root element. Everything else follows. */
export function paintScheme(scheme, root) {
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el || !el.style) return;
  for (const [name, value] of Object.entries(scheme.vars)) {
    el.style.setProperty(`--${name}`, value);
  }
}

/** An emoji as an icon file, without shipping six more PNGs. */
export function glyphIcon(glyph) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    `<text x="50%" y="52" font-size="52" text-anchor="middle">${glyph}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// The crafted icon is better than any emoji, so it is only replaced once she
// has actually chosen something else — and put back if she chooses the invader
// again. Captured on the first call, before we have overwritten it.
let stockIcon = null;

function paintIcon(logo) {
  const link = document.querySelector?.('link[rel="icon"]');
  if (!link) return;
  if (stockIcon === null) stockIcon = link.getAttribute("href") || "";
  link.setAttribute("href", logo.id === logos[0].id ? stockIcon : glyphIcon(logo.glyph));
}

/** Apply the whole look: variables, the iOS status-bar tint, the tab icon. */
export function applyLook() {
  const scheme = currentScheme();
  paintScheme(scheme);

  const meta = document.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", scheme.vars.ground);

  paintIcon(currentLogo());
  document.dispatchEvent?.(new Event("look-changed"));
}
