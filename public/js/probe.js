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

import { exifApp1, exifPngChunk, PNG_AFTER_IHDR } from "./exif.js";

const COUNT = 6;

// One permutation per candidate rule, all different, none the identity except
// the array order itself.
const nameRank    = (i) => COUNT - 1 - i;                    // 6 5 4 3 2 1
const dateRank    = (i) => (i + 3) % COUNT;                  // 4 5 6 1 2 3
const stampRank   = (i) => (i % 2 ? i - 1 : i + 1);          // 2 1 4 3 6 5

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

function card(position, lines, width = 600, height = 800) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const x = c.getContext("2d");
  const scale = width / 600;

  x.fillStyle = "#11100e";
  x.fillRect(0, 0, c.width, c.height);

  // Noise, so the encoder has something incompressible to chew on and a file
  // asked to be four megabytes is mostly genuine image rather than filler.
  for (let i = 0; i < (width * height) / 400; i++) {
    x.fillStyle = `hsl(${Math.random() * 360},70%,${20 + Math.random() * 50}%)`;
    x.fillRect(Math.random() * width, Math.random() * height, 14 * scale, 14 * scale);
  }

  x.fillStyle = "rgba(17,16,14,.72)";
  x.fillRect(0, height / 2 - 280 * scale, width, 640 * scale);

  x.fillStyle = "#ffffff";
  x.font = `bold ${380 * scale}px ui-sans-serif, -apple-system, sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(String(position), c.width / 2, c.height / 2 - 60 * scale);

  x.font = `${26 * scale}px ui-monospace, monospace`;
  x.fillStyle = "#e8e3d8";
  lines.forEach((line, i) => x.fillText(line, c.width / 2, c.height / 2 + (200 + i * 38) * scale));
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


// ---------------------------------------------------------------------------
// The heavy probe.
//
// The six-photo probe above lands in order, which settles that Messages honours
// the array we hand it. A real week does not, and the difference is not
// metadata: it is 28 MB across eleven files with a 36× spread of sizes, from a
// 161 KB save off Snapchat to a 5.8 MB camera original.
//
// So this one is production-shaped. Every signal — array order, filename,
// capture date, file timestamp — agrees, exactly as a real share does. The only
// thing that varies is SIZE, and the two smallest photos sit deliberately at
// positions 9 and 10.
//
//   arrives 1 … 11             size is not it either; look elsewhere
//   the small ones lead        it is a race, and small files win it
//   different order each send  a race with no rule; the fix is fewer files
//
// The sizes mirror a real week of hers, position for position.
// ---------------------------------------------------------------------------

const HEAVY_MB = [0.03, 2.3, 3.1, 5.8, 3.4, 0.2, 3.9, 4.9, 0.16, 0.45, 3.9];

// Position 1 stands in for the print, which really is a small PNG that leads
// the payload. Position 3 stands in for the screenshot in the middle of a day.
const HEAVY_PNG = new Set([1, 3]);

const CHUNK = 1 << 20;

/**
 * A megabyte of noise, made once and referenced many times.
 *
 * Blob parts hold references, so padding eleven files out to 28 MB costs this
 * one buffer rather than 28 MB of copies. Noise rather than zeroes because a
 * run of zeroes is exactly the thing a transfer might compress away.
 */
let padding = null;

function padBuffer() {
  if (padding) return padding;
  padding = new Uint8Array(CHUNK);
  for (let at = 0; at < CHUNK; at += 65536) {         // getRandomValues caps at 64K
    crypto.getRandomValues(padding.subarray(at, Math.min(at + 65536, CHUNK)));
  }
  return padding;
}

/** Blob parts summing to `bytes`, all views onto the one buffer. */
function padParts(bytes) {
  const buffer = padBuffer();
  const parts = [];
  let left = Math.max(0, Math.round(bytes));
  while (left >= CHUNK) { parts.push(buffer); left -= CHUNK; }
  if (left > 0) parts.push(buffer.subarray(0, left));
  return parts;
}

/**
 * Real image data, then padding to the target.
 *
 * The image is genuinely a couple of megapixels of noise, so decoding it costs
 * something real. The padding after it — trailing bytes past EOI, which every
 * decoder ignores — is what makes the byte count match a camera original
 * without holding eleven camera originals in memory at once.
 */
async function sized(canvas, type, targetBytes) {
  const blob = await new Promise((res) => canvas.toBlob(res, type, 0.9));
  if (!blob) return null;
  return [blob, ...padParts(targetBytes - blob.size)];
}

export async function buildHeavyProbe(onProgress) {
  const count = HEAVY_MB.length;
  const width = String(count).length;
  const files = [];

  for (let i = 0; i < count; i++) {
    const position = i + 1;
    const png = HEAVY_PNG.has(position);
    const megabytes = HEAVY_MB[i];
    if (onProgress) onProgress(position, count);

    // Big enough to be a real decode, small enough that eleven of them in a row
    // do not tip iOS over. The padding does the rest of the weight.
    const canvas = card(position, [
      `${megabytes} MB`,
      `${png ? "png" : "jpeg"} · sent ${position} of ${count}`,
      "everything agrees except size",
    ], 1200, 1600);

    const type = png ? "image/png" : "image/jpeg";
    const parts = await sized(canvas, type, megabytes * 1024 * 1024);
    if (!parts) continue;

    // Ascending, exactly as a real share builds them.
    const taken = new Date(2020, 0, 1 + i, 12, 0, 0);
    const stamp = taken.getTime();
    const dateBlock = png
      ? [parts[0].slice(0, PNG_AFTER_IHDR), exifPngChunk(taken), parts[0].slice(PNG_AFTER_IHDR)]
      : [parts[0].slice(0, 2), exifApp1(taken), parts[0].slice(2)];

    files.push(new File(
      [...dateBlock, ...parts.slice(1)],
      `${String(position).padStart(width, "0")}.${png ? "png" : "jpg"}`,
      { type, lastModified: stamp },
    ));

    // Let the frame breathe, so the progress line actually paints on the phone.
    await new Promise((r) => setTimeout(r, 0));
  }

  const total = files.reduce((sum, f) => sum + f.size, 0);
  return {
    files,
    total,
    key: [
      "Millie Time heavy order probe",
      "",
      `${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MB — the shape of a real week.`,
      "Array order, filename, capture date and timestamp ALL agree here.",
      "Only the sizes vary, and the two smallest sit at positions 9 and 10.",
      "",
      "  1 … 11 in order  → size is not it either",
      "  small ones first → it is a race, and small files win it",
      "  different each time → a race with no rule",
      "",
      ...files.map((f, i) => `${i + 1}: ${f.name}, ${(f.size / 1024 / 1024).toFixed(2)} MB`),
    ].join("\n"),
  };
}
