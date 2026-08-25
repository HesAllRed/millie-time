// Pure date helpers. No DOM, no state — unit tested in test/dates.test.js.
//
// Everything is keyed by a local ISO day string ("2026-08-21"). Dates are
// anchored at local noon internally so that adding days never trips over a
// daylight-saving boundary and lands on the wrong date.

const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MO = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
            "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const pad = (n) => String(n).padStart(2, "0");

/** Date -> local ISO day string. */
export function isoDay(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ISO day string -> Date at local noon. */
export function dayDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Shift an ISO day by n days. */
export function addDays(iso, n) {
  const d = dayDate(iso);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Inclusive ascending list of `length` ISO days ending on `endIso`. */
export function windowDays(endIso, length) {
  const out = [];
  for (let i = length - 1; i >= 0; i--) out.push(addDays(endIso, -i));
  return out;
}

/** Inclusive ascending list of ISO days from start to end. */
export function rangeBetween(startIso, endIso) {
  if (startIso > endIso) return [endIso];
  const out = [];
  let cur = startIso;
  while (cur <= endIso && out.length < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Whole days from a to b. Negative if b is earlier. */
export function daysBetween(aIso, bIso) {
  return Math.round((dayDate(bIso) - dayDate(aIso)) / 86400000);
}

/**
 * Work out which days the week covers.
 *
 * The window used to be a fixed-length span anchored to the newest photo, which
 * meant adding a newer photo slid the whole span forward and silently dropped
 * the oldest day — along with its photos and its caption. So the window is now
 * defined by its *content*: it starts no later than the oldest thing in it and
 * ends no earlier than the newest, and `weekLength` is only a minimum.
 *
 * @param {Object}   opts
 * @param {Array}    opts.items       items with a `takenAt`
 * @param {Object}   opts.captions    ISO day -> text
 * @param {number}   opts.weekLength  minimum span, in days
 * @param {number}   opts.maxDays     hard cap; anything older stays unsorted
 * @param {Object}  [opts.base]       a window to keep covered (used when resuming)
 * @returns {{startIso: string, endIso: string}}
 */
export function resolveWindow({
  items = [], captions = {}, weekLength = 8, maxDays = 21, base = null, now = new Date(),
} = {}) {
  const marks = [];
  for (const item of items) if (item && item.takenAt) marks.push(isoDay(item.takenAt));
  for (const [iso, text] of Object.entries(captions)) {
    if (typeof text === "string" && text.trim()) marks.push(iso);
  }
  if (base && base.startIso && base.endIso) marks.push(base.startIso, base.endIso);

  const endIso = marks.length ? marks.reduce((a, b) => (a > b ? a : b)) : isoDay(now);

  let startIso = addDays(endIso, -(weekLength - 1));
  if (marks.length) {
    const oldest = marks.reduce((a, b) => (a < b ? a : b));
    if (oldest < startIso) startIso = oldest;
  }

  // A stray photo from months ago shouldn't produce a hundred-day deck. Past the
  // cap it stays in the Unsorted tray, which is visible, rather than silently
  // vanishing, which is what this whole function exists to prevent.
  if (daysBetween(startIso, endIso) + 1 > maxDays) startIso = addDays(endIso, -(maxDays - 1));

  return { startIso, endIso };
}

/** { wd: "THU", dm: "AUG 21", day: 21, weekday: "Thursday" } */
export function dayLabel(iso) {
  const d = dayDate(iso);
  return {
    wd: WD[d.getDay()],
    dm: `${MO[d.getMonth()]} ${d.getDate()}`,
    day: d.getDate(),
    month: MO[d.getMonth()],
    weekday: d.toLocaleDateString(undefined, { weekday: "long" }),
  };
}

/** "AUG 14 — 21" when inside one month, "AUG 28 — SEP 4" across a boundary. */
export function rangeLabel(days) {
  if (!days.length) return "";
  const a = dayLabel(days[0]);
  const b = dayLabel(days[days.length - 1]);
  return a.month === b.month
    ? `${a.month} ${a.day} — ${b.day}`
    : `${a.month} ${a.day} — ${b.month} ${b.day}`;
}

/**
 * Decide which day the window should end on.
 * Prefers the newest dated item; falls back to today when nothing is dated yet
 * (which is the state the entry screen opens in, before any photos exist).
 */
export function resolveEnd(items, mode, now = new Date()) {
  if (mode === "newestPhoto") {
    const dated = items.filter((i) => i.takenAt).map((i) => i.takenAt.getTime());
    if (dated.length) return isoDay(new Date(Math.max(...dated)));
  }
  return isoDay(now);
}

/** Stable week index, used to rotate taglines without storing anything. */
export function weekIndex(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 604800000);
}
