// The confetti physics.
//
// Pure on purpose: a stray NaN in a velocity draws nothing at all and reports
// nothing at all, which on a phone with no console is unfindable.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makePieces, advance, fade } from "../public/js/confetti.js";

const COLOURS = ["#D3D3FF", "#E0479E", "#4FC3D9"];

/** A deterministic stand-in for Math.random, cycling the whole 0..1 range. */
function seeded() {
  let n = 0;
  return () => ((n = (n * 9301 + 49297) % 233280) / 233280);
}

const finite = (p) => [p.x, p.y, p.vx, p.vy, p.w, p.h, p.rot, p.max].every(Number.isFinite);

test("a burst starts at the tap and is finite throughout", () => {
  const pieces = makePieces(120, 300, COLOURS, { count: 40, rand: seeded() });
  assert.equal(pieces.length, 40);
  for (const p of pieces) {
    assert.equal(p.x, 120);
    assert.equal(p.y, 300);
    assert.ok(finite(p), "a piece carries a value that isn't a number");
    assert.ok(p.max > 0);
    assert.ok(COLOURS.includes(p.colour));
  }
});

test("the fan is upward and spread, never a single line", () => {
  const pieces = makePieces(0, 0, COLOURS, { count: 60, rand: seeded() });
  assert.ok(pieces.every((p) => p.vy < 0), "everything leaves the thumb going up");
  const drifts = new Set(pieces.map((p) => Math.sign(p.vx)));
  assert.ok(drifts.has(1) && drifts.has(-1), "it should spray both ways");
});

test("a piece with no colours to draw from still gets one", () => {
  const [p] = makePieces(0, 0, [], { count: 1, rand: seeded() });
  assert.match(p.colour, /^#[0-9A-Fa-f]{6}$/);
});

test("gravity turns a burst around", () => {
  let pieces = makePieces(0, 0, COLOURS, { count: 12, rand: seeded() });
  assert.ok(pieces.every((p) => p.vy < 0), "up first");

  for (let i = 0; i < 40; i++) pieces = advance(pieces, 1 / 60);
  assert.equal(pieces.length, 12, "nothing is spent this early");
  assert.ok(pieces.every((p) => p.vy > 0), "falling by two thirds of a second");
  assert.ok(pieces.every(finite));

  // Marked on the pieces themselves rather than by index: advance() drops the
  // spent ones, so positions in the array do not survive a step.
  for (const p of pieces) p.apex = p.y;
  for (let i = 0; i < 20; i++) pieces = advance(pieces, 1 / 60);
  assert.ok(pieces.length, "and some are still in the air");
  assert.ok(pieces.every((p) => p.y > p.apex), "each one lower than it was");
});

test("advance drops the spent pieces and keeps the rest", () => {
  const pieces = makePieces(0, 0, COLOURS, { count: 20, rand: seeded() });
  const shortest = Math.min(...pieces.map((p) => p.max));
  const left = advance(pieces, shortest + 0.001);
  assert.ok(left.length < pieces.length, "at least the shortest-lived one is gone");
  assert.ok(advance(left, 10).length === 0, "eventually everything clears");
});

test("Reduce Motion settles in place instead of flying", () => {
  const calm = makePieces(50, 50, COLOURS, { count: 12, calm: true, rand: seeded() });
  assert.ok(calm.every((p) => p.gravity === 0 && p.spin === 0));

  const [fast] = makePieces(50, 50, COLOURS, { count: 1, rand: seeded() });
  const [slow] = calm;
  assert.ok(Math.abs(slow.vy) < Math.abs(fast.vy), "and far more gently");
});

test("a piece is full strength until the tail of its life, then fades out", () => {
  const p = { life: 0, max: 1 };
  assert.equal(fade(p), 1);
  p.life = 0.6;
  assert.equal(fade(p), 1);
  p.life = 0.9;
  assert.ok(fade(p) > 0 && fade(p) < 1);
  p.life = 1;
  assert.equal(fade(p), 0);
});
