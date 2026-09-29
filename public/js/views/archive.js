// The archive — every week she has finished, as she wrote it.
//
// Laid out as the same paper the print is on, because that is what these are:
// the week's words, kept. The photos are in her camera roll where they always
// were; this is the part that only ever existed here.

import { h, clear } from "../ui.js";
import { set } from "../state.js";
import { dayLabel, rangeLabel, rangeBetween } from "../dates.js";
import { archivedWeeks, forgetWeek, archiveText } from "../archive.js";
import { copyText } from "../share.js";

/** "AUG 14 — 21", the same label the print and the send card use. */
const spanOf = (week) => rangeLabel(rangeBetween(week.startIso, week.endIso));

function weekCard(week, onChanged) {
  const days = Object.keys(week.captions).sort();

  const paper = h("div", { class: "print" },
    h("div", { class: "p-h" },
      h("span", { text: spanOf(week) }),
      h("span", { text: `${days.length} ${days.length === 1 ? "day" : "days"}` })),
  );

  for (const iso of days) {
    paper.append(h("div", { class: "p-row" },
      h("span", { class: "p-d", text: dayLabel(iso).wd }),
      h("span", { class: "p-c", text: week.captions[iso] })
    ));
  }

  return h("div", { class: "arc-week" },
    paper,
    h("button", {
      type: "button", class: "sheet-x", text: "Forget this week",
      onclick: () => { forgetWeek(week.startIso, week.endIso); onChanged(); },
    })
  );
}

export function renderArchive(root, { onBack }) {
  clear(root);
  const weeks = archivedWeeks();
  const again = () => renderArchive(root, { onBack });

  root.append(h("div", { class: "topbar" },
    h("button", { type: "button", class: "brandline linkish", text: "← Back", onclick: onBack }),
    h("p", { class: "brandline", text: weeks.length ? `${weeks.length} weeks` : "Archive" })
  ));

  if (!weeks.length) {
    root.append(
      h("div", { class: "spacer" }),
      h("p", { class: "warmline centred",
        text: "Nothing here yet. A week lands here when you send it, or when you start the next one." }),
      h("p", { class: "helper",
        text: "Only the words — your photos stay in your camera roll." }),
      h("div", { class: "spacer" })
    );
    return;
  }

  const scroller = h("div", { class: "scroll" });
  for (const week of weeks) scroller.append(weekCard(week, again));
  root.append(scroller);

  // The whole thing, on the clipboard. This is what makes keeping the archive
  // on the phone a choice rather than a gamble.
  const copy = h("button", {
    class: "btn ghost sm", type: "button", text: "Copy all",
    onclick: async () => {
      const ok = await copyText(archiveText(weeks, spanOf));
      copy.textContent = ok ? "Copied ✓" : "Copy failed";
      setTimeout(() => { copy.textContent = "Copy all"; }, 1600);
    },
  });
  root.append(copy);
}

/** Open it, remembering where she was so Back means back. */
export function openArchive(from) {
  set({ view: "archive", cameFrom: from });
}
