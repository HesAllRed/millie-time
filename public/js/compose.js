// Turns the week into the text that gets shared. Pure — unit tested.

import { dayLabel, rangeLabel } from "./dates.js";

/**
 * @param {string[]} days     ISO days, ascending
 * @param {Object}   captions ISO day -> text
 * @param {Object}   cfg      config
 * @returns {string} the message body, exactly as it will be sent
 */
/**
 * Every day the message should mention: the window, plus any day carrying a
 * caption even if it somehow sits outside it.
 *
 * The union is deliberate belt-and-braces. A caption falling out of the window
 * is exactly how a day's writing went missing once; if that ever happens again
 * her words still reach the message.
 */
export function messageDays(days, captions) {
  const all = new Set(days);
  for (const [iso, text] of Object.entries(captions || {})) {
    if (typeof text === "string" && text.trim()) all.add(iso);
  }
  return [...all].sort();
}

export function composeText(days, captions, cfg) {
  const span = messageDays(days, captions);
  const lines = [];
  lines.push(`${cfg.printTitle} · ${rangeLabel(span)}`);
  lines.push("");

  for (const iso of span) {
    const text = (captions[iso] || "").trim();
    if (!text) continue;
    lines.push(`${dayLabel(iso).wd}  ${text}`);
  }

  // Trailing blank lines look sloppy pasted into Messages.
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** Days that have either a caption or at least one item — what the deck shows. */
export function activeDays(days, captions, items) {
  const withItems = new Set(items.map((i) => i.day).filter(Boolean));
  return days.filter((iso) => withItems.has(iso) || (captions[iso] || "").trim());
}

/**
 * What a day has in it, for the row of dots on the entry screen.
 *
 * Writing outranks photos: a day she has written about is done, whether or not
 * anything is attached to it. Blank-but-whitespace counts as nothing, matching
 * `activeDays` — otherwise a stray space would light a dot for an empty day.
 *
 * @returns {"written" | "photos" | "empty"}
 */
export function dayStatus(iso, captions, items) {
  if ((captions?.[iso] || "").trim()) return "written";
  return items.some((i) => i.day === iso) ? "photos" : "empty";
}

/**
 * A capture time to sort by. An item with no date sorts to the END of whatever
 * it belongs to, not the start.
 *
 * Treating "no date" as zero is what put a screenshot she had placed on Tuesday
 * by hand in front of the photos actually taken that morning — the day read
 * backwards, and it did it in the deck and in the share alike. Undated items
 * have no claim to a position, so they take the only one that can't displace
 * anything: last.
 */
export function sortTime(item) {
  return item.takenAt ? item.takenAt.getTime() : Number.MAX_SAFE_INTEGER;
}

/** One day's items, oldest first. Array.sort is stable, so equal (or missing)
 *  capture times keep the order iOS handed them to us in. */
export function itemsForDay(items, iso) {
  return items
    .filter((i) => i.day === iso)
    .sort((a, b) => sortTime(a) - sortTime(b));
}

/**
 * Every item in the order the week reads: day by day, oldest first within a day,
 * anything undated last.
 *
 * This is the order the files go into the share.
 */
export function orderedItems(items, days) {
  const rank = new Map(days.map((iso, i) => [iso, i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const da = rank.has(a.item.day) ? rank.get(a.item.day) : Number.MAX_SAFE_INTEGER;
      const db = rank.has(b.item.day) ? rank.get(b.item.day) : Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      const ta = sortTime(a.item);
      const tb = sortTime(b.item);
      if (ta !== tb) return ta - tb;
      return a.i - b.i;                       // stable: pick order breaks ties
    })
    .map((entry) => entry.item);
}

// ---------------------------------------------------------------------------
// Making every ordering rule agree.
//
// We hand navigator.share() an array. What arrives at the other end is whatever
// the receiving app decides, and the candidate rules are: the array order, the
// filename, or the photo's capture date. We control all three, so the fix is
// not to guess which one Messages uses — it is to make them produce the same
// list, so it stops mattering.
//
// Array order and filenames are easy (see media.js `renameForOrder`). Capture
// dates are the awkward one: they are already in agreement for any photo that
// carries a real EXIF date, because that is exactly what we sorted on. The
// exceptions are items with no date in the file at all — a screenshot, a saved
// image, anything iOS stripped — and for those a date-sorting app sees nothing
// and files them wherever it likes. So we invent one that puts them where we
// put them.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

/** Local midnight for an ISO day. */
function dayStart(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * A strictly ascending capture time for each item in send order.
 *
 * A real EXIF date is used as-is and never overwritten — it is the truth, the
 * recipient's Photos app files by it, and it already agrees with our order.
 * Everything else gets a synthetic time that lands late on its own day, after
 * the photos that do know when they were taken and before the next day starts.
 *
 * @param {Array} ordered  items, already in send order
 * @param {string} lastIso the last day of the week, for items on no day at all
 * @returns {Date[]} one per item, same order, strictly increasing
 */
export function captureSequence(ordered, lastIso) {
  const out = [];
  let previous = 0;

  for (const item of ordered) {
    let ms;
    if (item.takenAt) {
      ms = item.takenAt.getTime();
    } else {
      // Late on its own day — or on the last day of the week for a stray, which
      // is where the send puts it anyway.
      const iso = item.day || lastIso;
      ms = iso ? dayStart(iso).getTime() + DAY_MS - 60000 : previous + 1000;
    }
    if (ms <= previous) ms = previous + 1000;    // never let two collide
    out.push(new Date(ms));
    previous = ms;
  }
  return out;
}

export function totalBytes(items) {
  return items.reduce((sum, i) => sum + (i.file ? i.file.size : 0), 0);
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
