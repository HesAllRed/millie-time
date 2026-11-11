// Renders the week onto a card and hands back a File.
//
// The print is the week as one object: the words, and — in every style but the
// first — some of the photos with them. It is file #1 in the payload, so it is
// the first thing that lands and the one picture that holds the whole week.
//
// There is no single right print, so there is no single print. She picks a
// style on the Send card each time, the last one she picked is what she gets
// next time, and she can leave the print out of a share altogether.
//
// It is warm paper rather than the app's dark, because it isn't app chrome —
// it's the object she is actually sending, and it reads far better than a dark
// card would in a bright Messages thread.

import { dayLabel, rangeLabel } from "./dates.js";
import { messageDays } from "./compose.js";
import { tilt } from "./ui.js";

// ---------------------------------------------------------------------------
// The styles, and her choice between them.
// ---------------------------------------------------------------------------

/** In the order the Send card offers them. `photos` is how many each wants. */
export const PRINT_STYLES = [
  { id: "words",    label: "Words",    photos: 0 },
  { id: "strip",    label: "Strip",    photos: 6 },
  { id: "beside",   label: "Beside",   photos: 0 },   // one per day, see layout
  { id: "mosaic",   label: "Mosaic",   photos: 6 },
  { id: "crescent", label: "Crescent", photos: 5 },
  { id: "hero",     label: "Hero",     photos: 1 },
];

const STYLE_IDS = new Set(PRINT_STYLES.map((s) => s.id));
const PREFS_KEY = "millie.print.v1";
const DEFAULT_PREFS = { style: "words", on: true };

/** Stored preferences, reduced to what we can trust. Pure; tested. */
export function readPrintPrefs(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    style: STYLE_IDS.has(src.style) ? src.style : DEFAULT_PREFS.style,
    on: typeof src.on === "boolean" ? src.on : DEFAULT_PREFS.on,
  };
}

let prefs = null;

/** Her current choice. Read once from storage, then held. */
export function printPrefs() {
  if (!prefs) {
    try { prefs = readPrintPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "null")); }
    catch { prefs = { ...DEFAULT_PREFS }; }
  }
  return prefs;
}

/**
 * Change it, remember it, and say so. main.js redraws on the event; the Send
 * card repaints itself from the returned value.
 */
export function setPrintPrefs(patch) {
  prefs = readPrintPrefs({ ...printPrefs(), ...patch });
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
  catch { /* private or full — the choice still holds for this session */ }
  if (typeof document !== "undefined") document.dispatchEvent(new Event("print-prefs-changed"));
  return prefs;
}

// ---------------------------------------------------------------------------
// Which photos go on it. Pure; tested.
// ---------------------------------------------------------------------------

const drawable = (item) => !!item && !!item.url;

/**
 * Up to `n` photos, spread across the week rather than taken from the front of
 * it — a print of six photos from Monday is a print of Monday.
 *
 * One from each day in turn, then a second from each, and so on; within a day,
 * real photos before video posters, which are frame grabs and look it. Handed
 * back in the order the week reads.
 *
 * Photos not on a day are only used when nothing on a day is drawable.
 */
export function pickPhotos(items, span, n) {
  if (n <= 0) return [];
  const order = new Map(span.map((iso, i) => [iso, i]));
  const placed = items.filter((it) => drawable(it) && order.has(it.day));

  if (!placed.length) {
    return items.filter((it) => drawable(it) && !order.has(it.day)).slice(0, n);
  }

  const queues = span.map((iso) => placed
    .filter((it) => it.day === iso)
    .sort((a, b) => (a.kind === "video") - (b.kind === "video")))
    .filter((q) => q.length);

  const chosen = new Set();
  for (let round = 0; chosen.size < n; round++) {
    let took = false;
    for (const q of queues) {
      if (round < q.length && chosen.size < n) { chosen.add(q[round]); took = true; }
    }
    if (!took) break;
  }

  // Back into the order the week reads: by day, then as she placed them.
  return placed
    .filter((it) => chosen.has(it))
    .sort((a, b) => order.get(a.day) - order.get(b.day));    // stable: ties keep her order
}

/** The photo that sits beside a day's words, if the day has one. */
export function photoForDay(items, iso) {
  return pickPhotos(items.filter((it) => it.day === iso), [iso], 1)[0] || null;
}

// ---------------------------------------------------------------------------
// Paper, ink and type.
// ---------------------------------------------------------------------------

const W        = 1080;
const PAD      = 72;
const PAPER    = "#F2EBE2";
const INK      = "#17161A";
const ACCENT   = "#5F52A8";
const HAIRLINE = "rgba(23,22,26,0.16)";
const MOUNT    = "#FBF7F1";

const UI    = '800 %spx "Bricolage Grotesque", system-ui, "Apple Color Emoji", sans-serif';
const HAND  = '400 %spx "Fraunces", Georgia, "Apple Color Emoji", serif';
const MONO  = '500 %spx "JetBrains Mono", ui-monospace, "Apple Color Emoji", monospace';
const font = (tpl, size) => tpl.replace("%s", size);

// The day rows, shared by every style.
const LABEL_W = 118;     // weekday column
const THUMB   = 120;     // the photo beside a day
const THUMB_W = 150;     // ...and the column it sits in
const LINE_H  = 46;
const ROW_PAD = 26;

/**
 * Split into grapheme clusters so emoji survive.
 * Naively splitting a string by character shreds surrogate pairs into boxes,
 * and breaks ZWJ sequences like 👩‍👩‍👧 into their component people.
 */
function graphemes(str) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(seg.segment(str), (s) => s.segment);
  }
  return Array.from(str);   // code points: worse, but still emoji-aware
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }

      // A single word wider than the line (a long URL, a wall of emoji) has to
      // be broken mid-word — by grapheme, never by code unit.
      if (ctx.measureText(word).width > maxWidth) {
        let chunk = "";
        for (const g of graphemes(word)) {
          if (ctx.measureText(chunk + g).width > maxWidth && chunk) { lines.push(chunk); chunk = ""; }
          chunk += g;
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

/** Canvas silently falls back to a system face unless the font is really loaded. */
async function ensureFonts() {
  if (!document.fonts) return;
  const wanted = [
    font(UI, 64), font(UI, 52), font(UI, 44),
    font(HAND, 34),
    font(MONO, 22),
  ];
  try {
    await Promise.all(wanted.map((f) => document.fonts.load(f, "Millie 0123 ☕")));
    await document.fonts.ready;
  } catch { /* a fallback face is better than no card */ }
}

// ---------------------------------------------------------------------------
// Photos, decoded once.
//
// Switching style on the Send card redraws the print, and decoding six photos
// again for every tap would make the chips feel sticky. The shrunk share copy
// is used where there is one: a tenth of the pixels of the original, and the
// print draws them at a few hundred pixels across anyway.
// ---------------------------------------------------------------------------

const decoded = new Map();     // item id -> Promise<HTMLImageElement|null>

function loadImage(item) {
  if (decoded.has(item.id)) return decoded.get(item.id);
  const job = (async () => {
    const own = item.share ? URL.createObjectURL(item.share) : null;
    try {
      const img = new Image();
      img.src = own || item.url;
      await img.decode();
      return img;
    } catch {
      return null;               // an undecodable photo is left off, not fatal
    } finally {
      if (own) URL.revokeObjectURL(own);
    }
  })();
  decoded.set(item.id, job);
  return job;
}

/** Forget anything no longer in the week, so removed photos are not held. */
function pruneDecoded(items) {
  const live = new Set(items.map((i) => i.id));
  for (const id of decoded.keys()) if (!live.has(id)) decoded.delete(id);
}

async function loadAll(list) {
  const imgs = await Promise.all(list.map(loadImage));
  return list.map((item, i) => ({ item, img: imgs[i] })).filter((p) => p.img);
}

// ---------------------------------------------------------------------------
// Drawing helpers.
// ---------------------------------------------------------------------------

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Fill a box with a photo, cropped rather than squashed. The crop sits a little
 * above centre, because that is where faces are.
 */
function cover(ctx, img, x, y, w, h, r = 4) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s, sh = h / s;
  ctx.save();
  if (r) { round(ctx, x, y, w, h, r); ctx.clip(); }
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) * 0.4, sw, sh, x, y, w, h);
  ctx.restore();
}

/** Range left, app name right, a rule under both. Returns the rule's bottom. */
function masthead(ctx, y, range, name, rule = 3) {
  ctx.textBaseline = "alphabetic";
  ctx.font = font(MONO, 22);
  ctx.fillStyle = ACCENT;
  ctx.textAlign = "left";
  ctx.fillText(range, PAD, y);
  ctx.textAlign = "right";
  ctx.fillText(name, W - PAD, y);
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.fillRect(PAD, y + 16, W - PAD * 2, rule);
  return y + 16 + rule;
}

// ---------------------------------------------------------------------------
// The day rows.
//
// Laid out first, drawn second: every style needs the rows' height before it
// can size the canvas, and measuring them is the same work as wrapping them.
// ---------------------------------------------------------------------------

function layRows(measure, rows, { thumbs = false } = {}) {
  const width = W - PAD * 2;
  const textW = width - (thumbs ? THUMB_W : LABEL_W);
  measure.font = font(HAND, 34);
  return rows.map((row) => {
    const lines = wrap(measure, row.text, textW);
    const height = thumbs
      // weekday above the words, the photo to their left
      ? Math.max(row.img ? THUMB + 44 : 0, 76 + lines.length * LINE_H)
      : ROW_PAD * 2 + lines.length * LINE_H;
    return { ...row, lines, height };
  });
}

const rowsHeight = (laid) => laid.reduce((sum, r) => sum + r.height, 0);

function drawRows(ctx, laid, top, { thumbs = false } = {}) {
  let y = top;
  laid.forEach((row, i) => {
    const wd = dayLabel(row.iso).wd;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    if (thumbs) {
      if (row.img) cover(ctx, row.img, PAD, y + 22, THUMB, THUMB);
      const textX = PAD + THUMB_W;
      ctx.font = font(MONO, 22);
      ctx.fillStyle = ACCENT;
      ctx.fillText(wd, textX, y + 46);
      ctx.font = font(HAND, 34);
      ctx.fillStyle = INK;
      row.lines.forEach((line, n) => ctx.fillText(line, textX, y + 88 + n * LINE_H));
    } else {
      ctx.font = font(MONO, 22);
      ctx.fillStyle = ACCENT;
      ctx.fillText(wd, PAD, y + ROW_PAD + 26);
      ctx.font = font(HAND, 34);
      ctx.fillStyle = INK;
      row.lines.forEach((line, n) => ctx.fillText(line, PAD + LABEL_W, y + ROW_PAD + 30 + n * LINE_H));
    }

    y += row.height;
    if (i < laid.length - 1) {
      ctx.fillStyle = HAIRLINE;
      ctx.fillRect(PAD, y - 1, W - PAD * 2, 2);
    }
  });
  return y;
}

// ---------------------------------------------------------------------------
// The layouts. Each takes what has been laid out and returns the canvas height
// and a function that paints it, so the canvas is made once at the right size.
// ---------------------------------------------------------------------------

const LAYOUTS = {
  // The original: the words, and nothing else.
  words({ laid, range, name, title }) {
    const top = PAD + 30 + 26 + 34 + 74;
    return {
      height: Math.round(top + rowsHeight(laid) + PAD - 10),
      paint(ctx) {
        masthead(ctx, PAD + 22, range, name, 5);
        ctx.font = font(UI, 64);
        ctx.fillStyle = INK;
        ctx.fillText(title, PAD, PAD + 44 + 84);
        drawRows(ctx, laid, top);
      },
    };
  },

  // A row of photos under the title.
  strip({ laid, photos, range, name, title }) {
    const gap = 10;
    const n = photos.length;
    const pw = (W - PAD * 2 - gap * (n - 1)) / n;
    const ph = Math.min(260, Math.round(pw * 1.15));
    const stripTop = PAD + 24 + 19 + 52 + 28;
    const rowsTop = stripTop + ph + 26;
    return {
      height: Math.round(rowsTop + rowsHeight(laid) + PAD - 20),
      paint(ctx) {
        const ruled = masthead(ctx, PAD + 24, range, name);
        ctx.font = font(UI, 44);
        ctx.fillStyle = INK;
        ctx.fillText(title, PAD, ruled + 52);
        photos.forEach((p, i) => cover(ctx, p.img, PAD + i * (pw + gap), stripTop, pw, ph));
        drawRows(ctx, laid, rowsTop);
      },
    };
  },

  // A photo beside each day's words.
  beside({ laid, range, name, title }) {
    const rowsTop = PAD + 24 + 19 + 52 + 14;
    return {
      height: Math.round(rowsTop + rowsHeight(laid) + PAD - 20),
      paint(ctx) {
        const ruled = masthead(ctx, PAD + 24, range, name);
        ctx.font = font(UI, 44);
        ctx.fillStyle = INK;
        ctx.fillText(title, PAD, ruled + 52);
        drawRows(ctx, laid, rowsTop, { thumbs: true });
      },
    };
  },

  // The photos edge to edge across the head of the paper.
  mosaic({ laid, photos, range, name, title }) {
    const n = photos.length;
    const shape = [[1], [2], [3], [2, 2], [2, 3], [3, 3]][Math.min(n, 6) - 1];
    const rowH = { 1: 520, 2: 300, 3: 220 };
    const gridH = shape.reduce((sum, cols) => sum + rowH[cols], 0);
    const headY = gridH + 60;
    const rowsTop = headY + 19 + 52 + 14;
    return {
      height: Math.round(rowsTop + rowsHeight(laid) + PAD - 20),
      paint(ctx) {
        let at = 0, y = 0;
        for (const cols of shape) {
          const cw = W / cols;
          for (let c = 0; c < cols; c++) {
            // a pixel of overlap so no paper shows through between tiles
            cover(ctx, photos[at++].img, Math.floor(c * cw), y, Math.ceil(cw) + 1, rowH[cols] + 1, 0);
          }
          y += rowH[cols];
        }
        const ruled = masthead(ctx, headY, range, name);
        ctx.font = font(UI, 44);
        ctx.fillStyle = INK;
        ctx.fillText(title, PAD, ruled + 52);
        drawRows(ctx, laid, rowsTop);
      },
    };
  },

  // The week's photos on a gentle arc, set out the way the Sort screen sets
  // them out when she is choosing them: every photo the same size, each with
  // its own room, none covering another. The deck's fan lifts the middle photo
  // in front of its neighbours; a print of the week should not favour a day.
  crescent({ laid, photos, range, name, title }) {
    const n = photos.length;
    const gap = 26;
    const tw = Math.min(n === 1 ? 260 : 200, (W - PAD * 2 - 120 - (n - 1) * gap) / n);   // room for the tilt
    const th = tw * 1.25;                    // the Sort tile's 4:5
    const border = 7, shadow = 10;
    const lift = th * 0.2;                   // the deck's 22px on a 100px tile

    const tiles = photos.map((p, i) => {
      const { rot, ty } = tilt(i, n);        // the deck's arc: ±12°, outer ones lower
      return { p, x: W / 2 + (i - (n - 1) / 2) * (tw + gap),
               rot: (rot * Math.PI) / 180, ty: (ty / 22) * lift };
    });

    // How far the arc reaches up and down, so the canvas fits it exactly.
    let minY = Infinity, maxY = -Infinity;
    const hw = tw / 2 + border, hh = th / 2 + border;
    for (const t of tiles) {
      for (const [cx, cy] of [[-hw, -hh], [hw + shadow, -hh], [-hw, hh + shadow], [hw + shadow, hh + shadow]]) {
        const y = t.ty + Math.sin(t.rot) * cx + Math.cos(t.rot) * cy;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const axis = PAD + 24 + 19 + 48 - minY;
    const titleY = axis + maxY + 44 + 44;
    const rowsTop = titleY + 14;

    return {
      height: Math.round(rowsTop + rowsHeight(laid) + PAD - 20),
      paint(ctx) {
        masthead(ctx, PAD + 24, range, name);
        for (const t of tiles) {
          ctx.save();
          ctx.translate(t.x, axis + t.ty);
          ctx.rotate(t.rot);
          // The Sort tile: a hard offset shadow, a mount, the photo.
          ctx.fillStyle = "rgba(23,22,26,.42)";
          ctx.fillRect(-hw + shadow, -hh + shadow, hw * 2, hh * 2);
          ctx.fillStyle = MOUNT;
          ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
          cover(ctx, t.p.img, -tw / 2, -th / 2, tw, th, 0);
          ctx.restore();
        }
        ctx.font = font(UI, 44);
        ctx.fillStyle = INK;
        ctx.textAlign = "left";
        ctx.fillText(title, PAD, titleY);
        drawRows(ctx, laid, rowsTop);
      },
    };
  },

  // One photo, given the room.
  hero({ laid, photos, range, name, title }) {
    const heroH = 600;
    const rowsTop = heroH + 24;
    const footY = rowsTop + rowsHeight(laid) + 40;
    return {
      height: Math.round(footY + PAD - 10),
      paint(ctx) {
        cover(ctx, photos[0].img, 0, 0, W, heroH, 0);
        const shade = ctx.createLinearGradient(0, heroH - 260, 0, heroH);
        shade.addColorStop(0, "rgba(0,0,0,0)");
        shade.addColorStop(1, "rgba(0,0,0,.62)");
        ctx.fillStyle = shade;
        ctx.fillRect(0, heroH - 260, W, 260);

        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
        ctx.font = font(MONO, 22);
        ctx.fillStyle = "rgba(255,255,255,.92)";
        ctx.fillText(range, PAD, heroH - 100);
        ctx.font = font(UI, 52);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(title, PAD, heroH - 42);

        drawRows(ctx, laid, rowsTop);

        // The name signs it off at the foot, since the head is the photo.
        ctx.font = font(MONO, 22);
        ctx.fillStyle = ACCENT;
        ctx.textAlign = "right";
        ctx.fillText(name, W - PAD, footY);
        ctx.textAlign = "left";
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Out to a file.
//
// The words-only print stays a PNG: flat colour and text, which PNG keeps sharp
// and small. Anything with photos in it is a JPEG — a PNG of six photographs is
// megabytes, and the print is meant to be the lightest thing in the share so it
// lands first.
// ---------------------------------------------------------------------------

const PRINT_MAX_BYTES = 450 * 1024;

const toBlob = (canvas, type, quality) =>
  new Promise((res) => canvas.toBlob(res, type, quality));

async function encode(canvas, photographic) {
  if (!photographic) return toBlob(canvas, "image/png");
  let blob = null;
  for (const q of [0.88, 0.8, 0.7]) {
    blob = await toBlob(canvas, "image/jpeg", q);
    if (!blob || blob.size <= PRINT_MAX_BYTES) break;
  }
  return blob;
}

/**
 * @param {string[]} days     ISO days, ascending
 * @param {Object}   captions ISO day -> text
 * @param {Object}   cfg
 * @param {Object}   [opts]
 * @param {string}   [opts.style]  one of PRINT_STYLES; "words" by default
 * @param {Array}    [opts.items]  the week's media, for the styles with photos
 * @returns {Promise<File|null>}  null when nothing has been written
 */
export async function renderPrint(days, captions, cfg, { style = "words", items = [] } = {}) {
  await ensureFonts();
  pruneDecoded(items);

  // Same union as the message: a caption outside the window still gets printed.
  const span = messageDays(days, captions);
  const rows = span
    .map((iso) => ({ iso, text: (captions[iso] || "").trim() }))
    .filter((r) => r.text);
  if (!rows.length) return null;

  // What this style needs, and a quiet step down to the words when the week
  // has no photo it can draw. A print with an empty frame in it is worse than
  // a print without the frame.
  let chosen = STYLE_IDS.has(style) ? style : "words";
  let photos = [];
  if (chosen === "beside") {
    const beside = await loadAll(rows.map((r) => photoForDay(items, r.iso)).filter(Boolean));
    const byDay = new Map(beside.map((p) => [p.item.day, p.img]));
    rows.forEach((r) => { r.img = byDay.get(r.iso) || null; });
    if (!beside.length) chosen = "words";
  } else if (chosen !== "words") {
    const want = PRINT_STYLES.find((s) => s.id === chosen).photos;
    photos = await loadAll(pickPhotos(items, span, want));
    if (!photos.length) chosen = "words";
  }

  const measure = document.createElement("canvas").getContext("2d");
  const laid = layRows(measure, rows, { thumbs: chosen === "beside" });
  const layout = LAYOUTS[chosen]({
    laid, photos,
    range: rangeLabel(span).toUpperCase(),
    name: cfg.name.toUpperCase(),
    title: cfg.printTitle,
  });

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, layout.height);
  layout.paint(ctx);

  const photographic = chosen !== "words";
  const blob = await encode(canvas, photographic);
  if (!blob) return null;
  // "00" so anything that sorts attachments by name puts the print first.
  const ext = photographic ? "jpg" : "png";
  return new File([blob], `00-millie-time-${span[span.length - 1]}.${ext}`, { type: blob.type });
}
