// Re-encoding a week down to a common weight.
//
// Messages lands attachments in upload-completion order, which tracks the real
// encoded weight of the image — not the filename, not the capture date, not
// the timestamp, and not padding, all of which were measured and ruled out.
// What it does honour is a tie: files within a few hundred kilobytes of each
// other finish together and fall back to the order they were handed over in.
//
// The eleven-file probe has been demonstrating that the whole time. Its images
// are 0.28–0.51 MB — a spread of 0.23 MB — and it arrives 1 to 11 every time.
// A real week spans 85 KB to 28 MB and never does.
//
// So: make every photo a tie. Each one is decoded, drawn down to a common long
// edge, and re-encoded at whatever quality lands it near a common size. The
// week stops being a race and goes back to being a list — and a 64 MB message
// becomes about five.
//
// The cost is real and worth saying plainly: the family receives phone-sized
// photos rather than originals. On a screen they are the same picture. Cropped
// or printed, they are not.

import { exifApp1 } from "./exif.js";

/** Decode to an <img>, which is the path that honours EXIF orientation. */
function decode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("could not decode")); };
    img.src = url;
  });
}

const toBlob = (canvas, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/**
 * Find the highest quality that still lands at or under the target.
 *
 * Four probes rather than a loop to convergence: the difference between 480 KB
 * and 500 KB is nothing to the race, and every extra encode is another pass
 * over a couple of megapixels on a phone that is holding a whole week in
 * memory.
 */
async function encodeNear(canvas, targetBytes) {
  let low = 0.35;
  let high = 0.92;
  let best = null;

  for (let probe = 0; probe < 4; probe++) {
    const quality = (low + high) / 2;
    const blob = await toBlob(canvas, quality);
    if (!blob) break;

    if (blob.size <= targetBytes) {
      best = blob;                       // fits — try for better-looking
      low = quality;
    } else {
      high = quality;
      // Keep it only if we have nothing that fits yet, so a photo that cannot
      // reach the target still comes back as small as we managed.
      if (!best || blob.size < best.size) best = blob;
    }
  }
  return best || toBlob(canvas, low);
}

/**
 * One photo, re-encoded to roughly `targetBytes` at `longEdge`.
 *
 * `captureDate` is spliced back in because a canvas re-encode drops every
 * scrap of EXIF, and the date is the one piece of it the recipient's Photos
 * app needs to file the picture under the day it happened.
 *
 * @returns {Promise<File|null>} null if the browser could not decode it, in
 *   which case the caller keeps the original — a photo sent out of order beats
 *   a photo not sent.
 */
export async function shrink(file, { longEdge, targetBytes, captureDate = null }) {
  let decoded = null;
  try {
    decoded = await decode(file);
    const { img } = decoded;
    const source = Math.max(img.naturalWidth, img.naturalHeight);
    if (!source) return null;

    const scale = Math.min(1, longEdge / source);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await encodeNear(canvas, targetBytes);
    if (!blob) return null;

    // Give the canvas back before the next photo — iOS is far less forgiving
    // about a row of live canvases than about one at a time.
    canvas.width = 1;
    canvas.height = 1;

    const parts = captureDate
      ? [blob.slice(0, 2), exifApp1(captureDate), blob.slice(2)]
      : [blob];
    return new File(parts, file.name, {
      type: "image/jpeg",
      lastModified: captureDate ? captureDate.getTime() : file.lastModified,
    });
  } catch {
    return null;
  } finally {
    if (decoded) decoded.release();
  }
}

/**
 * Shrink a batch, one at a time.
 *
 * Sequential for the same reason intake is: parallel decodes of twelve-megapixel
 * photos is how a phone runs out of memory mid-week.
 *
 * Sets `item.share` on anything it manages. Everything else keeps its original,
 * which still sends — just not necessarily in the right place.
 */
export async function shrinkAll(items, opts, onProgress) {
  const todo = items.filter((i) => i.kind !== "video" && !i.share);
  let done = 0;

  for (const item of todo) {
    if (onProgress) onProgress(++done, todo.length);
    const shrunk = await shrink(item.file, { ...opts, captureDate: item.takenAt });
    if (shrunk && shrunk.size < item.file.size) item.share = shrunk;
    // Yield, so the progress line actually paints between photos.
    await new Promise((r) => setTimeout(r, 0));
  }
  return todo.length;
}
