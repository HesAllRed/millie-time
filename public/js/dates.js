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
