// Confetti, sprayed from wherever she tapped.
//
// One canvas over the whole shell, one animation frame loop, no library. The
// physics is split out as two pure functions so it can be tested without a
// canvas — the failure mode here is a stray NaN in a velocity, which leaves
// nothing on screen and no error anywhere to say why.

import { prefersReducedMotion } from "./ui.js";

const GRAVITY = 1500;        // px/s², tuned to fall out of frame in about a second
const DRAG = 0.86;           // per second, applied to horizontal drift
const FADE = 0.35;           // the last third of a piece's life is its fade

/**
 * A fresh burst at (x, y), in canvas coordinates.
 *
 * `calm` is Reduce Motion: the same confetti, minus the flight. It settles in
 * place and fades rather than being thrown across the screen.
 */
export function makePieces(x, y, colors, { count = 34, calm = false, rand = Math.random } = {}) {
  const palette = colors && colors.length ? colors : ["#D3D3FF"];
  const pieces = [];
  for (let i = 0; i < count; i++) {
    // A fan, upward and outward. Straight up would come straight back down
    // through the same point and read as a fountain rather than a spray.
    const angle = -Math.PI / 2 + (rand() - 0.5) * 2.1;
    const speed = calm ? 18 + rand() * 26 : 260 + rand() * 460;
    pieces.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: calm ? 0 : GRAVITY,
      w: 5 + rand() * 5,
      h: 8 + rand() * 7,
      rot: rand() * Math.PI * 2,
      spin: calm ? 0 : (rand() - 0.5) * 14,
      colour: palette[Math.floor(rand() * palette.length) % palette.length],
      life: 0,
      max: calm ? 0.55 + rand() * 0.25 : 0.9 + rand() * 0.7,
    });
  }
  return pieces;
}

/** Advance every piece by dt seconds and drop the spent ones. Pure enough. */
export function advance(pieces, dt) {
  for (const p of pieces) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.gravity * dt;
    p.vx *= Math.pow(DRAG, dt);
    p.rot += p.spin * dt;
  }
  return pieces.filter((p) => p.life < p.max);
}

/** 1 while the piece is in full colour, easing to 0 over the tail of its life. */
export function fade(piece) {
  const left = 1 - piece.life / piece.max;
  return left >= FADE ? 1 : Math.max(0, left / FADE);
}

// ---------------------------------------------------------------------------
// The canvas side.
// ---------------------------------------------------------------------------

let canvas = null;
let ctx = null;
let live = [];
let raf = null;
let last = 0;
let cssW = 0;
let cssH = 0;

// The backing store is in device pixels; everything above this line thinks in
// CSS pixels, which is also what a tap reports. The transform reconciles the
// two, and cssW/cssH are kept so clearing doesn't have to reverse it.
function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cssW = canvas.clientWidth || window.innerWidth;
  cssH = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function installConfetti(el) {
  canvas = el;
  ctx = canvas?.getContext?.("2d");
  if (!ctx) { canvas = null; return; }
  resize();
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
}

/** The colours currently on screen, so a spray always matches the scheme. */
function paletteFromTheme() {
  const style = getComputedStyle(document.documentElement);
  return ["--accent", "--magenta", "--cyan", "--bone"]
    .map((name) => style.getPropertyValue(name).trim())
    .filter(Boolean);
}

function frame(now) {
  raf = null;
  const dt = Math.min((now - last) / 1000, 0.032);   // a backgrounded tab must not teleport
  last = now;

  live = advance(live, dt);
  ctx.clearRect(0, 0, cssW, cssH);

  for (const p of live) {
    ctx.save();
    ctx.globalAlpha = fade(p);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.colour;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }

  if (live.length) raf = requestAnimationFrame(frame);
}

/**
 * Spray at a point given in client coordinates.
 *
 * Converted through the canvas's own rect rather than used directly: the whole
 * shell follows the visual viewport, so on iOS with the keyboard open the
 * canvas is not at the top of the client area.
 */
export function spray(clientX, clientY) {
  if (!ctx) return 0;
  resize();
  const rect = canvas.getBoundingClientRect();
  const calm = prefersReducedMotion();
  const fresh = makePieces(clientX - rect.left, clientY - rect.top, paletteFromTheme(), {
    count: calm ? 16 : 38,
    calm,
  });

  // A cap, so leaning on the button can't stack up a thousand rectangles a
  // frame on a phone that is also decoding video.
  live = live.concat(fresh).slice(-320);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  return fresh.length;
}
