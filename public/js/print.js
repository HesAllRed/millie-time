// Renders the week onto a card and hands back a File.
//
// This is what makes the share reliable: iOS drops the `text` field when files
// are attached, so the captions travel as pixels instead. The card is file #1 in
// the payload, which means the words arrive even on the files-only rung.
//
// It is warm paper rather than the app's dark, because it isn't app chrome —
// it's the object she is actually sending, and it reads far better than a dark
// card would in a bright Messages thread.

import { dayLabel, rangeLabel } from "./dates.js";

const W        = 1080;
const PAD      = 72;
const PAPER    = "#F2EBE2";
const INK      = "#17161A";
const ACCENT   = "#5F52A8";
const HAIRLINE = "rgba(23,22,26,0.16)";

const UI    = '800 %spx "Bricolage Grotesque", system-ui, "Apple Color Emoji", sans-serif';
const HAND  = '400 %spx "Fraunces", Georgia, "Apple Color Emoji", serif';
const MONO  = '500 %spx "JetBrains Mono", ui-monospace, "Apple Color Emoji", monospace';
const font = (tpl, size) => tpl.replace("%s", size);

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
    font(UI, 64), font(UI, 44),
    font(HAND, 34),
    font(MONO, 22),
  ];
  try {
    await Promise.all(wanted.map((f) => document.fonts.load(f, "Millie 0123 ☕")));
    await document.fonts.ready;
  } catch { /* a fallback face is better than no card */ }
}

/**
 * @param {string[]} days     ISO days, ascending
 * @param {Object}   captions ISO day -> text
 * @param {Object}   cfg
 * @returns {Promise<File|null>}
 */
export async function renderPrint(days, captions, cfg) {
  await ensureFonts();

  const rows = days
    .map((iso) => ({ iso, text: (captions[iso] || "").trim() }))
    .filter((r) => r.text);
  if (!rows.length) return null;

  const measure = document.createElement("canvas").getContext("2d");
  const labelW  = 118;
  const textX   = PAD + labelW;
  const textW   = W - textX - PAD;

  measure.font = font(HAND, 34);
  const laid = rows.map((r) => ({ ...r, lines: wrap(measure, r.text, textW) }));

  const lineH   = 46;
  const rowPadY = 26;
  let y = PAD + 30 + 26 + 34 + 74;                 // header rule + title block
  const rowTops = [];
  for (const row of laid) {
    rowTops.push(y);
    y += rowPadY + row.lines.length * lineH + rowPadY;
  }
  const H = Math.round(y + PAD - 10);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Header row: date range left, app name right.
  ctx.font = font(MONO, 22);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ACCENT;
  ctx.fillText(rangeLabel(days).toUpperCase(), PAD, PAD + 22);
  const nameText = cfg.name.toUpperCase();
  ctx.fillText(nameText, W - PAD - ctx.measureText(nameText).width, PAD + 22);

  ctx.fillStyle = INK;
  ctx.fillRect(PAD, PAD + 44, W - PAD * 2, 5);

  // Title.
  ctx.font = font(UI, 64);
  ctx.fillStyle = INK;
  ctx.fillText(cfg.printTitle, PAD, PAD + 44 + 84);

  // Days.
  laid.forEach((row, i) => {
    const top = rowTops[i];

    ctx.font = font(MONO, 22);
    ctx.fillStyle = ACCENT;
    ctx.fillText(dayLabel(row.iso).wd, PAD, top + rowPadY + 26);

    ctx.font = font(HAND, 34);
    ctx.fillStyle = INK;
    row.lines.forEach((line, n) => {
      ctx.fillText(line, textX, top + rowPadY + 30 + n * lineH);
    });

    if (i < laid.length - 1) {
      const ruleY = top + rowPadY * 2 + row.lines.length * lineH;
      ctx.fillStyle = HAIRLINE;
      ctx.fillRect(PAD, ruleY, W - PAD * 2, 2);
    }
  });

  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return null;
  // "00" so anything that sorts attachments by name puts the print first.
  return new File([blob], `00-millie-time-${days[days.length - 1]}.png`, { type: "image/png" });
}
