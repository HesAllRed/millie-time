// What does a photo actually say about when it was taken?
//
//   node tools/photo-forensics.mjs <files…>
//
// The app reads one tag: EXIF DateTimeOriginal. That is the right tag for a
// photo out of the iPhone camera. It is not obviously the right one for a
// screenshot, or for something saved to the roll out of Snapchat, and those
// land in the same week as everything else.
//
// So this dumps every date-bearing field in the file, plus whatever identifies
// where the image came from, and then lists the batch ordered by each candidate
// field in turn. If two of those orderings disagree, the disagreement is the
// bug — and the one that matches the camera roll is the field we should be
// reading.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fromJpeg, fromMp4, fromLastModified } from "../public/js/exif.js";

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

const IFD0_TAGS = {
  0x010f: "Make",
  0x0110: "Model",
  0x0131: "Software",
  0x0132: "DateTime",
  0x013b: "Artist",
  0x9c9b: "XPTitle",
};

const EXIF_TAGS = {
  0x9003: "DateTimeOriginal",
  0x9004: "DateTimeDigitized",
  0x9010: "OffsetTime",
  0x9011: "OffsetTimeOriginal",
  0x9012: "OffsetTimeDigitized",
  0x9290: "SubSecTime",
  0x9291: "SubSecTimeOriginal",
  0x9292: "SubSecTimeDigitized",
  0xa002: "PixelXDimension",
  0xa003: "PixelYDimension",
  0xa430: "CameraOwnerName",
  0x927c: "MakerNote",
  0x0132: "DateTime",
};

const GPS_TAGS = {
  0x0007: "GPSTimeStamp",
  0x001d: "GPSDateStamp",
};

const EXIF_IFD_POINTER = 0x8769;
const GPS_IFD_POINTER = 0x8825;

function readValue(view, tiff, entry, le) {
  const { type, count, valueOffset, inline } = entry;
  const size = TYPE_SIZE[type] || 1;
  const total = size * count;
  const at = total <= 4 ? inline : tiff + valueOffset;
  if (at < 0 || at + Math.min(total, 256) > view.byteLength) return "(out of range)";

  if (type === 2) {                                   // ASCII
    let out = "";
    for (let i = 0; i < Math.min(count, 128); i++) {
      const c = view.getUint8(at + i);
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return out;
  }
  if (type === 7 || type === 1) {                     // UNDEFINED / BYTE
    return `<${count} bytes>`;
  }
  const nums = [];
  for (let i = 0; i < Math.min(count, 8); i++) {
    const off = at + i * size;
    if (type === 3) nums.push(view.getUint16(off, le));
    else if (type === 4) nums.push(view.getUint32(off, le));
    else if (type === 9) nums.push(view.getInt32(off, le));
    else if (type === 5 || type === 10) {
      const n = type === 5 ? view.getUint32(off, le) : view.getInt32(off, le);
      const d = type === 5 ? view.getUint32(off + 4, le) : view.getInt32(off + 4, le);
      nums.push(d ? n / d : n);
    } else nums.push("?");
  }
  return nums.join(", ");
}

function readIfd(view, tiff, offset, le) {
  const entries = new Map();
  if (offset + 2 > view.byteLength) return entries;
  const count = view.getUint16(offset, le);
  for (let i = 0; i < count; i++) {
    const e = offset + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    entries.set(view.getUint16(e, le), {
      type: view.getUint16(e + 2, le),
      count: view.getUint32(e + 4, le),
      valueOffset: view.getUint32(e + 8, le),
      inline: e + 8,
    });
  }
  return entries;
}

/** Every tag we have a name for, out of a TIFF block. */
function readTiff(view, tiff) {
  const out = {};
  if (tiff + 8 > view.byteLength) return out;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return out;
  const le = order === 0x4949;
  if (view.getUint16(tiff + 2, le) !== 42) return out;
  out._byteOrder = le ? "little-endian (II)" : "big-endian (MM)";

  const ifd0 = readIfd(view, tiff, tiff + view.getUint32(tiff + 4, le), le);
  for (const [tag, name] of Object.entries(IFD0_TAGS)) {
    const entry = ifd0.get(Number(tag));
    if (entry) out[`IFD0.${name}`] = readValue(view, tiff, entry, le);
  }

  const exifPtr = ifd0.get(EXIF_IFD_POINTER);
  if (exifPtr) {
    const exif = readIfd(view, tiff, tiff + exifPtr.valueOffset, le);
    for (const [tag, name] of Object.entries(EXIF_TAGS)) {
      const entry = exif.get(Number(tag));
      if (entry) out[`Exif.${name}`] = readValue(view, tiff, entry, le);
    }
    out["Exif._tagCount"] = exif.size;
  } else {
    out["Exif._tagCount"] = 0;
  }

  const gpsPtr = ifd0.get(GPS_IFD_POINTER);
  if (gpsPtr) {
    const gps = readIfd(view, tiff, tiff + gpsPtr.valueOffset, le);
    for (const [tag, name] of Object.entries(GPS_TAGS)) {
      const entry = gps.get(Number(tag));
      if (entry) out[`GPS.${name}`] = readValue(view, tiff, entry, le);
    }
  }
  return out;
}

const APP_NAMES = {
  0xe0: "APP0", 0xe1: "APP1", 0xe2: "APP2 (ICC)", 0xed: "APP13 (Photoshop)",
  0xee: "APP14 (Adobe)", 0xfe: "COM",
};

function inspectJpeg(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const segments = [];
  const fields = {};
  let width = null;
  let height = null;

  let i = 2;
  while (i + 4 <= view.byteLength) {
    if (view.getUint8(i) !== 0xff) { i++; continue; }
    const marker = view.getUint8(i + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;
    const len = view.getUint16(i + 2);
    if (len < 2) break;

    let label = APP_NAMES[marker] || `0xff${marker.toString(16)}`;

    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = view.getUint16(i + 5);
      width = view.getUint16(i + 7);
      label = `SOF (${width}×${height})`;
    }

    if (marker === 0xe1) {
      const head = Buffer.from(buf.buffer, buf.byteOffset + i + 4, Math.min(32, len)).toString("latin1");
      if (head.startsWith("Exif")) {
        label = "APP1 (Exif)";
        Object.assign(fields, readTiff(view, i + 10));
      } else if (head.startsWith("http://ns.adobe.com/xap")) {
        label = "APP1 (XMP)";
        const xmp = Buffer.from(buf.buffer, buf.byteOffset + i + 4, len - 2).toString("utf8");
        for (const m of xmp.matchAll(/(\w+:(?:\w*Date\w*|DateTime\w*))="([^"]+)"/g)) {
          fields[`XMP.${m[1]}`] = m[2];
        }
        for (const m of xmp.matchAll(/<(\w+:(?:\w*Date\w*|DateTime\w*))>([^<]+)</g)) {
          fields[`XMP.${m[1]}`] = m[2];
        }
      }
    }
    segments.push(`${label} ${len}B`);
    i += 2 + len;
  }
  return { segments, fields, width, height };
}

function inspectPng(buf) {
  const segments = [];
  const fields = {};
  let width = null;
  let height = null;
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    segments.push(`${type} ${len}B`);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "tEXt" || type === "iTXt") {
      const text = data.toString("latin1");
      const nul = text.indexOf("\0");
      if (nul > 0) fields[`PNG.${text.slice(0, nul)}`] = text.slice(nul + 1).replace(/\0/g, " ").trim();
    }
    if (type === "eXIf") {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      Object.assign(fields, readTiff(view, 0));
    }
    if (type === "IEND") break;
    i += 12 + len;
  }
  return { segments, fields, width, height };
}

/** HEIC/HEIF: just report the brand, so at least the container is named. */
function inspectIso(buf) {
  const brand = buf.toString("latin1", 8, 12);
  const boxes = [];
  let i = 0;
  while (i + 8 <= buf.length && boxes.length < 12) {
    const size = buf.readUInt32BE(i);
    boxes.push(buf.toString("latin1", i + 4, i + 8));
    if (size < 8) break;
    i += size;
  }
  return { segments: [`brand ${brand}`, ...boxes], fields: {}, width: null, height: null };
}

function container(buf) {
  if (buf.length > 3 && buf.readUInt16BE(0) === 0xffd8) return "jpeg";
  if (buf.length > 8 && buf.toString("latin1", 1, 4) === "PNG") return "png";
  if (buf.length > 12 && buf.toString("latin1", 4, 8) === "ftyp") return "iso";
  return "unknown";
}

/** A guess at where the image came from, from the fields it carries. */
function provenance(fields) {
  const make = fields["IFD0.Make"] || "";
  const model = fields["IFD0.Model"] || "";
  const software = fields["IFD0.Software"] || "";
  if (make === "Apple" && /iPhone|iPad/.test(model) && fields["Exif.MakerNote"]) {
    return `iPhone camera (${model}${software ? `, ${software}` : ""})`;
  }
  if (make === "Apple" && /iPhone|iPad/.test(model)) return `Apple, no MakerNote (${model}) — re-encoded somewhere`;
  if (!make && !model && fields["Exif._tagCount"] === 0) return "no EXIF at all — screenshot, or stripped on save";
  if (!make && !model) return "EXIF but no camera — written by an app, not a camera";
  return `${make} ${model}`.trim() || "unknown";
}

const DATE_FIELDS = [
  "Exif.DateTimeOriginal",
  "Exif.DateTimeDigitized",
  "IFD0.DateTime",
  "GPS.GPSDateStamp",
  "XMP.xmp:CreateDate",
  "XMP.photoshop:DateCreated",
  "PNG.Creation Time",
];

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node tools/photo-forensics.mjs <files…>");
  process.exit(1);
}

const rows = [];

for (const file of files) {
  let buf;
  let info;
  try {
    buf = await readFile(file);
    info = await stat(file);
  } catch (e) {
    console.log(`\n${"═".repeat(72)}\n${path.basename(file)}\n  cannot read it: ${e.code || e.message}`);
    continue;
  }
  const kind = container(buf);
  const read = kind === "jpeg" ? inspectJpeg(buf)
    : kind === "png" ? inspectPng(buf)
    : kind === "iso" ? inspectIso(buf)
    : { segments: [], fields: {}, width: null, height: null };

  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const appSees = kind === "jpeg" ? fromJpeg(ab) : kind === "iso" ? fromMp4(ab) : null;

  console.log(`\n${"═".repeat(72)}`);
  console.log(path.basename(file));
  console.log(`${"─".repeat(72)}`);
  console.log(`container      ${kind}${read.width ? `  ${read.width}×${read.height}` : ""}  ${(buf.length / 1024).toFixed(0)} KB`);
  console.log(`looks like     ${provenance(read.fields)}`);
  console.log(`segments       ${read.segments.join(" · ") || "(none)"}`);
  console.log(`file mtime     ${info.mtime.toISOString()}`);
  console.log(`\nwhat the app reads today:`);
  console.log(`  DateTimeOriginal -> ${appSees ? appSees.toISOString() : "NOTHING — falls back to lastModified"}`);
  console.log(`  fromLastModified -> ${fromLastModified(info.mtimeMs)?.toISOString() ?? "rejected (too recent, or absent)"}`);

  const dates = Object.entries(read.fields).filter(([k]) => /date|time/i.test(k));
  console.log(`\nevery date-ish field in the file:`);
  if (!dates.length) console.log("  (none)");
  for (const [k, v] of dates) console.log(`  ${k.padEnd(28)} ${v}`);

  const other = Object.entries(read.fields).filter(([k]) => !/date|time/i.test(k) && !k.startsWith("_"));
  if (other.length) {
    console.log(`\nwhere it came from:`);
    for (const [k, v] of other) console.log(`  ${k.padEnd(28)} ${v}`);
  }

  rows.push({ file: path.basename(file), fields: read.fields, mtime: info.mtimeMs, appSees });
}

// The part that actually decides anything: if two candidate fields order the
// batch differently, one of them is wrong, and she can say which matches her roll.
if (rows.length > 1) {
  console.log(`\n${"═".repeat(72)}`);
  console.log("ORDER BY EACH CANDIDATE FIELD");
  console.log(`${"─".repeat(72)}`);
  console.log("If these disagree, the one matching your camera roll is the field to read.\n");

  const orderBy = (get) => {
    const known = rows.filter((r) => get(r) != null);
    const missing = rows.filter((r) => get(r) == null);
    return [...known.sort((a, b) => String(get(a)).localeCompare(String(get(b)))).map((r) => r.file),
            ...missing.map((r) => `${r.file}(no value)`)];
  };

  for (const field of DATE_FIELDS) {
    const present = rows.filter((r) => r.fields[field] != null).length;
    if (!present) continue;
    console.log(`${field.padEnd(28)} ${present}/${rows.length}  ${orderBy((r) => r.fields[field]).join("  →  ")}`);
  }
  console.log(`${"what the app uses".padEnd(28)} ${rows.filter((r) => r.appSees).length}/${rows.length}  ${orderBy((r) => r.appSees?.getTime()).join("  →  ")}`);
  console.log(`${"file mtime".padEnd(28)} ${rows.length}/${rows.length}  ${orderBy((r) => r.mtime).join("  →  ")}`);
  console.log(`${"the order you passed them".padEnd(28)}       ${rows.map((r) => r.file).join("  →  ")}`);
}
