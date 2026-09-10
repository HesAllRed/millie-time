// Everything personal lives here. Change a line, git push, done.
// No logic in this file — nothing below it needs to be read to edit it.

export default {
  name: "Millie Time",

  // One is chosen per week (rotates by week number). Add as many as you like.
  taglines: [
    "work hunty nola",
  ],

  // Which bundled face the tagline uses: "caveat" | "fraunces" | "bricolage"
  taglineFont: "caveat",

  // The line on the screen after a successful share.
  sentWord: "nice",

  // Heading printed on the card that gets shared.
  printTitle: "This week",

  // The week is defined by what's in it. `weekLength` is a MINIMUM span, not a
  // fixed size: the window stretches backwards to cover the oldest photo or
  // caption, so adding a newer photo can never push an older day out of it.
  weekLength: 8,

  // Hard cap on that stretching. Past this, older items stay in the Unsorted
  // tray — visible — rather than producing an absurdly long deck.
  maxWindowDays: 21,

  //   "newestPhoto" — the window ends on the newest item she picked
  //   "today"       — the window always ends today
  weekEndsOn: "newestPhoto",

  // Reopening within this many hours resumes the same week. Beyond it, a
  // half-finished week is treated as a finished one and she starts fresh.
  resumeWithinHours: 48,

  // Prepare files for order before sharing: renumber them 01, 02, …, make the
  // file timestamps ascend, and write a capture date into any photo that has
  // none. A receiving app might sort by any of those three, so they are all set
  // to say the same thing. Set false to hand the files over untouched.
  renumberOnShare: true,

  // Bumped on release; shown in the footer and on #debug.
  version: "1.0.8",
};
