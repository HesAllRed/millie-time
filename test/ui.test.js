// Smoke tests for the DOM builders.
//
// These exist because a shadowed binding inside `tile()` once made `h` resolve
// to a number instead of the element helper, which threw mid-render and left
// the sort screen blank. Unit tests over pure logic could never have caught it;
// a stub document can, for about forty lines.

import { test, before } from "node:test";
import assert from "node:assert/strict";

/** The smallest document that the ui module actually touches. */
function installFakeDom() {
  const makeEl = (tag) => ({
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    className: "",
    textContent: "",
    children: [],
    attributes: {},
    listeners: {},
    style: new Proxy({ cssText: "" }, { set: (t, k, v) => { t[k] = v; return true; } }),
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); return kid; },
    removeChild(kid) { this.children = this.children.filter((c) => c !== kid); return kid; },
    get firstChild() { return this.children[0] || null; },
  });

  globalThis.document = {
    createElement: makeEl,
    createTextNode: (data) => ({ nodeType: 3, data: String(data), textContent: String(data) }),
  };
}

let h, clear, tile, crescent, crescentGeometry, tilt;

before(async () => {
  installFakeDom();
  ({ h, clear, tile, crescent, crescentGeometry, tilt } = await import("../public/js/ui.js"));
});

const photo = (id, kind = "photo") => ({ id, kind, url: `blob:${id}`, file: { size: 1 } });

test("h sets class, text, attributes and listeners", () => {
  let fired = 0;
  const el = h("button", { class: "btn", text: "Go", "data-id": "x", onclick: () => fired++ });
  assert.equal(el.tagName, "BUTTON");
  assert.equal(el.className, "btn");
  assert.equal(el.textContent, "Go");
  assert.equal(el.getAttribute("data-id"), "x");
  el.listeners.click[0]();
  assert.equal(fired, 1);
});

test("h skips null and false props but keeps zero", () => {
  const el = h("div", { class: null, hidden: false, "data-n": 0 });
  assert.equal(el.className, "");
  assert.equal(el.getAttribute("hidden"), undefined);
  assert.equal(el.getAttribute("data-n"), 0);
});

test("h appends element and string children, ignoring blanks", () => {
  const el = h("p", {}, "one ", h("b", { text: "two" }), null, false, ["three"]);
  assert.equal(el.children.length, 3);
  assert.equal(el.children[0].nodeType, 3);
  assert.equal(el.children[1].tagName, "B");
});

test("clear empties a node", () => {
  const el = h("div", {}, "a", "b");
  clear(el);
  assert.equal(el.children.length, 0);
});

// The regression itself.
test("tile builds an element and honours width/height", () => {
  const el = tile(photo("a"), { width: 100, height: 126 });
  assert.equal(el.tagName, "BUTTON");
  assert.equal(el.style.width, "100px");
  assert.equal(el.style.height, "126px");
  assert.match(el.className, /\bph\b/);
});

test("tile marks video and selected states", () => {
  assert.match(tile(photo("v", "video")).className, /\bvid\b/);
  assert.match(tile(photo("s"), { selected: true }).className, /\bsel\b/);
  assert.doesNotMatch(tile(photo("p")).className, /\bvid\b/);
});

test("tile wires its tap handler through to the item", () => {
  let got = null;
  const item = photo("t");
  const el = tile(item, { onTap: (i) => { got = i; } });
  el.listeners.click[0]({});
  assert.equal(got, item);
});

test("crescent renders every tile up to the cap, then a chip", () => {
  const three = crescent([photo("1"), photo("2"), photo("3")]);
  assert.equal(three.children.length, 3);

  const nine = crescent(Array.from({ length: 9 }, (_, i) => photo(`p${i}`)));
  assert.equal(nine.children.length, 6, "five tiles plus the +N chip");
  assert.equal(nine.children[5].textContent, "+4");
});

test("crescent tiles all get a transform, and none is NaN", () => {
  const wrap = crescent([photo("1"), photo("2"), photo("3"), photo("4")]);
  for (const child of wrap.children) {
    if (child.className === "more") continue;
    assert.match(child.style.transform, /^rotate\(-?\d+(\.\d+)?deg\) translateY\(-?\d+px\)$/);
  }
});

test("crescentGeometry shrinks as the day gets heavier and caps at five", () => {
  const one  = crescentGeometry(1);
  const four = crescentGeometry(4);
  const nine = crescentGeometry(9);
  assert.equal(one.max, 1);
  assert.equal(nine.max, 5);
  assert.ok(one.w > four.w && four.w > nine.w, "tiles should shrink");
  assert.ok(crescentGeometry(3, true).w < crescentGeometry(3).w, "compact is smaller");
});

test("tilt spreads symmetrically and stays flat for a single tile", () => {
  assert.deepEqual(tilt(0, 1), { rot: -3, ty: 0 });
  const first = tilt(0, 5);
  const last = tilt(4, 5);
  assert.equal(first.rot, -last.rot);
  assert.equal(tilt(2, 5).rot, 0, "the middle tile sits upright");
  assert.ok(first.ty > tilt(2, 5).ty, "the ends drop below the centre");
});
