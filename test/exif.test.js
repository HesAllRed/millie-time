import { test } from "node:test";
import assert from "node:assert/strict";
import { fromJpeg, fromMp4, parseExifDate, fromLastModified } from "../public/js/exif.js";

/**
 * Build the smallest JPEG that carries a real EXIF DateTimeOriginal.
 * Layout (offsets relative to the TIFF header):
 *    0  byte order + magic + IFD0 pointer
 *    8  IFD0: one entry, the Exif IFD pointer
 *   26  Exif IFD: one entry, DateTimeOriginal
 *   44  the ASCII date itself
 */
function jpegWithDate(str, { littleEndian = true } = {}) {
  const tiff = new Uint8Array(64);
  const view = new DataView(tiff.buffer);
  const le = littleEndian;

  if (le) { tiff[0] = 0x49; tiff[1] = 0x49; } else { tiff[0] = 0x4d; tiff[1] = 0x4d; }
  view.setUint16(2, 42, le);
  view.setUint32(4, 8, le);

  view.setUint16(8, 1, le);                 // IFD0 entry count
  view.setUint16(10, 0x8769, le);           // ExifIFDPointer
  view.setUint16(12, 4, le);                // LONG
  view.setUint32(14, 1, le);
  view.setUint32(18, 26, le);               // -> Exif IFD
  view.setUint32(22, 0, le);                // no IFD1

  view.setUint16(26, 1, le);                // Exif IFD entry count
  view.setUint16(28, 0x9003, le);           // DateTimeOriginal
  view.setUint16(30, 2, le);                // ASCII
  view.setUint32(32, 20, le);
  view.setUint32(36, 44, le);               // -> the string
  view.setUint32(40, 0, le);

  for (let i = 0; i < 19; i++) tiff[44 + i] = str.charCodeAt(i);
  tiff[63] = 0;

  const app1Len = 2 + 6 + tiff.length;
  const out = new Uint8Array(2 + 2 + app1Len + 2);
  let p = 0;
  out[p++] = 0xff; out[p++] = 0xd8;                      // SOI
  out[p++] = 0xff; out[p++] = 0xe1;                      // APP1
  out[p++] = (app1Len >> 8) & 0xff; out[p++] = app1Len & 0xff;
  for (const c of "Exif") out[p++] = c.charCodeAt(0);
  out[p++] = 0; out[p++] = 0;
  out.set(tiff, p); p += tiff.length;
  out[p++] = 0xff; out[p++] = 0xd9;                      // EOI
  return out.buffer;
}

test("parseExifDate reads the EXIF datetime format", () => {
  const d = parseExifDate("2026:08:21 14:03:57");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 21);
  assert.equal(d.getHours(), 14);
});

test("parseExifDate rejects junk and blank camera defaults", () => {
  assert.equal(parseExifDate(""), null);
  assert.equal(parseExifDate("    :  :     :  :  "), null);
  assert.equal(parseExifDate("not a date"), null);
  assert.equal(parseExifDate("0000:00:00 00:00:00"), null);
});

test("fromJpeg pulls DateTimeOriginal out of a little-endian JPEG", () => {
  const d = fromJpeg(jpegWithDate("2026:08:19 07:41:02"));
  assert.ok(d, "expected a date");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 19);
});

test("fromJpeg handles big-endian (Motorola) byte order", () => {
  const d = fromJpeg(jpegWithDate("2026:01:03 22:10:00", { littleEndian: false }));
  assert.ok(d);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 3);
});

test("fromJpeg returns null rather than guessing", () => {
  assert.equal(fromJpeg(new Uint8Array([1, 2, 3, 4]).buffer), null);
  assert.equal(fromJpeg(new Uint8Array(0).buffer), null);
  // A valid JPEG with no EXIF block at all.
  assert.equal(fromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer), null);
});

test("fromMp4 finds mvhd wherever it sits and rebuilds local wall time", () => {
  // seconds since 1904-01-01 for 2026-08-19 07:41:02
  const seconds = Math.floor((Date.UTC(2026, 7, 19, 7, 41, 2) - Date.UTC(1904, 0, 1)) / 1000);
  const buf = new Uint8Array(64);
  const view = new DataView(buf.buffer);
  const at = 20;                                  // deliberately not at offset 0
  buf[at] = 0x6d; buf[at + 1] = 0x76; buf[at + 2] = 0x68; buf[at + 3] = 0x64;
  view.setUint8(at + 4, 0);                       // version 0
  view.setUint32(at + 8, seconds, false);         // big-endian, as the spec says

  const d = fromMp4(buf.buffer);
  assert.ok(d, "expected a date");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 19);
  assert.equal(d.getHours(), 7);
});

test("fromMp4 rejects zeroed and out-of-range creation times", () => {
  const buf = new Uint8Array(64);
  const view = new DataView(buf.buffer);
  buf[8] = 0x6d; buf[9] = 0x76; buf[10] = 0x68; buf[11] = 0x64;
  view.setUint32(16, 0, false);
  assert.equal(fromMp4(buf.buffer), null);

  view.setUint32(16, 100, false);                 // 1904 — junk
  assert.equal(fromMp4(buf.buffer), null);
});

test("fromLastModified distrusts a just-now timestamp", () => {
  const now = Date.now();
  // Safari stamps the export time, so a fresh value is almost certainly a lie.
  assert.equal(fromLastModified(now - 1000, now), null);
  assert.equal(fromLastModified(now - 60_000, now), null);
  assert.equal(fromLastModified(0, now), null);

  const old = now - 3 * 24 * 3600 * 1000;
  assert.equal(fromLastModified(old, now).getTime(), old);
});
