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
      const tiff = i + 10;
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
    i += 2 + len;
  }
  return null;
}

// QuickTime/MP4 epoch: 1904-01-01 UTC.
const QT_EPOCH = Date.UTC(1904, 0, 1);

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
 * @param {ArrayBuffer} buffer
 * @returns {Date|null}
 */
export function fromMp4(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

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

    return new Date(year, asUtc.getUTCMonth(), asUtc.getUTCDate(),
                    asUtc.getUTCHours(), asUtc.getUTCMinutes(), asUtc.getUTCSeconds());
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
