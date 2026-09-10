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

  // Messages lands attachments in the order their uploads finish, which tracks
  // file size — so the files are padded to ascend in weight in the order the
  // week reads. Trailing bytes only; not a pixel of a photo is touched.
  // Set false to hand the files over at their real sizes.
  orderByWeight: true,

  // How much bigger each file must be than the one before it. Three photos
  // within 0.4 MB of each other arrived shuffled, so the margin has to clear
  // that comfortably. Narrowed automatically if the week won't fit the budget.
  weightStepMb: 0.75,

  // The most we will let a message weigh — iMessage stops carrying attachments
  // somewhere around here. Padding can only add, so an early heavy photo is
  // expensive; past this the margin narrows, and past that we give up and send
  // at real sizes, because a message too big to send is worse than one that
  // arrives shuffled.
  maxPayloadMb: 100,

  // Clips go last rather than in their place in the week. They are ten times
  // the weight of a photo and cannot be padded past, so leaving one mid-week
  // means padding everything after it past 30 MB. Set false to keep them in
  // place and accept that they land last anyway.
  videosLast: true,

  // Bumped on release; shown in the footer and on #debug.
  version: "1.0.11",
};
