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

const CEILING_QUALITY = 0.97;

/** The best-looking encode that still fits under the ceiling. */
async function search(canvas, targetBytes, probes) {
  let low = 0.35;
  let high = 0.94;
  let best = null;

  for (let probe = 0; probe < probes; probe++) {
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
  return best;
}

/**
 * Land inside the band, aiming for the top of it.
 *
 * A ceiling alone is not enough. The photo that stayed out of order was a
 * cropped screenshot — 1206×493, low on detail — which encodes to 87 KB while
 * the rest of the week sits at 200. It was under the target the whole time and
 * nothing was pulling it up, so it kept winning the race.
 */
async function encodeInBand(canvas, targetBytes, floorBytes) {
  let best = await search(canvas, targetBytes, 4);
  if (!best || best.size >= floorBytes) return best;

  // Spend quality on it first — this is the one case where a bigger file is
  // the point.
  const ceiling = await toBlob(canvas, CEILING_QUALITY);
  if (ceiling && ceiling.size <= targetBytes && ceiling.size > best.size) best = ceiling;
  if (best.size >= floorBytes) return best;

  // Still too light, which means the picture has no detail to spend quality
  // on: a screenshot, a flat crop, anything mostly one colour. JPEG encodes
  // those cheaply however you ask, so the only way to add weight is to add
  // detail. Each pass adds grain and then re-searches quality, so the result
  // climbs toward the floor without sailing past the ceiling.
  for (const amplitude of [4, 10, 24]) {
    grain(canvas, amplitude);
    const grainy = await search(canvas, targetBytes, 3);
    if (grainy && grainy.size > best.size) best = grainy;
    if (best.size >= floorBytes) break;

    // The search will not reach past 0.94; on the last pass, try the ceiling.
    const top = await toBlob(canvas, CEILING_QUALITY);
    if (top && top.size <= targetBytes && top.size > best.size) best = top;
    if (best.size >= floorBytes) break;
  }
  return best;
}

/**
 * Dither the canvas in place.
 *
 * High-frequency content is the one thing JPEG cannot compress away, so this is
 * the only lever that reliably moves the weight of a picture with nothing in
 * it. A few levels are invisible at arm's length. Applied only to photos that
 * came out too light to tie with their week.
 */
function grain(canvas, amplitude) {
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const shift = (Math.random() - 0.5) * amplitude;
    px[i] += shift;
    px[i + 1] += shift;
    px[i + 2] += shift;
  }
  ctx.putImageData(image, 0, 0);
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
export async function shrink(
  file,
  { pixels, targetBytes, floorBytes = targetBytes * 0.6, maxUpscale = 2, captureDate = null },
) {
  let decoded = null;
  try {
    decoded = await decode(file);
    const { img } = decoded;
    const area = img.naturalWidth * img.naturalHeight;
    if (!area) return null;

    // A pixel budget rather than a long edge, because a long edge says nothing
    // about a crop. 1206×493 is well inside a 1280 cap and is a third of the
    // pixels of a photo that fills it — which is exactly how it ended up a
    // third of the weight, and out of order.
    const scale = Math.min(maxUpscale, Math.sqrt(pixels / area));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await encodeInBand(canvas, targetBytes, floorBytes);
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
    // Taken even when it comes out heavier than the original: a photo too light
    // to tie with the rest of the week is the whole problem being solved here.
    if (shrunk) item.share = shrunk;
    // Yield, so the progress line actually paints between photos.
    await new Promise((r) => setTimeout(r, 0));
  }
  return todo.length;
}
