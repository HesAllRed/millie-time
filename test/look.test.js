// The look — colour scheme and logo.
//
// The one that matters is the first: a scheme that forgets a variable doesn't
// throw, it just leaves the previous scheme's colour in place, and you get a
// palette nobody designed with no error anywhere to say so.

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const KEY = "millie.look.v1";
const STOCK_ICON = "./icons/icon-192.png";

function installFakeDom() {
  const vars = new Map();
  const el = (attrs) => ({
    attrs: { ...attrs },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
  });
  const meta = el({ name: "theme-color", content: "#101116" });
  const link = el({ rel: "icon", href: STOCK_ICON });

  globalThis.document = {
    documentElement: { style: { setProperty: (k, v) => vars.set(k, v) } },
    querySelector: (sel) => (sel.includes("theme-color") ? meta : sel.includes("icon") ? link : null),
    dispatchEvent: () => true,
  };
  return { vars, meta, link };
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
  T.setLogo(T.logos[0].id);
});

test("every scheme paints exactly the same variables", () => {
  const wanted = Object.keys(T.schemes[0].vars).sort();
  for (const scheme of T.schemes) {
    assert.deepEqual(Object.keys(scheme.vars).sort(), wanted,
      `${scheme.id} does not paint the same set as the default`);
  }
});

test("every scheme's colours are complete hex values", () => {
  for (const scheme of T.schemes) {
    for (const [name, value] of Object.entries(scheme.vars)) {
      assert.match(value, /^#[0-9A-Fa-f]{6}$/, `${scheme.id}.${name} is not a hex colour`);
    }
  }
});

test("ids are unique, so a lookup can never be ambiguous", () => {
  assert.equal(new Set(T.schemes.map((s) => s.id)).size, T.schemes.length);
  assert.equal(new Set(T.logos.map((l) => l.id)).size, T.logos.length);
});

test("an unknown id falls back to the first entry rather than nothing", () => {
  assert.equal(T.schemeById("chartreuse").id, T.schemes[0].id);
  assert.equal(T.schemeById(undefined).id, T.schemes[0].id);
  assert.equal(T.logoById("bulldozer").id, T.logos[0].id);
});

test("readLook keeps what it recognises and discards the rest", () => {
  assert.deepEqual(T.readLook({ scheme: "mint", logo: "star" }), { scheme: "mint", logo: "star" });
  assert.deepEqual(T.readLook({ scheme: "mint" }), { scheme: "mint", logo: T.logos[0].id });
  assert.deepEqual(T.readLook(null), { scheme: T.schemes[0].id, logo: T.logos[0].id });
  assert.deepEqual(T.readLook("nonsense"), { scheme: T.schemes[0].id, logo: T.logos[0].id });
});

test("paintScheme writes every variable, prefixed", () => {
  const scheme = T.schemeById("midnight");
  T.paintScheme(scheme);
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
  assert.deepEqual(JSON.parse(store.get(KEY)), { scheme: "gold", logo: T.logos[0].id });
});

test("the choice survives a relaunch", () => {
  T.setScheme("sunset");
  T.setLogo("moon");

  T.setScheme(T.schemes[0].id);            // as if the app had just booted
  T.setLogo(T.logos[0].id);
  store.set(KEY, JSON.stringify({ scheme: "sunset", logo: "moon" }));

  assert.deepEqual(T.loadLook(), { scheme: "sunset", logo: "moon" });
  assert.equal(T.logoGlyph(), T.logoById("moon").glyph);
});

test("a stored look that has gone bad leaves the defaults standing", () => {
  store.set(KEY, "{not json");
  assert.deepEqual(T.loadLook(), { scheme: T.schemes[0].id, logo: T.logos[0].id });
});

// The crafted icon beats any emoji, so it is only displaced by an actual choice.
test("the tab icon changes only once she picks something other than the default", () => {
  T.setLogo("paw");
  assert.match(dom.link.getAttribute("href"), /^data:image\/svg\+xml,/);

  T.setLogo(T.logos[0].id);
  assert.equal(dom.link.getAttribute("href"), STOCK_ICON);
});

test("glyphIcon escapes into a usable data URI", () => {
  const uri = T.glyphIcon("🌙");
  assert.ok(uri.startsWith("data:image/svg+xml,"));
  const svg = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
  assert.ok(svg.includes("🌙"));
  assert.ok(svg.includes("<svg xmlns=\"http://www.w3.org/2000/svg\""));
  assert.doesNotMatch(uri, /[<>"#]/, "unescaped markup would break the attribute");
});
