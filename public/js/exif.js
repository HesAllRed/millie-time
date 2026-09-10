// Capture-date extraction. Pure functions over ArrayBuffers — no DOM, no state.
// Unit tested in test/exif.test.js.
//
// Why this exists at all: Safari 17+ rewrites File.lastModified to the time iOS
// exported the file, not the time the photo was taken. Trusting it would put
// every photo on "today". So we read the real capture time out of the bytes.
//
// Best-effort by design. iOS 16.4 stripped EXIF on upload entirely and 16.4.2
// only restored DateTimeOriginal, so a miss is normal — a miss means the item
// lands in the Unsorted tray, never on a wrong day.

const TAG_DATETIME          = 0x0132; // IFD0, fallback
const TAG_EXIF_IFD_POINTER  = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003; // what we actually want
const TAG_DATETIME_DIGITIZED= 0x9004;

/** "2026:08:21 14:03:57" -> local Date, or null if unparseable. */
export function parseExifDate(str) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(str).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (!y || y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d, h, mi, s);
}

function ascii(view, offset, length) {
  let out = "";
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

/** Read one IFD, returning a Map of tag -> { type, count, valueOffset }. */
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
      // ASCII values longer than 4 bytes live at an offset from the TIFF header;
      // shorter ones are packed inline in these same 4 bytes.
      valueOffset: view.getUint32(e + 8, le),
      inline: e + 8,
    });
  }
  return entries;
}

function readAsciiTag(view, tiff, entry, le) {
  if (!entry || entry.type !== 2) return null;
  const at = entry.count <= 4 ? entry.inline : tiff + entry.valueOffset;
  if (at + Math.min(entry.count, 32) > view.byteLength) return null;
  return ascii(view, at, Math.min(entry.count, 32));
}

/**
 * Read a capture date out of a TIFF block — the shape EXIF takes wherever it
 * is carried. JPEG wraps it in an APP1 segment; PNG puts the same bytes in an
 * eXIf chunk.
 *
 * @param {DataView} view
 * @param {number} tiff  offset of the TIFF header ("II" or "MM")
 */
function fromTiff(view, tiff) {
  if (tiff + 8 > view.byteLength) return null;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const le = order === 0x4949;
  if (view.getUint16(tiff + 2, le) !== 42) return null;

  const ifd0 = readIfd(view, tiff, tiff + view.getUint32(tiff + 4, le), le);

  const ptr = ifd0.get(TAG_EXIF_IFD_POINTER);
  if (ptr) {
    const exif = readIfd(view, tiff, tiff + ptr.valueOffset, le);
    for (const tag of [TAG_DATETIME_ORIGINAL, TAG_DATETIME_DIGITIZED]) {
      const parsed = parseExifDate(readAsciiTag(view, tiff, exif.get(tag), le) || "");
      if (parsed) return parsed;
    }
  }
  return parseExifDate(readAsciiTag(view, tiff, ifd0.get(TAG_DATETIME), le) || "");
}

/**
 * Pull DateTimeOriginal out of a JPEG's EXIF block.
 * @param {ArrayBuffer} buffer  the head of the file is enough (~256KB)
 * @returns {Date|null}
 */
export function fromJpeg(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  let i = 2;
  while (i + 4 <= view.byteLength) {
    if (view.getUint8(i) !== 0xff) { i++; continue; }         // resync
    const marker = view.getUint8(i + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;             // start of scan / end
    const len = view.getUint16(i + 2);
    if (len < 2) break;

    if (marker === 0xe1 && i + 10 <= view.byteLength && ascii(view, i + 4, 4) === "Exif") {
      return fromTiff(view, i + 10);
    }
    i += 2 + len;
  }
  return null;
}

// PNG. Signature, then chunks: length(4) type(4) data(length) crc(4). IHDR is
// always first and always 13 bytes of data, which pins the one offset we need.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const PNG_AFTER_IHDR = 8 + 25;

/**
 * Is this really a PNG, with the IHDR the spec requires first?
 *
 * Both halves matter: `PNG_AFTER_IHDR` is a fixed offset we splice at, and it
 * is only fixed because IHDR is mandatory, first, and 13 bytes long.
 */
export function isPng(buffer) {
  if (buffer.byteLength < PNG_AFTER_IHDR) return false;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) === "IHDR";
}

/**
 * Pull a capture date out of a PNG's eXIf chunk.
 *
 * iOS screenshots are PNGs and carry no date at all — but a PNG that has been
 * through something else may well have one, and reading it beats falling back
 * to a timestamp Safari rewrote on export.
 */
export function fromPng(buffer) {
  if (!isPng(buffer)) return null;
  const view = new DataView(buffer);
  let at = 8;
  while (at + 8 <= view.byteLength) {
    const length = view.getUint32(at);
    const type = ascii(view, at + 4, 4);
    if (type === "eXIf") return fromTiff(view, at + 8);
    if (type === "IDAT" || type === "IEND") break;   // metadata lives before the pixels
    at += 12 + length;
    if (length < 0 || at <= 0) break;                // malformed; stop rather than spin
  }
  return null;
}

// QuickTime/MP4 epoch: 1904-01-01 UTC.
const QT_EPOCH = Date.UTC(1904, 0, 1);

/**
 * Apple's `com.apple.quicktime.creationdate`, written as an ISO-8601 string in
 * the movie metadata.
 *
 * This is the one date on a clip worth having. iOS transcodes video on its way
 * into a file input — a clip picked out of the roll arrives as H.264 whatever
 * it started as — and the transcode rewrites `mvhd`'s creation time to the
 * moment of the export. This string is written by the camera and carried
 * through, so it still says when the thing was filmed.
 *
 * Scanned for rather than parsed to: the value lives in an `ilst` box indexed
 * by a number that refers into a separate `keys` box, and walking that to find
 * one string is a great deal of machinery for a date we can recognise on sight.
 *
 * The offset on the end is deliberately ignored. The wall clock in the string
 * is the local time where it was filmed, which is the calendar day we want.
 */
export function fromQuickTimeMeta(buffer) {
  const b = new Uint8Array(buffer);
  const digit = (at) => b[at] >= 0x30 && b[at] <= 0x39;

  for (let i = 0; i + 19 <= b.length; i++) {
    // YYYY-MM-DDTHH:MM:SS
    if (!digit(i) || !digit(i + 1) || !digit(i + 2) || !digit(i + 3)) continue;
    if (b[i + 4] !== 0x2d || !digit(i + 5) || !digit(i + 6)) continue;
    if (b[i + 7] !== 0x2d || !digit(i + 8) || !digit(i + 9)) continue;
    if (b[i + 10] !== 0x54) continue;                        // "T"
    if (!digit(i + 11) || !digit(i + 12) || b[i + 13] !== 0x3a) continue;
    if (!digit(i + 14) || !digit(i + 15) || b[i + 16] !== 0x3a) continue;
    if (!digit(i + 17) || !digit(i + 18)) continue;

    let text = "";
    for (let k = 0; k < 19; k++) text += String.fromCharCode(b[i + k]);
    const parsed = parseExifDate(text.replace(/-/g, ":").replace("T", " "));
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Pull the creation time out of an MP4/MOV `mvhd` box.
 *
 * We scan for the atom rather than walking the box tree, because iPhone .mov
 * files routinely put `moov` at the *end* of the file — so the caller hands us
 * a slice from either end and we find it wherever it happens to be.
 *
 * Apple writes local wall-clock time into this field as though it were UTC, so
 * we read the UTC components back out and rebuild them as local time. That
 * gets the right calendar day, which is all we need.
 *
 * Apple's own metadata is tried first, because `mvhd` is rewritten by the
 * transcode iOS performs on the way into a file input, and an `mvhd` that says
 * "a moment ago" is that rewrite rather than a clip filmed a moment ago. We
 * refuse it on the same grounds `fromLastModified` refuses Safari's export
 * stamp: a lie about today is worse than admitting we do not know, because
 * "we do not know" puts the clip in the Unsorted tray where she can place it.
 *
 * @param {ArrayBuffer} buffer
 * @param {number} now
 * @returns {Date|null}
 */
export function fromMp4(buffer, now = Date.now()) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const filmed = fromQuickTimeMeta(buffer);
  if (filmed) return filmed;

  for (let i = 0; i + 20 < bytes.length; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x76 ||
        bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue;  // "mvhd"

    const payload = i + 4;
    const version = view.getUint8(payload);
    let seconds;
    if (version === 1) {
      if (payload + 12 > view.byteLength) continue;
      // 64-bit; the high word is zero for any realistic date.
      seconds = view.getUint32(payload + 4, false) * 4294967296 +
                view.getUint32(payload + 8, false);
    } else if (version === 0) {
      if (payload + 8 > view.byteLength) continue;
      seconds = view.getUint32(payload + 4, false);
    } else {
      continue;
    }
    if (!seconds) continue;

    const asUtc = new Date(QT_EPOCH + seconds * 1000);
    const year = asUtc.getUTCFullYear();
    if (year < 2000 || year > 2200) continue;                     // junk guard

    const stamped = new Date(year, asUtc.getUTCMonth(), asUtc.getUTCDate(),
                             asUtc.getUTCHours(), asUtc.getUTCMinutes(), asUtc.getUTCSeconds());

    // Written within the last few minutes? That is the transcode, not the
    // filming. Better no date than today's.
    if (Math.abs(now - stamped.getTime()) < 10 * 60 * 1000) return null;
    return stamped;
  }
  return null;
}

/**
 * A lastModified value is only trustworthy if it is clearly *not* "just now".
 * Safari stamps the export time, so anything within the last few minutes is
 * almost certainly a lie. Older values are probably real and better than nothing.
 */
export function fromLastModified(ms, now = Date.now()) {
  if (!ms) return null;
  const age = now - ms;
  if (age < 10 * 60 * 1000) return null;      // stamped on export — ignore
  if (age > 20 * 365 * 24 * 3600 * 1000) return null;
  return new Date(ms);
}

// ---------------------------------------------------------------------------
// The writer.
//
// Reading capture dates is only half of it. A photo that arrives with no EXIF
// date — a screenshot, a saved image, anything iOS stripped — is invisible to
// every receiving app that sorts by "date taken", so it lands wherever that app
// feels like putting it. Writing one in means the order we send and the order a
// date-sorting app computes are the same list. See media.js `withCaptureDate`.
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, "0");
const TIFF_BYTES = 64;

/** Date -> "2026:08:21 14:03:57", the only shape EXIF understands. */
export function exifDateString(d) {
  return `${d.getFullYear()}:${pad2(d.getMonth() + 1)}:${pad2(d.getDate())} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * A complete APP1 segment carrying exactly one tag: DateTimeOriginal.
 *
 * Little-endian, and the layout is spelled out rather than computed because
 * every offset here is relative to the TIFF header and that is exactly the
 * kind of arithmetic worth being able to check by eye:
 *
 *    0  TIFF header ............ 8 bytes
 *    8  IFD0, one entry ....... 18 bytes  -> points at 26
 *   26  Exif SubIFD, one entry  18 bytes  -> points at 44
 *   44  "YYYY:MM:DD HH:MM:SS\0" 20 bytes
 *
 * @param {Date} when
 * @returns {Uint8Array} ready to splice in immediately after SOI
 */
export function exifTiff(when) {
  const SUB_IFD_AT = 26;
  const STRING_AT = 44;

  const out = new Uint8Array(TIFF_BYTES);
  const view = new DataView(out.buffer);
  const tiff = 0;
  out.set([0x49, 0x49], tiff);                    // little-endian
  view.setUint16(tiff + 2, 42, true);
  view.setUint32(tiff + 4, 8, true);              // IFD0 starts at 8

  view.setUint16(tiff + 8, 1, true);              // IFD0: one entry
  view.setUint16(tiff + 10, TAG_EXIF_IFD_POINTER, true);
  view.setUint16(tiff + 12, 4, true);             // LONG
  view.setUint32(tiff + 14, 1, true);
  view.setUint32(tiff + 18, SUB_IFD_AT, true);
  view.setUint32(tiff + 22, 0, true);             // no IFD1

  view.setUint16(tiff + SUB_IFD_AT, 1, true);     // SubIFD: one entry
  view.setUint16(tiff + SUB_IFD_AT + 2, TAG_DATETIME_ORIGINAL, true);
  view.setUint16(tiff + SUB_IFD_AT + 4, 2, true); // ASCII
  view.setUint32(tiff + SUB_IFD_AT + 6, 20, true);
  view.setUint32(tiff + SUB_IFD_AT + 10, STRING_AT, true);
  view.setUint32(tiff + SUB_IFD_AT + 14, 0, true);

  const text = exifDateString(when);
  for (let i = 0; i < text.length; i++) out[tiff + STRING_AT + i] = text.charCodeAt(i);
  return out;
}

/** The same block wrapped as a JPEG APP1 segment, to splice in after SOI. */
export function exifApp1(when) {
  const tiff = exifTiff(when);
  const out = new Uint8Array(10 + tiff.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0xffe1);                      // APP1
  view.setUint16(2, 8 + tiff.length);             // length, including itself
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);     // "Exif\0\0"
  out.set(tiff, 10);
  return out;
}

let crcTable = null;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The same block as a PNG eXIf chunk, to splice in after IHDR.
 *
 * This is the screenshot case. An iOS screenshot is a PNG with no date in it
 * anywhere, so it is the one file in a week that nothing downstream can place —
 * it was the single row reading "none" in the share order.
 */
export function exifPngChunk(when) {
  const tiff = exifTiff(when);
  const out = new Uint8Array(12 + tiff.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, tiff.length);
  out.set([0x65, 0x58, 0x49, 0x66], 4);           // "eXIf"
  out.set(tiff, 8);
  view.setUint32(8 + tiff.length, crc32(out.subarray(4, 8 + tiff.length)));
  return out;
}

/** Does this JPEG already say when it was taken? */
export function hasCaptureDate(buffer) {
  return fromJpeg(buffer) !== null;
}

/** Cheap magic-number check — a splice must never be attempted on a non-JPEG. */
export function isJpeg(buffer) {
  return buffer.byteLength >= 2 && new DataView(buffer).getUint16(0) === 0xffd8;
}
