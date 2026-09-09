// Photos and a clip for the harness to "pick".
//
// The JPEGs are drawn by Chromium and then have EXIF spliced in, so they are
// real decodable images carrying capture dates we chose. Each one is legibly
// numbered, which makes a screenshot of the deck worth looking at.

import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { withExifDate, withComment, MARKER } from "./exif-writer.mjs";

const PALETTE = ["#e8734a", "#4a8fe8", "#5fbf7a", "#c264d4", "#e8b84a", "#4ac6d4", "#d45f7a", "#7a8fe8"];

/**
 * Draw one numbered card and hand back its JPEG bytes.
 * Chromium encodes it, so we never have to hand-roll a JPEG.
 */
async function drawJpeg(page, { label, sub, colour }) {
  const dataUrl = await page.eval(`
    const c = document.createElement("canvas");
    c.width = 480; c.height = 640;
    const x = c.getContext("2d");
    x.fillStyle = ${JSON.stringify(colour)};
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#ffffff";
    x.font = "bold 220px sans-serif";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(${JSON.stringify(label)}, c.width / 2, c.height / 2 - 40);
    x.font = "28px monospace";
    x.fillText(${JSON.stringify(sub)}, c.width / 2, c.height / 2 + 130);
    return c.toDataURL("image/jpeg", 0.9);
  `);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** A file with an mvhd atom and nothing a decoder can use — enough for fromMp4. */
function fakeMov(when) {
  const QT_EPOCH = Date.UTC(1904, 0, 1);
  // fromMp4 rebuilds local time out of the UTC fields, so write the wall clock
  // as though it were UTC — exactly the lie Apple tells in this field.
  const asIfUtc = Date.UTC(
    when.getFullYear(), when.getMonth(), when.getDate(),
    when.getHours(), when.getMinutes(), when.getSeconds(),
  );
  const seconds = Math.round((asIfUtc - QT_EPOCH) / 1000);

  const ftyp = Buffer.alloc(20);
  ftyp.writeUInt32BE(20, 0);
  ftyp.write("ftypqt  ", 4, "ascii");

  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(108, 0);
  mvhd.write("mvhd", 4, "ascii");
  mvhd.writeUInt8(0, 8);                 // version 0
  mvhd.writeUInt32BE(seconds, 12);       // creation_time
  mvhd.writeUInt32BE(seconds, 16);       // modification_time
  mvhd.writeUInt32BE(600, 20);           // timescale
  mvhd.writeUInt32BE(1200, 24);          // duration

  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(8 + mvhd.length, 0);
  moov.write("moov", 4, "ascii");

  return Buffer.concat([ftyp, moov, mvhd]);
}

/**
 * @param {object} page       a CDP page parked on about:blank
 * @param {string} dir        where to write them
 * @param {Array}  specs      { label, takenAt, kind?, exif? } in PICK order
 * @returns {Promise<Array>}  the same specs plus { file } absolute paths
 */
export async function makeFixtures(page, dir, specs) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const out = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const stamp = spec.takenAt
      ? `${spec.takenAt.toISOString().slice(0, 10)} ${spec.takenAt.toTimeString().slice(0, 5)}`
      : "no date";

    if (spec.kind === "video") {
      const file = path.join(dir, `pick${i + 1}-${spec.label}.mov`);
      const marker = Buffer.from(`${MARKER}${spec.label}\0`, "ascii");
      await writeFile(file, Buffer.concat([fakeMov(spec.takenAt), marker]));
      out.push({ ...spec, file, kind: "video" });
      continue;
    }

    let bytes = await drawJpeg(page, {
      label: spec.label,
      sub: stamp,
      colour: PALETTE[i % PALETTE.length],
    });
    // `exif: false` models a photo iOS handed over stripped — the case that
    // silently falls back to the export timestamp.
    if (spec.exif !== false && spec.takenAt) bytes = withExifDate(bytes, spec.takenAt);
    bytes = withComment(bytes, spec.label);

    const file = path.join(dir, `pick${i + 1}-${spec.label}.jpg`);
    await writeFile(file, bytes);
    out.push({ ...spec, file, kind: "photo" });
  }
  return out;
}
