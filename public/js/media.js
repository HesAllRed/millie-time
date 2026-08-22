// File intake, capture dates, video posters, and the one-video-at-a-time rule.

import { fromJpeg, fromMp4, fromLastModified } from "./exif.js";
import { isoDay } from "./dates.js";

const HEAD_BYTES  = 256 * 1024;        // plenty for a JPEG's EXIF block
const MP4_HEAD    = 1024 * 1024;
const MP4_TAIL    = 4 * 1024 * 1024;   // iPhone .mov puts moov at the end

let seq = 0;

/**
 * Grab a still frame from a video and hand back a blob URL for it.
 *
 * We do this once, at intake, and then throw the <video> away — so the crescent
 * is made of <img> tiles. Keeping a live <video> per clip is what tips iOS over
 * its decoder budget, and multiple video elements have crashed WebKit as
 * recently as iOS 18.
 *
 * iOS also paints nothing until a frame has been decoded, hence the seek: a
 * video parked at 0 is a black rectangle.
 */
function capturePoster(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;

    let settled = false;
    const finish = (poster) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      try { v.load(); } catch {}
      URL.revokeObjectURL(url);
      resolve(poster);
    };
    const timer = setTimeout(() => finish(null), 8000);

    v.addEventListener("loadeddata", () => {
      try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { finish(null); }
    });

    v.addEventListener("seeked", () => {
      try {
        const ratio = v.videoWidth ? v.videoHeight / v.videoWidth : 1.25;
        const w = 360;
        const h = Math.max(1, Math.round(w * ratio));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(v, 0, 0, w, h);
        c.toBlob((b) => finish(b ? URL.createObjectURL(b) : null), "image/jpeg", 0.82);
      } catch {
        finish(null);
      }
    });

    v.addEventListener("error", () => finish(null));
  });
}

/**
 * Read a picked FileList into items, one at a time.
 *
 * Sequential on purpose: parallel poster capture means parallel decoders, which
 * is the thing we are specifically avoiding.
 */
export async function ingest(fileList, onProgress) {
  const files = Array.from(fileList);
  const out = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (onProgress) onProgress(i + 1, files.length);

    const kind = (file.type || "").startsWith("video") ? "video" : "photo";
    let takenAt = null;
    let url = null;
    let poster = null;

    try {
      if (kind === "photo") {
        url = URL.createObjectURL(file);
        takenAt = fromJpeg(await file.slice(0, HEAD_BYTES).arrayBuffer());
      } else {
        takenAt = fromMp4(await file.slice(0, MP4_HEAD).arrayBuffer());
        if (!takenAt && file.size > MP4_HEAD) {
          takenAt = fromMp4(await file.slice(Math.max(0, file.size - MP4_TAIL)).arrayBuffer());
        }
        poster = await capturePoster(file);
        url = poster;
      }
    } catch {
      // A file we can't read still deserves to be in the week — it just lands
      // in Unsorted and she places it herself.
    }

    if (!takenAt) takenAt = fromLastModified(file.lastModified);

    out.push({
      id: `i${Date.now().toString(36)}${(seq++).toString(36)}`,
      file, kind, url, poster, takenAt,
      day: null,
    });
  }
  return out;
}

/** Drop each item onto a day, or leave it null for the Unsorted tray. */
export function assignDays(items, windowSet) {
  for (const item of items) {
    if (item.day && windowSet.has(item.day)) continue;   // she placed it by hand
    const iso = item.takenAt ? isoDay(item.takenAt) : null;
    item.day = iso && windowSet.has(iso) ? iso : null;
  }
}

/**
 * Give a file a zero-padded, ordered name: 01.jpg, 02.jpg, …
 *
 * Some share targets — Mail, Files, anything that treats the payload as a set
 * of documents — sort attachments by filename. Those get the right order for
 * free. iMessage sorts by nothing we can reach, so this doesn't help there;
 * it costs one Blob reference per file and can only improve matters.
 *
 * Set `renumberOnShare: false` in config.js if this ever looks like it's
 * costing memory on a heavy week.
 */
export function renameForOrder(file, position) {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot) : "";
  const name = `${String(position).padStart(2, "0")}${ext}`;
  if (file.name === name) return file;
  try {
    return new File([file], name, { type: file.type, lastModified: file.lastModified });
  } catch {
    return file;                       // never let a rename cost us the share
  }
}

// ---------------------------------------------------------------------------
// Playback. Exactly one <video> exists at any moment, ever.
// ---------------------------------------------------------------------------

let live = null;   // { id, el, url, host }

export function stopVideo() {
  if (!live) return;
  try { live.el.pause(); } catch {}
  live.el.removeAttribute("src");
  try { live.el.load(); } catch {}
  live.el.remove();
  URL.revokeObjectURL(live.url);
  live = null;
}

export function playingId() {
  return live ? live.id : null;
}

/**
 * Play `item` inside `host`, stopping whatever was playing before.
 * Returns true if it started, false if this was a toggle-off.
 */
export function playVideo(item, host) {
  const wasPlaying = live && live.id === item.id;
  stopVideo();
  if (wasPlaying) return false;

  const url = URL.createObjectURL(item.file);
  const el = document.createElement("video");
  el.className = "tile-video";
  el.muted = true;
  el.playsInline = true;          // without this iOS yanks it fullscreen
  el.setAttribute("playsinline", "");
  el.loop = true;
  el.autoplay = true;
  el.src = url;

  host.appendChild(el);
  live = { id: item.id, el, url, host };
  el.play().catch(() => { /* a refused play just leaves the poster showing */ });
  return true;
}
