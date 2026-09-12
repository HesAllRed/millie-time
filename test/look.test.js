// The look — the colour schemes, the moving ones, and the one she mixes.
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

  globalThis.document = {
    documentElement: { style: { setProperty: (k, v) => vars.set(k, v) } },
    querySelector: (sel) => (sel.includes("theme-color") ? meta : null),
  };
  return { vars, meta };
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

/** Rule 2: app.css puts --ink on --accent fills all over. */
function assertLegible(palette, where) {
  assert.ok(luminance(palette.accent) > 0.35, `${where}: accent is too dark for dark ink`);
  assert.ok(luminance(palette.ground) < 0.05, `${where}: ground is too light`);
  assert.ok(luminance(palette.ink) < 0.05, `${where}: ink is too light for an accent fill`);
  assert.ok(luminance(palette.bone) > 0.6, `${where}: body text is too dark to read`);
}

test("every scheme keeps a light accent over a dark ground", () => {
  for (const scheme of T.schemes) {
    for (const palette of palettesOf(scheme)) assertLegible(palette, scheme.id);
  }
});

// The one that lets the picker be handed over without a warning: there is no
// hue, and no position of the vividness slider, that makes the app unreadable.
test("nothing the picker can reach is illegible", () => {
  for (let hue = 0; hue < 360; hue += 5) {
    for (const vivid of [0, 0.15, 0.4, 0.75, 1]) {
      assertLegible(T.spectrum(hue, vivid), `custom ${hue}° at ${vivid}`);
    }
  }
});

test("the vividness slider runs all the way to grey and stays there", () => {
  const grey = T.spectrum(210, 0);
  assert.equal(grey.accent, T.spectrum(40, 0).accent, "at zero the hue stops mattering");
  assert.equal(T.hslOf(grey.accent).s, 0);
  assert.ok(T.hslOf(T.spectrum(210, 1).accent).s > 80, "and at full it is vivid");
});

test("an out-of-range vividness is clamped rather than inverted", () => {
  assert.deepEqual(T.spectrum(120, 4), T.spectrum(120, 1));
  assert.deepEqual(T.spectrum(120, -2), T.spectrum(120, 0));
});

// Only for colours with enough saturation to have a hue worth reading: at 14%
// of it the eight bits per channel a hex value gets are too coarse to say.
test("hslOf reads back what hsl wrote", () => {
  for (const [h, s, l] of [[0, 100, 50], [210, 60, 40], [300, 90, 82], [47, 65, 62]]) {
    const back = T.hslOf(T.hsl(h, s, l));
    assert.ok(Math.abs(back.h - h) <= 1, `hue ${h} came back as ${back.h}`);
    assert.ok(Math.abs(back.s - s) <= 1, `saturation ${s} came back as ${back.s}`);
    assert.ok(Math.abs(back.l - l) <= 1, `lightness ${l} came back as ${back.l}`);
  }
  assert.equal(T.hslOf("#808080").s, 0, "grey has no hue to speak of");
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
  assert.ok(!T.schemes.some((s) => s.id === T.CUSTOM), "hers is not one of the presets");
});

test("an unknown id falls back to the first entry rather than nothing", () => {
  assert.equal(T.schemeById("chartreuse").id, T.schemes[0].id);
  assert.equal(T.schemeById(undefined).id, T.schemes[0].id);
  assert.equal(T.schemeById(T.CUSTOM).id, T.CUSTOM, "but hers is a real answer");
});

test("readLook keeps what it recognises and discards the rest", () => {
  const stock = T.readLook(null);
  assert.equal(stock.scheme, T.schemes[0].id);
  assert.ok(stock.custom.hue >= 0 && stock.custom.hue < 360);

  assert.deepEqual(T.readLook({ scheme: "mint", custom: { hue: 12, vivid: 40 } }),
    { scheme: "mint", custom: { hue: 12, vivid: 40 } });
  assert.equal(T.readLook({ scheme: T.CUSTOM }).scheme, T.CUSTOM);
  assert.deepEqual(T.readLook("nonsense").custom, stock.custom);
});

test("a stored colour that has gone strange is brought back into range", () => {
  assert.equal(T.readLook({ custom: { hue: 400 } }).custom.hue, 40, "a hue past the turn wraps");
  assert.equal(T.readLook({ custom: { hue: -30 } }).custom.hue, 330, "and so does a negative one");
  assert.equal(T.readLook({ custom: { vivid: 900 } }).custom.vivid, 100, "vividness is clamped");
  assert.equal(T.readLook({ custom: { vivid: -5 } }).custom.vivid, 0);
  assert.deepEqual(T.readLook({ custom: { hue: "purple", vivid: null } }).custom,
    T.readLook(null).custom, "nonsense falls back whole");
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
  assert.equal(JSON.parse(store.get(KEY)).scheme, "gold");
});

test("mixing her own paints it and becomes the scheme in play", () => {
  T.setCustom({ hue: 18, vivid: 70 });

  assert.equal(T.currentScheme().id, T.CUSTOM);
  assert.deepEqual(T.currentLook().custom, { hue: 18, vivid: 70 });
  assert.equal(dom.vars.get("--accent"), T.spectrum(18, 0.7).accent);
  assert.equal(dom.meta.getAttribute("content"), T.spectrum(18, 0.7).ground);
});

test("one slider moves without dragging the other with it", () => {
  T.setCustom({ hue: 18, vivid: 70 });
  T.setCustom({ hue: 200 });
  assert.deepEqual(T.currentLook().custom, { hue: 200, vivid: 70 });
  T.setCustom({ vivid: 25 });
  assert.deepEqual(T.currentLook().custom, { hue: 200, vivid: 25 });
});

// Stored a beat later, not on every pixel of the drag — a hundred writes for
// one gesture is what this avoids.
test("a mixed colour is written out once the thumb settles", async () => {
  await new Promise((r) => setTimeout(r, 260));   // let any earlier drag settle
  store.clear();

  T.setCustom({ hue: 305, vivid: 88 });
  assert.equal(store.get(KEY), undefined, "nothing written yet");

  await new Promise((r) => setTimeout(r, 260));
  assert.deepEqual(JSON.parse(store.get(KEY)),
    { scheme: T.CUSTOM, custom: { hue: 305, vivid: 88 } });
});

test("the label says enough to debug from", () => {
  T.setScheme("mint");
  assert.equal(T.lookLabel(), "mint");
  T.setCustom({ hue: 44, vivid: 60 });
  assert.match(T.lookLabel(), /^custom 44° at 60%$/);
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

test("her own colour survives a relaunch", () => {
  store.set(KEY, JSON.stringify({ scheme: T.CUSTOM, custom: { hue: 96, vivid: 55 } }));
  T.loadLook();
  T.applyLook();

  assert.equal(T.currentScheme().id, T.CUSTOM);
  assert.equal(dom.vars.get("--accent"), T.spectrum(96, 0.55).accent);
});

test("a stored look that has gone bad leaves the defaults standing", () => {
  store.set(KEY, "{not json");
  assert.deepEqual(T.loadLook(), T.readLook(null));
});
