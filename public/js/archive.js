// Past weeks, kept as words.
//
// Photos are not kept, and that is not a limitation being worked around — they
// are already in her camera roll, and holding copies would mean IndexedDB, blob
// serialization and quota handling for something she has not lost. What is kept
// is the part that exists nowhere else: what she wrote about each day.
//
// On the device, in localStorage, for four reasons that all point the same way.
// Ten years of weeks is about 200 KB against a ~5 MB budget, so size is not an
// argument for a server. There is no account to put a server's copy behind and
// no second device to sync it to. A week in a child's life is not data that
// wants to live on someone else's computer. And the app has no backend at all
// today — adding one for 200 KB of text would be the largest change ever made
// to it, in exchange for the thing it is worst at justifying.
//
// The cost of that choice, stated plainly: this lives and dies with the app on
// the phone. Deleting the app takes it. That is what "Copy all" on the archive
// screen is for, and why it is not hidden in a menu.

const KEY = "millie.archive.v1";

// Ten years of Sundays. Past this the oldest goes, which is a limit she will
// never reach and a promise that this can never grow without bound.
const MAX_WEEKS = 520;

const isIsoDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Whether a week has anything worth keeping. A week of blanks is not. */
export function written(captions) {
  return Object.values(captions || {}).some((t) => typeof t === "string" && t.trim());
}

/** One stored week, reduced to what we can trust. Pure; tested. */
export function readWeek(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isIsoDay(raw.startIso) || !isIsoDay(raw.endIso)) return null;
  if (raw.startIso > raw.endIso) return null;

  const captions = {};
  for (const [iso, text] of Object.entries(raw.captions || {})) {
    if (isIsoDay(iso) && typeof text === "string" && text.trim()) captions[iso] = text.trim();
  }
  if (!written(captions)) return null;

  const savedAt = Number(raw.savedAt);
  return {
    startIso: raw.startIso,
    endIso: raw.endIso,
    savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : 0,
    captions,
  };
}

/** The whole archive, newest first, with anything unreadable dropped. */
export function readArchive(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map(readWeek)
    .filter(Boolean)
    .sort((a, b) => (a.endIso < b.endIso ? 1 : a.endIso > b.endIso ? -1 : 0))
    .slice(0, MAX_WEEKS);
}

/**
 * Put a week in, or bring the one already there up to date. Pure; tested.
 *
 * Keyed on the span rather than on when it was written, so archiving the same
 * week twice — she shares it, then starts a new one a day later — updates it
 * rather than leaving two half-finished copies of the same days.
 */
export function addWeek(weeks, week, cap = MAX_WEEKS) {
  const fresh = readWeek(week);
  if (!fresh) return weeks.slice(0, cap);
  const rest = weeks.filter((w) => !(w.startIso === fresh.startIso && w.endIso === fresh.endIso));
  return [fresh, ...rest]
    .sort((a, b) => (a.endIso < b.endIso ? 1 : a.endIso > b.endIso ? -1 : 0))
    .slice(0, cap);
}

// ---------------------------------------------------------------------------
// The stored copy.
// ---------------------------------------------------------------------------

export function archivedWeeks() {
  try { return readArchive(JSON.parse(localStorage.getItem(KEY) || "[]")); }
  catch { return []; }
}

function write(weeks) {
  try { localStorage.setItem(KEY, JSON.stringify(weeks)); }
  catch { /* full or private — the week on screen is still hers */ }
  return weeks;
}

/** Keep a week. Returns the archive as it now stands. */
export function keepWeek(week) {
  if (!readWeek(week)) return archivedWeeks();     // nothing written; nothing to keep
  return write(addWeek(archivedWeeks(), { ...week, savedAt: week.savedAt || Date.now() }));
}

export function forgetWeek(startIso, endIso) {
  return write(archivedWeeks().filter((w) => !(w.startIso === startIso && w.endIso === endIso)));
}

/**
 * The whole archive as plain text, for the clipboard.
 *
 * The answer to the one real cost of keeping this on the device: it is always
 * one tap from being somewhere else.
 */
export function archiveText(weeks, label) {
  return weeks.map((week) => {
    const days = Object.keys(week.captions).sort();
    const head = label ? label(week) : `${week.startIso} → ${week.endIso}`;
    return [head, ...days.map((iso) => `  ${iso}  ${week.captions[iso]}`)].join("\n");
  }).join("\n\n");
}
