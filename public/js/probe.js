// The order probe.
//
// Everything up to navigator.share() is testable on a desktop (see
// tools/harness). What happens after it is not: Messages decides for itself how
// to arrange a set of attachments, and no amount of reasoning about it settles
// what rule it uses. So this sends one deliberately contradictory batch and
// lets the answer arrive in the thread.
//
// Six photos, each showing the position it OUGHT to land in. The four things a
// receiving app might sort by are each set to a different order, so whatever
// comes back names the rule:
//
//   arrives 1 2 3 4 5 6   the order we handed them over wins
//   arrives 6 5 4 3 2 1   the filename wins
//   arrives 4 5 6 1 2 3   the capture date wins
//   arrives 2 1 4 3 6 5   the file's timestamp wins
//   anything else         none of them — it is grouping or shuffling on its own
//
// Whichever it is, that is the signal the real share should be built around.

import { exifApp1 } from "./exif.js";

const COUNT = 6;

// One permutation per candidate rule, all different, none the identity except
// the array order itself.
const nameRank    = (i) => COUNT - 1 - i;                    // 6 5 4 3 2 1
const dateRank    = (i) => (i + 3) % COUNT;                  // 4 5 6 1 2 3
const stampRank   = (i) => (i % 2 ? i - 1 : i + 1);          // 2 1 4 3 6 5

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

function card(position, lines) {
  const c = document.createElement("canvas");
  c.width = 600;
  c.height = 800;
  const x = c.getContext("2d");

  x.fillStyle = "#11100e";
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#f4f1ea";
  x.font = "bold 380px ui-sans-serif, -apple-system, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(String(position), c.width / 2, c.height / 2 - 60);

  x.font = "26px ui-monospace, monospace";
  x.fillStyle = "#c8c2b4";
  lines.forEach((line, i) => x.fillText(line, c.width / 2, c.height / 2 + 200 + i * 38));
  return c;
}

const toBlob = (canvas) =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));

/**
 * Build the batch. Async and slow-ish, so it must happen well before the tap —
 * the same rule the print lives by.
 *
 * @returns {Promise<{files: File[], key: string}>}
 */
export async function buildProbe() {
  // A fixed, obviously-fake week so a stray probe photo is never mistaken for
  // one of hers, and so the dates are readable at a glance.
  const dateFor = (rank) => new Date(2020, 0, 1 + rank, 12, 0, 0);
  const stampFor = (rank) => new Date(2020, 5, 1 + rank, 12, 0, 0).getTime();

  const files = [];
  const key = [];

  for (let i = 0; i < COUNT; i++) {
    const shown = i + 1;
    const name = `${String(nameRank(i) + 1).padStart(2, "0")}.jpg`;
    const taken = dateFor(dateRank(i));
    const stamp = stampFor(stampRank(i));

    const canvas = card(shown, [
      `handed over ${ORDINALS[i]}`,
      `named ${name}`,
      `taken ${taken.toISOString().slice(0, 10)}`,
    ]);
    const blob = await toBlob(canvas);
    if (!blob) continue;

    files.push(new File(
      [blob.slice(0, 2), exifApp1(taken), blob.slice(2)],
      name,
      { type: "image/jpeg", lastModified: stamp },
    ));
    key.push(`${shown}: sent ${ORDINALS[i]}, named ${name}, taken ${taken.toISOString().slice(0, 10)}`);
  }

  return {
    files,
    key: [
      "Millie Time order probe",
      "",
      "The photos are numbered 1–6. Whatever order they arrive in:",
      "  1 2 3 4 5 6  → it keeps the order we send",
      "  6 5 4 3 2 1  → it sorts by filename",
      "  4 5 6 1 2 3  → it sorts by capture date",
      "  2 1 4 3 6 5  → it sorts by file timestamp",
      "  anything else → it does its own thing",
      "",
      ...key,
    ].join("\n"),
  };
}
