# Weekly Recap — Implementation Plan

A single-user, no-login, ephemeral PWA for building a weekly photo recap and
handing it to the iOS share sheet.

---

## 0. Decisions

**Locked in:**

| Decision | Choice |
|---|---|
| Share model | One share: all photos + one combined caption block, with automatic clipboard copy as a safety net |
| Media | Photos primarily; occasional video allowed with size guards |
| Test device | Your own iPhone (before she ever sees it) |
| Theme | Dark only, neo-brutalist, warm |
| Backend | **None.** See §2.4 |
| Hosting | **Cloudflare Pages**, source in a **private GitHub repo** |
| Name | **Millie Time** |
| Caption length | **800–1000 chars for the whole week** (≈150 words) — roughly 120 chars, a sentence or two, per day. See §1.1a |
| Share model | **One tap**: print card + photos + text, with a two-step fallback. See §1.1b |
| Main UX | **Swipeable day deck** with a crescent of that day's photos above the caption field. See §3 |
| Video | Previewable in the crescent, **one live video at a time**. See §3.3b |
| Personalization | `config.js` — tagline(s), font, accent, all editable in one file. See §2.6 |

**Decided by me, flag if you disagree:**

- **Week window** = the 8 days ending today, labeled by weekday + date
  (`MON AUG 11` … `MON AUG 18`). This sidesteps "does her week start Sunday or
  Monday" entirely — it's always "the last 8 days," which is what you described.
- **Day order** = chronological, oldest first, so the recap reads as a narrative
  from the start of the week to now.
- **No drag-and-drop.** See §3.3.

---

## 1. Research findings that shape the design

These are load-bearing. Two of them killed features I would otherwise have
proposed.

### 1.1 Web Share API on iOS — what's actually true

- **`navigator.share({ files })` works on iOS 15+.** Safari 15 adopted Web Share
  Level 2. It was flag-gated in iOS 14 betas and unusable before that.
- **Multiple files in one call is supported** — `files` is spec'd as an array and
  iOS honors it. There is no documented cap, but there is a practical one that
  varies by payload size and by receiving app. We will find it empirically (§6.4)
  rather than guess.
- **⚠️ Combining `files` with `text`/`title`/`url` is the unreliable part.** This
  is widely reported and still open: file sharing behaves predictably when `files`
  is the *only* property on the share object. Add `text` and the text may be
  silently dropped, or the whole call may fail, depending on the target app.
  There is nothing in the spec that governs how an OS must handle the payload, so
  this is not technically a bug and there is no version where it's guaranteed fixed.
- **`navigator.canShare({ files })` is mandatory** as a pre-flight check — it is
  the only reliable capability probe, and it must be called with the actual files.
- **Must be invoked inside a user gesture**, and transient activation expires
  quickly. Any async work (thumbnailing, EXIF parsing, blob assembly) must be
  finished *before* the tap, not inside the handler.

**Design consequence:** the share attempt is a graceful ladder, not a single call
(§5.5). The clipboard write happens in the same gesture, before the share, so the
captions are recoverable no matter what iOS does with the text field.

### 1.1a Caption volume: ~900 characters for the whole week

150 words / 800–1000 characters is the **weekly total**, not per day. Across 7–8 days
that's roughly **120 characters — a sentence or two — per day.**

That matters, because it keeps the print card viable. Had it been 900 per day
(6–8k a week), a typeset image would have been the wrong tool entirely: 7k characters
at readable size needs ~2,500–3,500 px of height, which renders in a message thread
as an unreadable sliver. At 900 characters *total*, the whole week fits comfortably
on one readable card, and one-tap sharing stays on the table.

For the record, the alternatives I researched and rejected, in case volume ever grows:

| Option | Why not |
|---|---|
| One card per day | 8 images; iMessage grid-collapses runs of photos and won't guarantee order. Numbering fixes comprehension, not clutter |
| PDF | Order is perfect, but it lands as a *document attachment* — photos never reach the recipient's camera roll |
| Hosted link | Needs a backend and puts her photos on a server. Against the privacy posture |
| Two-step (text, then files) | Genuinely more reliable, but costs a second trip through the share sheet. **Kept as the fallback rung**, not the default |

### 1.1b The share ladder — starts at one tap

The print card is file #1, so captions travel as pixels and cannot be stripped. The
`text` field is attempted too, as pure upside. Each rung below is a payload shape
that's strictly more conservative than the one above it.

| Rung | Call | If it works |
|---|---|---|
| **1** | `share({ files: [print, ...photos], text })` | One tap, everything, selectable text as a bonus |
| **2** | `share({ files: [print, ...photos] })` | One tap. The files-only shape iOS handles predictably (§1.1). Captions still arrive — they're in the print |
| **3** | `share({ text })` then `share({ files })` | Two taps. Both shapes individually bulletproof; she picks the recipient twice |
| **4** | Clipboard + camera-roll instructions | Nothing was lost; everything she needs is already on her phone |

Rungs 1 and 2 are both single-tap, so **the realistic outcome is one tap**. Rung 3
only appears if the first two fail on her device, and §6.4 testing will tell us
whether it ever does.

The clipboard write happens first, unconditionally, on every attempt.

Your constraint — *"otherwise this app is a glorified notes app"* — is the right
one, and it means a clipboard safety net is not enough on its own. A safety net
that requires her recipient to receive a separate paste is a degraded send, and
if the text field is a coin flip then the product is a coin flip.

**So we render the captions into an image and send it as a file.** Files are the
one payload iOS handles predictably. A **week card** — the day-by-day captions
typeset in the app's own style — travels as pixels and cannot be stripped by any
share target, any messaging app, or any future iOS change.

The share payload becomes three layers, each covering the one beneath it:

| Layer | Carries | Survives? |
|---|---|---|
| **Week card image** (first file) | all captions, typeset | **Always** — it's just a photo |
| Original photos (remaining files) | the actual images, full quality | Always |
| `text` field | captions as selectable plain text | Sometimes — pure upside |
| Clipboard | captions as plain text | Always, as a manual last resort |

This inverts the earlier plan: **the rendered card is now the primary caption
channel and the text field is the bonus**, not the reverse. It also means the
reliable `{ files }`-only share shape is no longer a degraded fallback — it
carries the complete recap on its own.

Bonus that matters for a gift: the week card is a *designed object*. A typeset
card in the app's palette is a nicer thing to receive than a wall of plain text,
and it's the piece her family will screenshot.

**Open question for the mockup (§4):** one **week card** listing every day, versus
**per-day cards interleaved** before each day's photos. Interleaving puts each
caption next to its photos, but iMessage collapses runs of images into a grid and
may not preserve the visual pairing — so the single card is the safer default. I'm
mocking up both so you can pick by eye rather than in the abstract. Cost either
way: ~4 hours, and it moves from "optional" to core scope.

### 1.2 ⚠️ `File.lastModified` is not the photo's date

Safari 17+ rewrites `lastModified` on files coming out of the photo picker — it
reflects the export/copy time, not capture time. **The obvious implementation of
"auto-assign photos to days" is therefore wrong**, and would have silently dumped
every photo into "today."

**Consequence:** day assignment must come from **EXIF `DateTimeOriginal` (tag
0x9003)** parsed out of the file bytes, with `lastModified` used only as a
last-resort hint. And because EXIF is *not guaranteed* (§1.3), manual assignment
must be a first-class, fast interaction — not a rarely-used override.

### 1.3 HEIC conversion and EXIF survival

- iOS converts picked photos before handing them to the browser; with many photos
  selected this conversion takes visible time (a spinner is required, not optional).
- iOS 16.4 stripped EXIF on upload entirely. **16.4.2 restored `DateTimeOriginal`**,
  which is precisely the tag we need — but this history means EXIF presence is
  best-effort across her photo library, not a guarantee.
- iOS 17+ exposes a **Format** option in the picker (Automatic / Current / Most
  Compatible). "Automatic" typically yields JPEG for a web upload, which is what
  our EXIF parser wants. We do not control this and should not depend on it.

**Consequence:** photos we can't date go into an **Unsorted tray**, not a wrong day.
Auto-assignment is framed in the UI as a *suggestion*, and the app never blocks on it.

### 1.4 iOS PWA behavior

- Home-screen PWAs are **exempt from the 7-day script-writable storage cap** that
  would otherwise purge localStorage between weekly uses. This matters: it makes
  caption autosave (§5.7) actually viable, and it is another reason the Add to Home
  Screen step is mandatory rather than cosmetic.
- Standalone mode has **no reload button and no URL bar**. A bad cached service
  worker traps her with no recovery path. Mitigation in §5.6.
- iOS kills backgrounded PWAs aggressively. This is the concrete justification for
  caption autosave.

---

## 2. Tech stack

### 2.1 Recommendation: plain HTML + CSS + vanilla JS. No framework, no build step.

```
index.html          single page, three views toggled by a state machine
app.css             design tokens + components
app.js             ~500-700 lines: state, EXIF, share ladder, autosave
exif.js            ~60 lines: APP1/TIFF walk, reads DateTimeOriginal only
sw.js               app-shell cache
manifest.webmanifest
icons/              192, 512, maskable, apple-touch-icon-180
```

### 2.2 Why not a framework

1. **Timeline is days.** Zero toolchain means zero toolchain debugging on the one
   day something goes wrong.
2. **The app is genuinely small** — three views and one state object. React would
   be more lines of scaffolding than of app.
3. **PWA plumbing is simplest with stable file paths.** No hashed bundle names to
   keep a service worker precache in sync with.
4. **It has to still work in two years.** This is a gift, not a product. A no-npm
   app has nothing to rot. If you want to fix a typo in 2028, you edit a file and
   push — no `npm install` that fails against a dependency graph that moved on.
5. **You're debugging on Windows** (§6.1) — no Safari Web Inspector available. A
   bundler and sourcemaps would make an already-blind debugging situation worse.

The honest tradeoff: no reactive rendering, so I'll hand-write render functions.
For this app's size that's cheaper than the alternative. If you'd rather have a
framework, Preact + htm via a vendored (not CDN) module is the no-build option —
but I'd be adding it for your comfort, not the app's benefit.

### 2.3 Zero runtime dependencies

- **EXIF**: hand-rolled ~60-line parser. Off-the-shelf EXIF libraries are 30–100 KB
  to read one tag. We seek to the APP1 marker, walk the TIFF IFD, read 0x9003, stop.
- **Thumbnails**: `URL.createObjectURL(file)` straight into `<img>`. Safari renders
  HEIC natively, so no decode step. Object URLs get revoked on removal to keep
  memory flat with 30+ photos loaded.
- **Sharing**: the original `File` objects are passed to `navigator.share`
  untouched. **We never re-encode through a canvas** — that would silently strip
  EXIF and degrade quality on a gift app whose entire point is the photos.

### 2.4 Where a backend would be warranted: nowhere, with one caveat

Everything — picking, EXIF, captions, sharing — is client-side by nature. Photos
never leave her device. A backend would add a privacy surface, a cost, and a thing
that can break, in exchange for nothing.

The one thing that *would* require a backend is a **shareable link** ("here's a web
page of our week") instead of a share sheet, since that means hosting her photos
somewhere. That's a different product and it's out of scope — but it's the fork in
the road worth knowing about, because it's the only feature request that would
change this architecture rather than extend it.

### 2.5 Extensibility — SOLID where it pays, not as ritual

**The honest answer on SOLID:** it's an OO methodology aimed at large codebases,
many collaborators, and requirements that churn. This is ~800 lines, one author, one
user. Applied as ceremony — interfaces, DI containers, abstract factories — it would
add more code than it saves and make the thing *harder* to change in two years, not
easier. What I'll do instead is apply the letters that earn their place, at the seams
where we already know change is coming.

**Native ES modules, no build step.** `<script type="module">` has worked in Safari
since 2017. Real module boundaries, zero tooling.

```
config.js      ← all personal strings, fonts, accent. §2.6
state.js       ← one store; subscribe/notify. Views read, never mutate directly
exif.js        ← pure: bytes → capture date
dates.js       ← pure: date → day bucket, week window
compose.js     ← pure: state → the text she sends
share/         ← strategies, selected at runtime  ★ open/closed lives here
  words.js  photos.js  clipboard.js  cover-card.js
views/         ← intake · sort · deck · send · debug
  each owns its DOM subtree, receives state, emits intents
```

Which letters actually apply:

- **S** — one module per concern. Falls out naturally from the layout above.
- **O** — applied *only* to `share/` and the card renderer, because those are the two
  things we already know will change once device testing comes back (§6.4). Each
  share strategy is `{ id, canRun(payload), run(payload) }`; adding or reordering a
  strategy touches no view code.
- **D** — views depend on the store's interface, not on globals; share strategies
  depend on a payload object, not on the DOM. That's what makes both testable.
- **L / I** — not meaningfully applicable without class hierarchies this app has no
  reason to have. Forcing them would be cargo cult.

**Tests where they pay:** `exif.js`, `dates.js`, and `compose.js` are pure functions
with no DOM, so they're unit-testable with `node --test` — built into the Node 24 you
already have. No jest, no config, no dependencies. That's what makes it safe to
refactor later, which is what "extensible" actually cashes out to.

What stays deliberately un-abstracted: the views. They're small, concrete, and read
top-to-bottom. Abstracting them would buy nothing and cost legibility.

### 2.6 Personalization — one file

Everything personal lives in `config.js`, so changing the app's voice never means
reading its logic:

```js
export default {
  name: "Millie Time",
  taglines: [                    // one is chosen per week
    "work hunty nola",
  ],
  taglineFont: "caveat",         // key into the bundled font set
  sentWord: "nice",              // the post-share line
  printTitle: "This week",       // heading on the print card
  accent: "#F2A03D",
  weekLength: 8,
  weekEndsOn: "newestPhoto",     // or a fixed weekday
}
```

**On fonts — one real constraint.** Google Fonts over CDN cannot work in an offline
PWA and blocks first paint. So the two or three faces you want selectable get
**self-hosted as woff2 in `/fonts` and precached by the service worker** (~20–40 KB
each, subset to Latin). `taglineFont` then picks between them at runtime. Fully
feasible; it just has to be a curated set rather than "any Google font," and that's
a better outcome anyway — it keeps the app working on a plane.

Optional and cheap (~10 lines) if you want it: a date-keyed override, so your
anniversary shows a line only that week. Say the word.

---

## 3. UX design around the photo-picker constraint

The constraint: no camera-roll-by-date API. Everything flows from Apple's picker,
newest-first, and we get files with unreliable dates. The design goal is that the
constraint reads as *intentional* rather than as a limitation she's working around.

### 3.1 Screen 1 — Entry

Opens straight here every launch. No history, no menu.

- Week range as the hero, **with weekdays**: `THU AUG 14 → THU AUG 21`, weekday in
  amber, computed live.
- **The range is tappable** and opens a window picker (mockup screen 01b). Default is
  automatic: the window *ends on the day of her newest photo* and runs back
  `weekLength` days. There's a chicken-and-egg — before she picks anything we don't
  know the newest date — so the entry screen shows a today-based guess and **snaps to
  the real dates once photos land**. A toggle pins a manual start day instead.
- One line of instruction directly above the button, phrased as a prompt not a
  disclaimer: **"Grab everything from this week. Newest are up top."**
- One button: **`PICK PHOTOS`** → `<input type="file" accept="image/*,video/*" multiple>`
- **The picker can be reopened and it appends.** iOS won't remember her prior
  selection, so a second pass must add to the set rather than replace it. This is
  the single highest-value affordance on this screen — it means she can do a fast
  first pass and top up later without starting over.
- A spinner with honest copy while iOS converts ("iOS is preparing 24 photos…"),
  because with a large selection this pause is long enough to look broken.

### 3.2 Stage 2 — Sort (confirm the days)

One vertical triage screen whose only job is getting every photo onto the right day.
It is deliberately *not* where she writes — separating sorting from writing is what
lets Stage 3 stay calm.

- `UNSORTED` tray pinned at top with a count badge, styled as a to-do rather than
  an error. When EXIF works well this tray is empty and she scrolls straight past.
- Below it, compact day rows with thumbnail strips. Small, dense, glanceable.
- `LOOKS RIGHT →` advances to the deck.

**Reassigning: tap-to-assign, not drag-and-drop.** Tap a photo → a row of day chips
slides up → tap the target day. Drag-and-drop is the obvious idea and the wrong one
on iOS: it fights the scroll gesture, has no accessible fallback, and is fiddly
one-handed on a phone she's using while doing something else. Two taps, thumb-
reachable, far less code. **Recommend we don't spend timeline on drag-and-drop.**

### 3.3 Stage 3 — The Day Deck ★ the heart of the app

This replaces the vertical scroll from the previous draft, and it directly targets
the pain you named: *you shouldn't have to swipe away from the photos to write about
them.* One horizontally swipeable card per day. Her day's photos sit **above** the
caption field, on screen, the whole time she's typing.

```
        ● ● ● ○ ○ ○ ○            ← day dots / tap to jump

           ╭──────╮
   ╭─────╮ │      │ ╭─────╮      ← loose crescent of
   │     │ │      │ │     │        that day's photos
   ╰─────╯ ╰──────╯ ╰─────╯

      MONDAY · AUG 11

   ┌────────────────────────┐
   │ coffee walk, the long  │     ← caption field
   │ way home               │
   └────────────────────────┘

        swipe →
```

- **The crescent** — photos on a shallow arc, each slightly rotated, gently
  overlapping, hard-edged frames with solid offset shadows. It reads as a handful
  of prints laid on a table. This is where the app earns "warm despite brutalist,"
  and it's the one place I want to spend real craft.
- **Density rules** (needs designing, not discovering): 1 photo sits centered and
  large; 2–5 form the arc properly; 6+ tightens the arc, caps the visible count and
  shows a `+4` chip that opens the day's full grid. Without an explicit rule here a
  heavy day turns into mush.
- **Swipe between days** via CSS scroll-snap — native momentum, no gesture library,
  and it won't fight the page. Day dots at top double as jump targets.
- Only days that actually have photos enter the deck, plus any she adds manually.
  She should not swipe through three empty days to reach Friday.
- Tapping a photo in the crescent lifts it for a closer look, with remove and
  reassign available there — so a mis-sorted photo is fixable without going back.

### 3.3-b Card proportions at ~120 characters a day

A sentence or two per day means **the crescent stays the hero** and the caption field
is a comfortable three-to-four lines — close to the original mockup, with a little
more room to breathe.

- Field sized for ~4 lines, growing to ~6 before it scrolls. No scrollbar in the
  common case.
- A live **character count** in mono, but as a weekly total on the Send card rather
  than a per-day nag. She writes to a weekly length, so that's where the number
  belongs.
- The crescent still **compacts when the keyboard opens** (§3.3a) — that's driven by
  the keyboard, not by caption length.

### 3.3c Video in the crescent — play button, one at a time

**⚠️ iOS cannot play many videos at once.** Concurrent `<video>` elements hit WebKit
memory and decoder limits, with crashes reported as recently as iOS 17/18, and the
standing advice is to prefer one video per page. Blob URLs on video sources have also
leaked memory on iOS. So "every video loops forever" would crash her phone on a
heavy Saturday.

**Your call to take the play button is the right one.** With two or three videos on a
single day, auto-play can only ever wake one of them — which leaves the rest looking
broken and gives her no way to say which she meant. An explicit tap removes the
ambiguity that the auto-loop design created.

- Video tiles show a **still first frame** with a centred play button.
- Tapping plays it in place: `muted`, `playsinline`, `loop`. **Tapping a second video
  stops the first** — only one is ever decoding.
- Tapping the playing tile stops it. Swiping to another day stops it and releases the
  object URL. That's the memory hygiene that keeps a long session alive.
- Attributes are mandatory, not optional: without `playsinline` iOS yanks it
  fullscreen, without `muted` it won't start without a gesture.
- **The first-frame trick:** iOS renders a blank tile until the video has painted a
  frame, so we seek to `currentTime = 0.1` on load to force one. Otherwise every video
  in the crescent is a black rectangle.

Cost: roughly half a day, mostly lifecycle bookkeeping rather than visual work.

Videos also need a **size guard at share time** — a single 4K clip can outweigh
thirty photos and take the payload past the ceiling we find in §6.4.

### 3.3a ⚠️ The keyboard is the whole ballgame

The iOS keyboard covers roughly half the screen. If the crescent is still where it
was when the keyboard opens, **the photos are hidden behind it and we have rebuilt
the exact problem you're trying to escape.**

So: on caption focus, the crescent animates into a compact arc that stays fully
visible above the keyboard, and the card layout is driven by the **`visualViewport`
API** rather than `100vh` — `vh` units do not account for the keyboard on iOS and
will silently break this.

This is the single most important implementation detail in the app, it is the thing
most likely to be subtly wrong on a real device, and it gets tested first (§6.4).

### 3.4 The Send card — the last card in the deck

She swipes past the last day and arrives at Send. No separate navigation, no button
that pulls her out of the flow — the deck simply ends in the thing she came to do.

- The **week card preview** (§1.1a) rendered exactly as it will send.
- Photo count and total size, with a warning band near the empirical ceiling (§6.4).
- **`SHARE THE WEEK`** → the ladder in §5.5.
- Post-share: a warm confirmation and `START A NEW WEEK`, which clears everything.
  This is the only "delete" in the app.

### 3.5 States we must design, not discover

Empty (nothing picked), converting, all-unsorted (EXIF unavailable — the plausible
worst case), one photo, 40 photos, share cancelled, share unsupported, share failed,
offline launch, restored-session prompt.

---

## 4. Phase 2 — Mockups (approval gate)

**Deliverable:** a published Artifact you can open *on your own phone*, containing
the key screens as real dark-mode HTML/CSS at iPhone width — not flat images, so
you can feel the type scale and spacing at actual size.

Screens: Entry · Week (populated) · Week (all-unsorted) · Tap-to-assign open ·
Review & Share · Post-share · Error/fallback · Empty.

Also in the mockup: the type scale, the palette, offset-shadow and border
treatments, and two or three icon directions.

**I will not write app code until you sign off on this.** Cost: ~half a day.

---

## 5. Phase 3 — Build

### 5.1 Shell & design system
Tokens, type scale, dark palette, `viewport-fit=cover` + `env(safe-area-inset-*)`
padding (mandatory — without it, content sits under the Dynamic Island in
standalone), view state machine.

### 5.2 Photo intake
File input, append semantics, conversion spinner, object-URL thumbnails with
revocation, per-file size accounting, video flagged and size-guarded.

### 5.3 EXIF + day bucketing
`exif.js`, map `DateTimeOriginal` → day index, unsorted tray for misses, and a
`lastModified` sanity check that *rejects* implausible values (§1.2) rather than
trusting them.

### 5.4 Sort stage
Triage screen, unsorted tray, chip reassignment, remove-photo.

### 5.4a The Day Deck — the big one
Scroll-snap deck, crescent layout engine with the density rules from §3.3, day dots,
photo lightbox, and the `visualViewport` keyboard choreography (§3.3a). **Budget the
most time here.** It is simultaneously the highest-craft and highest-risk piece, and
it is the reason to build the deck before anything cosmetic.

### 5.4b Print card renderer — core (§1.1b)
Canvas render of the week's captions in the app's own type and palette, exported via
`canvas.toBlob()` as a `File` and prepended to the share array. At ~900 characters
total this fits one readable card comfortably.

**Emoji: supported.** Canvas draws colour emoji natively on iOS provided the font
stack ends in `Apple Color Emoji`. The trap is line-wrapping — splitting a string by
character shreds emoji into broken boxes — so the renderer wraps by **grapheme** using
`Intl.Segmenter` (Safari 14.1+), which also keeps ZWJ sequences like 👩‍👩‍👧 intact.
Emoji in the caption fields and in the shared `text` are free either way.

Canvas gotchas:
Canvas render of the captions in the app's own type and palette, exported via
`canvas.toBlob()` as a `File` and prepended to the share array. Three things that
will silently bite:
- Fonts must be loaded (`await document.fonts.ready`) before drawing, or the canvas
  quietly falls back to a system face and the card looks nothing like the app.
- Render at 2–3x and scale down, or it looks soft on a retina screen.
- It must be generated **before** the share tap, not inside the handler — otherwise
  it burns the user-activation window (§1.1) and the share silently fails.

### 5.5 The share ladder (§1.1b)

Files assembled and the print rendered *before* the tap, so no async work eats the
user-activation window (§1.1).

1. **Copy the composed text to the clipboard.** Unconditional, first, every attempt.
2. `navigator.canShare({ files })` → if false, jump to 5.
3. **Rung 1:** `share({ files: [print, ...photos], text })`.
4. On any failure that isn't `AbortError` — **Rung 2:** `share({ files: [print, ...photos] })`.
   Still one tap. The print carries every caption, so nothing is actually lost.
5. Still failing — **Rung 3:** fall forward into the two-step stepper: `share({ text })`,
   then `share({ files })`. Presented as an explicit `1 → 2` so it reads as designed
   rather than as a retry loop. Do not auto-fire step 2; she needs to finish in
   Messages and come back.
6. **Rung 4:** her photos are already in her camera roll, so the instruction is not
   "download these" — it's "your words are copied; open Messages, paste, and attach
   from your roll."
7. `AbortError` (she tapped cancel) → return silently to Send. Never an error UI.

Rung 3 should be rare. §6.4 testing tells us whether it ever fires on her device, and
if rungs 1–2 prove solid the stepper stays invisible.

### 5.6 PWA installability
- `manifest.webmanifest`: `display: standalone`, `start_url: "."`, theme/background
  color, 192/512/maskable icons.
- iOS-specific tags alongside the manifest — `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style: black-translucent`, and a 180px
  `apple-touch-icon` link (older iOS ignores manifest icons for the home screen).
- Splash: iOS 17+ generates one from the manifest. **Recommend accepting that**
  rather than authoring per-device `apple-touch-startup-image` sets — it's a day of
  fiddly device-matrix work for a marginal gain. Flagging it as your call.
- `sw.js`: cache-first over ~7 files, `skipWaiting` + `clients.claim`, versioned
  cache name.
- **Trap-door escape hatch:** standalone mode has no reload UI, so a broken cached
  shell is unrecoverable for her. A version string in the footer that clears caches
  and reloads when tapped three times costs 10 lines and is genuinely necessary.

### 5.7 Caption autosave — recommend yes, narrowly scoped

**Persist captions only, keyed by ISO date, in localStorage, debounced.** Not photos.

Photos would mean IndexedDB, blob serialization, and quota handling — a
disproportionate amount of the timeline for something that costs her three taps to
redo. Captions are the irreplaceable part: they're typed, they're personal, and
losing them to an iOS background kill mid-session is the one failure that would
actually sting.

Keying by date rather than by session makes restore trivial and photo-independent —
captions repopulate into the right days even though the photos must be re-picked.
Entries outside the current 8-day window are pruned on load, so it self-cleans and
never becomes the "history" you explicitly don't want.

**Cost: ~30 lines. Recommend building it.**

---

## 6. Phase 4 — Testing on a real iPhone

### 6.1 ⚠️ You're on Windows — no Safari Web Inspector

Safari's remote inspector requires a Mac. **You will have no console on the device.**
Plan around it rather than discovering it at 1am:

**Build a `#debug` screen into the app** (hidden, reachable by URL fragment). It
reports: iOS/Safari version, standalone-vs-browser, `canShare` results for each
payload shape, per-file name/type/size, EXIF parse result per file, and a log pane
that captures `window.onerror` and console output — plus **`COPY DIAGNOSTICS`**, so
you can paste the results straight back to me.

Cost: ~1 hour. It is the difference between debugging and guessing, and I'd build it
first, not last.

### 6.2 Serving to the phone
Web Share and service workers require HTTPS. Your phone can't reach your laptop's
`localhost`, so **deploy to the real host on day one and test there.** The URL is
effectively private. A tunnel (`cloudflared`) is the alternative if you want faster
iteration, but for a days-long timeline, deploy-and-test is less setup.

### 6.3 Install checklist
Safari → Share → Add to Home Screen → launch from icon → verify: no browser chrome,
splash appears, icon is right, safe areas correct in portrait, survives airplane
mode (SW), survives a force-quit and relaunch.

### 6.4 The tests that actually matter

1. **Keyboard choreography (§3.3a).** Tap into a caption on a day with 1, 3, and 7
   photos. **Are the photos still visible above the keyboard in every case?** Test
   in portrait, after rotating, and after switching apps and back. This is the
   feature you asked for, it's the most likely thing to be subtly broken on device,
   and it gets tested first.
2. **Find the ceiling.** Share 1, then 5, 10, 20, 30, 40 photos. Note where it gets
   slow and where it fails. **Set the app's warning threshold below that number.**
   The single most important empirical result, and it can't be looked up.
3. **Week card fidelity.** Does the rendered card use the right fonts on device
   (§5.4b), and is it legible in a Messages thread at thumbnail size *before* you
   tap it? A card nobody can read until they open it is a half-solved problem.
4. **Text survival matrix.** Share to Messages, WhatsApp, Mail, Photos, Instagram.
   Record which keep the `text` and which drop it. This decides whether step 3 or
   step 4 of the ladder is the real-world default, and it shapes the share copy —
   but thanks to the week card, it no longer decides whether the app works.
3. **EXIF accuracy.** Pick 10 photos with known dates spread across the week. How
   many land on the right day? If it's poor, the Unsorted tray is the primary path
   and deserves more UI weight.
4. **HEIC vs. JPEG.** Test with the picker's Format set to Automatic *and* Current.
5. **Background kill.** Fill in captions, background the app 10+ minutes, open other
   apps, return. Captions restored?
6. **A video in the mix.** Confirm it doesn't break an otherwise-fine share.
7. **Cold offline launch** from the home screen icon.

### 6.5 Dress rehearsal
Do one complete real recap yourself, start to finish, and actually send it to
someone. Every rough edge shows up in the real run and none of them show up in
piecemeal testing.

---

## 7. Phase 5 — Deployment & handoff

### 7.1 Hosting — GitHub Pages vs. Cloudflare Pages

Bandwidth is irrelevant at one user and a few MB a month; you'd use a rounding
error's worth of either. So the comparison is decided by four things that actually
differ:

| | GitHub Pages | Cloudflare Pages |
|---|---|---|
| **Private source repo** | ✗ Free tier requires a **public** repo; private needs paid GitHub Pro | ✓ Private, free |
| **Custom HTTP headers** | ✗ None. No control at all | ✓ `_headers` file |
| **Preview deploys** | ✗ | ✓ Per-branch preview URLs |
| Bandwidth | 100 GB/mo soft, 1 GB site | Unlimited |
| Custom domain + HTTPS | ✓ free | ✓ free |
| Deploy | git push | git push |
| Longevity risk | Very low — stable for over a decade | Low — Cloudflare steers *new* projects to Workers, but Pages is supported with no forced migration and a documented migration path |

**Recommendation: Cloudflare Pages, source in a private GitHub repo.** Three reasons,
and the first is decisive on its own:

1. **Private repo, free.** GitHub Pages on the free tier requires a public repo —
   making it private means paying for GitHub Pro, which violates the "never needs a
   subscription" constraint that drove this question in the first place. So GitHub
   Pages is only free if you're willing to publish the source of a gift that has her
   name in it. No photos or captions would ever be in the repo, but the code, copy,
   and icon art would be.
2. **Header control is a real PWA safety feature here, not a nicety.** A
   `Cache-Control: no-cache` on `sw.js` and the manifest is how you guarantee updates
   propagate. Recall §5.6: in standalone mode she has no reload button, so a bad
   cached service worker is unrecoverable *for her*. GitHub Pages gives you zero
   header control; Cloudflare gives you a `_headers` file. That directly de-risks the
   scariest failure mode in the app.
3. **Preview deploys let you test on your iPhone without touching hers.** Push a
   risky change to a branch, get a separate URL, verify it on your device, and only
   then merge to the URL sitting on her home screen. For a gift with a deadline,
   that's worth having.

You're also right that this isn't either/or: Cloudflare Pages builds *from* the
GitHub repo, so the code keeps GitHub's durability and Cloudflare only does hosting.

**On Pages vs. Workers:** Cloudflare now points greenfield projects at Workers
static assets, which reached feature parity in early 2026. For a plain static PWA
that buys nothing and costs a `wrangler` config, and the Pages→Workers migration is
documented if it's ever forced. **Start on Pages.**

### 7.2 Getting it onto her phone

1. She opens the URL **in Safari** — the flow is most reliable there.
2. Share → **Add to Home Screen** → Add.
3. Launch from the icon, not the tab. Everything below depends on this: standalone
   chrome, the splash, and the storage exemption that keeps her captions from being
   purged (§1.4).

**Do the install yourself on her phone if you can** — it's the one step where a
misfire ("she added it from Chrome") quietly degrades the whole experience.

### 7.3 What she needs to be told

Almost nothing, by design — but two things aren't discoverable:

- **"Tap the icon, not a browser tab."**
- **"You can hit Pick Photos again to add more — it won't lose what you have."**

I'd put both in a **one-screen first-launch overlay** inside the app so there's no
instruction manual to hand her. A gift shouldn't come with a README.

### 7.4 Pushing updates after she has it

This is where the no-build stack pays off. A typo fix is: **edit the file, `git push`,
live in ~30 seconds.** No install, no bundle, no dependency resolution that might have
rotted since last time.

The one genuinely fiddly part is the service worker, because its whole job is to
serve cached files:

- `sw.js` carries a `CACHE_VERSION` constant, bumped per release. New version installs,
  `skipWaiting()` + `clients.claim()`, old caches deleted on activate.
- `_headers` sets `Cache-Control: no-cache` on `/sw.js` and `/manifest.webmanifest` so
  the browser always revalidates them. **This is the concrete reason we're on
  Cloudflare rather than GitHub Pages** (§7.1) — without header control you're at the
  mercy of the CDN's default TTL on exactly the file that gates every update.
- On her phone, a new version applies on the **next cold launch**. iOS kills
  backgrounded PWAs aggressively, so in practice that's within a day.
- Need it applied immediately? The version stamp in the footer, tapped three times,
  clears caches and hard-reloads (§5.6).
- The `#debug` screen prints the live version string, so you can confirm what she is
  actually running rather than what you think you shipped.
- **Preview deploys:** push to a branch, get a separate URL, test it on your iPhone,
  and only merge when it's right. Her icon never points at an unverified build.

---

## 8. Timeline & risk

### Schedule

| | |
|---|---|
| **Day 1** | Mockups → your sign-off |
| **Day 2** | Shell, intake, EXIF, week view, `#debug` screen |
| **Day 3** | Captions, tap-to-assign, share ladder, autosave, PWA setup, deploy |
| **Day 4** | Device testing (§6.4), threshold tuning, polish, dress rehearsal |
| **Day 5** | Buffer |

### What would meaningfully extend it — your call

Now **in scope**: the print renderer (§5.4b), the crescent deck (§3.3), the video
lifecycle (§3.3c), and `config.js` + self-hosted fonts (§2.6). Add **one day** to the
schedule below for video and config — call it Day 3.5. Still cuttable:

| Feature | Cost | My take |
|---|---|---|
| Per-device splash screens | +0.5 day | Skip — iOS 17+ auto-generates an acceptable one |
| Photo reordering within a day | +0.5 day | Skip for v1 |
| Drag-and-drop assignment | +1 day | Skip — worse than tap-to-assign on touch (§3.2) |
| IndexedDB photo persistence | +1 day | Skip — poor value vs. §5.7 |
| Video *thumbnail extraction* to canvas | +0.5 day | Skip — the first-frame seek (§3.3c) is cheaper and good enough |
| Date-keyed tagline overrides | +0.1 day | Cheap and charming. Say the word (§2.6) |

### Top risks

1. **The keyboard covers the crescent** and we rebuild the exact annoyance this app
   exists to fix. Mitigated by `visualViewport` layout (§3.3a) and by testing it
   first (§6.4 test 1). **This is now the top risk, ahead of the share.**
2. **EXIF is unavailable across her library** → everything lands unsorted.
   Mitigated by making manual assignment fast by default rather than a fallback.
3. **A photo-count ceiling below her normal week.** Found in §6.4 test 2; mitigated
   by warning early and suggesting she split the share.
4. **No Safari Inspector on Windows.** Mitigated by the `#debug` screen (§6.1).
5. ~~Captions dropped by her messaging app~~ — **downgraded from critical.** The
   print (§1.1b) removes the dependency on the `text` field entirely.
6. **A heavy day with several videos destabilises the deck.** iOS crashes on
   concurrent video are real (§3.3c); mitigated by the strict one-live-video rule and
   by releasing object URLs on swipe. Worth a dedicated soak test in §6.4.

---

## Next step

Mockups are built (`mockup.html`, published as an Artifact). Open them **on your
iPhone** — they're laid out at real device width, so the type scale and the crescent
read truthfully there in a way they won't on a monitor.

Name is settled (**Millie Time**) and the print format is resolved by §1.1a. What's
left, listed at the bottom of the mockup page: the **icon** (A–D, all built around
M/MT), your **tagline** and its typeface, and the **print heading**.

Only the icon blocks the build.
