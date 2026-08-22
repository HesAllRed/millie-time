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

  // How many days the window covers, and how its end is decided.
  //   "newestPhoto" — window ends on the day of the newest item she picked
  //   "today"       — window always ends today
  weekLength: 8,
  weekEndsOn: "newestPhoto",

  // Warn her above this total payload. Tune from real device testing —
  // see PLAN.md §6.4 test 2.
  warnBytes: 55 * 1024 * 1024,

  // Renumber files as 01, 02, … before sharing, so targets that sort
  // attachments by name get the week in order. Set false if it ever looks
  // like it's costing memory on a heavy week.
  renumberOnShare: true,

  // Bumped on release; shown in the footer and on #debug.
  version: "1.0.2",
};
