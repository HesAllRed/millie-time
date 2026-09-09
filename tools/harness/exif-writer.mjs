// Splices EXIF and an identity marker into a JPEG, for fixtures.
//
// The EXIF bytes come from the app's own writer rather than a second
// implementation — a harness that agrees with itself but not with the app is
// worse than no harness.

import { exifApp1 } from "../../public/js/exif.js";

export const MARKER = "MILLIE:";

/** Put the capture date immediately after SOI, where a camera would. */
export function withExifDate(jpegBytes, when) {
  return spliceAfterSoi(jpegBytes, Buffer.from(exifApp1(when)));
}

/**
 * Stamp an identity into the bytes with a JPEG COM segment.
 *
 * The share renames every file to its position, so once a payload comes back
 * there is nothing left to say which photo it was. This marker survives the
 * rename — it is how the harness proves photo 3 really is the one taken on
 * Tuesday, rather than just counting files.
 */
export function withComment(jpegBytes, label) {
  const payload = Buffer.from(`${MARKER}${label}\0`, "ascii");
  const seg = Buffer.alloc(4 + payload.length);
  seg.writeUInt16BE(0xfffe, 0);                 // COM
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return spliceAfterSoi(jpegBytes, seg);
}

function spliceAfterSoi(jpegBytes, segment) {
  const jpeg = Buffer.from(jpegBytes);
  if (jpeg.readUInt16BE(0) !== 0xffd8) throw new Error("not a JPEG — no SOI");
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}
