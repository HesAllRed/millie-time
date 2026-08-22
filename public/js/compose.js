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

export function totalBytes(items) {
  return items.reduce((sum, i) => sum + (i.file ? i.file.size : 0), 0);
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
