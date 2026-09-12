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

  // Re-encode photos to a common weight before sharing.
  //
  // This is what actually fixes the order. Messages lands attachments as their
  // uploads finish, which tracks the real encoded weight of the image — but
  // files within a few hundred kilobytes of each other tie, and a tie falls
  // back to the order we handed them over in. Making every photo the same
  // weight makes every photo a tie.
  //
  // The cost is that the family receives phone-sized photos rather than
  // originals. On a screen they are the same picture; cropped or printed they
  // are not. Set false to send originals and accept the shuffle.
  resizeForShare: true,

  // What every photo is redrawn to, and roughly what each should weigh.
  //
  // A pixel budget rather than a long edge, because a long edge says nothing
  // about a crop: a 1206×493 screenshot sits well inside a 1280 cap while
  // being a third of the pixels of a photo that fills it — which is how it
  // ended up a third of the weight, and the one photo still out of order.
  //
  // Both a ceiling and a floor, for the same reason. A photo that comes out
  // under the floor gets quality spent on it until it is heavy enough to tie
  // with the rest of the week, and is drawn up to twice its size if that is
  // what the budget takes. Bigger is the point in that one case.
  //
  // 1.2 megapixels is roughly what WhatsApp does to a photo by default. Raise
  // it for better photos and a wider spread of weights, which makes the ties —
  // and so the order — less certain.
  sharePixels: 1200000,
  shareTargetKb: 200,
  shareFloorKb: 150,

  // Pad files to ascend in weight, so that an app landing attachments in
  // upload-completion order lands them in the order the week reads.
  //
  // OFF, and measured so. iOS re-encodes images on the way out and the padding
  // goes with them: on a real week the arrival order matched the PADDED sizes
  // in 2 positions out of 10 and the REAL ones in 8, having added 32.5 MB to
  // the message to achieve nothing. Kept because a target that sorts by the
  // bytes it is handed would still be helped by it — Messages is not one.
  orderByWeight: false,

  // How much bigger each file must be than the one before it, when the above is
  // on. Photos within ~0.3 MB of each other arrive as ties, so the margin has
  // to clear that. Narrowed automatically if the week won't fit the budget.
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
  version: "1.1.14",
};
