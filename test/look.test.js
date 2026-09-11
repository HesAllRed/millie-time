// The look — colour schemes, the moving ones, and the icon.
//
// The first two matter most. A scheme that forgets a variable doesn't throw, it
// leaves the previous scheme's colour in place and you get a palette nobody
// designed; and a scheme whose accent isn't lighter than its ground puts dark
// ink on a dark button, which is invisible rather than broken.

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const KEY = "millie.look.v1";

function installFakeDom() {
  const vars = new Map();
  const el = (attrs) => ({
    attrs: { ...attrs },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
  });
  const meta = el({ name: "theme-color", content: "#101116" });
  const tab = el({ rel: "icon", href: "./icons/icon-192.png" });
  const apple = el({ rel: "apple-touch-icon", href: "./icons/apple-touch-icon.png" });

  globalThis.document = {
    documentElement: { style: { setProperty: (k, v) => vars.set(k, v) } },
    querySelector: (sel) =>
      sel.includes("theme-color") ? meta :
      sel.includes("apple-touch-icon") ? apple :
      sel.includes("icon") ? tab : null,
  };
  return { vars, meta, tab, apple };
}

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

/** Relative luminance, so "light accent over dark ground" can be asserted. */
function luminance(hex) {
  const channel = (i) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

let T, dom, store;

before(async () => {
  dom = installFakeDom();
  store = installLocalStorage();
  T = await import("../public/js/theme.js");
});

beforeEach(() => {
  store.clear();
  dom.vars.clear();
  T.setScheme(T.schemes[0].id);
  T.setIcon(T.icons[0].id);
});

/** Every palette a scheme can ever show: the still one, plus frames if it moves. */
const palettesOf = (scheme) => [
  scheme.vars,
  ...(scheme.frame ? [0, 0.17, 0.4, 0.66, 0.93, 1].map((t) => scheme.frame(t)) : []),
];

test("every scheme paints exactly the same variables, on every frame", () => {
  const wanted = Object.keys(T.schemes[0].vars).sort();
  for (const scheme of T.schemes) {
    for (const palette of palettesOf(scheme)) {
      assert.deepEqual(Object.keys(palette).sort(), wanted,
        `${scheme.id} does not paint the same set as the default`);
    }
  }
});

test("every colour a scheme can show is a complete hex value", () => {
  for (const scheme of T.schemes) {
    for (const palette of palettesOf(scheme)) {
      for (const [name, value] of Object.entries(palette)) {
        assert.match(value, /^#[0-9a-fA-F]{6}$/, `${scheme.id}.${name} is not a hex colour`);
      }
    }
  }
});

// Rule 2 of the file, mechanically: app.css puts --ink on --accent fills all
// over, so a scheme that darkened the accent would hide half the buttons.
test("every scheme keeps a light accent over a dark ground", () => {
  for (const scheme of T.schemes) {
    for (const palette of palettesOf(scheme)) {
      assert.ok(luminance(palette.accent) > 0.35, `${scheme.id}: accent is too dark for dark ink`);
      assert.ok(luminance(palette.ground) < 0.05, `${scheme.id}: ground is too light`);
      assert.ok(luminance(palette.ink) < 0.05, `${scheme.id}: ink is too light for an accent fill`);
      assert.ok(luminance(palette.bone) > 0.6, `${scheme.id}: body text is too dark to read`);
    }
  }
});

test("the moving schemes actually move, and come back round", () => {
  const moving = T.schemes.filter((s) => s.moving);
  assert.ok(moving.length >= 2, "there should be a couple to choose from");

  for (const scheme of moving) {
    assert.ok(scheme.cycle > 0, `${scheme.id} needs a cycle length`);
    // Three, not four: a scheme that swings out and back — Aurora does —
    // passes through the middle of its range twice on the way round.
    const seen = new Set([0, 0.25, 0.5, 0.75].map((t) => scheme.frame(t).accent));
    assert.ok(seen.size >= 3, `${scheme.id} barely moves`);
    assert.notEqual(scheme.frame(0.25).accent, scheme.frame(0.75).accent,
      `${scheme.id} never reaches two different places`);
    assert.equal(scheme.frame(0).accent, scheme.frame(1).accent, `${scheme.id} jumps at the seam`);
  }
});

test("a moving scheme keeps its three roles apart at every point", () => {
  for (const scheme of T.schemes.filter((s) => s.moving)) {
    for (let t = 0; t < 1; t += 0.05) {
      const { accent, magenta, cyan } = scheme.frame(t);
      assert.equal(new Set([accent, magenta, cyan]).size, 3,
        `${scheme.id} collapses two roles into one colour at ${t.toFixed(2)}`);
    }
  }
});

test("hsl converts the corners of the wheel", () => {
  assert.equal(T.hsl(0, 100, 50), "#ff0000");
  assert.equal(T.hsl(120, 100, 50), "#00ff00");
  assert.equal(T.hsl(240, 100, 50), "#0000ff");
  assert.equal(T.hsl(0, 0, 100), "#ffffff");
  assert.equal(T.hsl(0, 0, 0), "#000000");
  assert.equal(T.hsl(-90, 100, 50), T.hsl(270, 100, 50), "a negative hue wraps");
  assert.equal(T.hsl(400, 100, 50), T.hsl(40, 100, 50), "and so does one past the turn");
});

test("ids are unique, so a lookup can never be ambiguous", () => {
  assert.equal(new Set(T.schemes.map((s) => s.id)).size, T.schemes.length);
  assert.equal(new Set(T.icons.map((i) => i.id)).size, T.icons.length);
});

test("an unknown id falls back to the first entry rather than nothing", () => {
  assert.equal(T.schemeById("chartreuse").id, T.schemes[0].id);
  assert.equal(T.schemeById(undefined).id, T.schemes[0].id);
  assert.equal(T.iconById("bulldozer").id, T.icons[0].id);
});

test("every icon names a file of each kind", () => {
  for (const icon of T.icons) {
    assert.match(icon.apple, /^\.\/icons\/apple-touch-icon.*\.png$/, `${icon.id} apple icon`);
    assert.match(icon.tab, /^\.\/icons\/icon-192.*\.png$/, `${icon.id} tab icon`);
  }
});

test("readLook keeps what it recognises and discards the rest", () => {
  assert.deepEqual(T.readLook({ scheme: "mint", icon: "gold" }), { scheme: "mint", icon: "gold" });
  assert.deepEqual(T.readLook({ scheme: "rainbow" }), { scheme: "rainbow", icon: T.icons[0].id });
  assert.deepEqual(T.readLook(null), { scheme: T.schemes[0].id, icon: T.icons[0].id });
  assert.deepEqual(T.readLook("nonsense"), { scheme: T.schemes[0].id, icon: T.icons[0].id });
});

test("paintVars writes every variable, prefixed", () => {
  const scheme = T.schemeById("midnight");
  T.paintVars(scheme.vars);
  for (const [name, value] of Object.entries(scheme.vars)) {
    assert.equal(dom.vars.get(`--${name}`), value);
  }
  assert.equal(dom.vars.size, Object.keys(scheme.vars).length);
});

test("choosing a scheme repaints, retints the status bar and persists", () => {
  T.setScheme("gold");
  const gold = T.schemeById("gold");

  assert.equal(T.currentScheme().id, "gold");
  assert.equal(dom.vars.get("--accent"), gold.vars.accent);
  assert.equal(dom.meta.getAttribute("content"), gold.vars.ground);
  assert.deepEqual(JSON.parse(store.get(KEY)), { scheme: "gold", icon: T.icons[0].id });
});

// Nothing here can animate — there is no requestAnimationFrame in node — so a
// moving scheme has to be legible from its still frame alone, which is also
// exactly what Reduce Motion gets.
test("a moving scheme still paints something without a frame loop", () => {
  T.setScheme("rainbow");
  const still = T.schemeById("rainbow").vars;
  assert.equal(dom.vars.get("--accent"), still.accent);
  assert.equal(dom.vars.get("--ground"), still.ground);
});

test("choosing an icon repoints both links and persists", () => {
  T.setIcon("rainbow");
  const rainbow = T.iconById("rainbow");

  assert.equal(dom.apple.getAttribute("href"), rainbow.apple);
  assert.equal(dom.tab.getAttribute("href"), rainbow.tab);
  assert.deepEqual(JSON.parse(store.get(KEY)), { scheme: T.schemes[0].id, icon: "rainbow" });

  T.setIcon(T.icons[0].id);
  assert.equal(dom.apple.getAttribute("href"), T.icons[0].apple);
});

test("the choice survives a relaunch", () => {
  store.set(KEY, JSON.stringify({ scheme: "aurora", icon: "mint" }));
  assert.deepEqual(T.loadLook(), { scheme: "aurora", icon: "mint" });
  assert.equal(T.currentIcon().apple, T.iconById("mint").apple);
});

test("a stored look that has gone bad leaves the defaults standing", () => {
  store.set(KEY, "{not json");
  assert.deepEqual(T.loadLook(), { scheme: T.schemes[0].id, icon: T.icons[0].id });
});
