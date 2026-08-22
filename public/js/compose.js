// Turns the week into the text that gets shared. Pure — unit tested.

import { dayLabel, rangeLabel } from "./dates.js";

/**
 * @param {string[]} days     ISO days, ascending
 * @param {Object}   captions ISO day -> text
 * @param {Object}   cfg      config
 * @returns {string} the message body, exactly as it will be sent
 */
export function composeText(days, captions, cfg) {
  const lines = [];
  lines.push(`${cfg.printTitle} · ${rangeLabel(days)}`);
  lines.push("");

  for (const iso of days) {
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

/** One day's items, oldest first. Array.sort is stable, so equal (or missing)
 *  capture times keep the order iOS handed them to us in. */
export function itemsForDay(items, iso) {
  return items
    .filter((i) => i.day === iso)
    .sort((a, b) => (a.takenAt ? a.takenAt.getTime() : 0) - (b.takenAt ? b.takenAt.getTime() : 0));
}

/**
 * Every item in the order the week reads: day by day, oldest first within a day,
 * anything undated last.
 *
 * This is the order the files go into the share. We cannot *make* a receiving
 * app respect it — iMessage groups runs of images however it likes, and no
 * metadata tag overrides that — but sending them in a sensible order is the
 * half we control, and it is currently pick order, which is arbitrary.
 */
export function orderedItems(items, days) {
  const rank = new Map(days.map((iso, i) => [iso, i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const da = rank.has(a.item.day) ? rank.get(a.item.day) : Number.MAX_SAFE_INTEGER;
      const db = rank.has(b.item.day) ? rank.get(b.item.day) : Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      const ta = a.item.takenAt ? a.item.takenAt.getTime() : 0;
      const tb = b.item.takenAt ? b.item.takenAt.getTime() : 0;
      if (ta !== tb) return ta - tb;
      return a.i - b.i;
    })
    .map((entry) => entry.item);
}

export function totalBytes(items) {
  return items.reduce((sum, i) => sum + (i.file ? i.file.size : 0), 0);
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
