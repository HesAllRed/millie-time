// The share ladder. Each rung is a strictly more conservative payload shape
// than the one above it. See PLAN.md §1.1b.
//
//   1  { files:[print, ...photos], text }   one tap, plus selectable text
//   2  { files:[print, ...photos] }         one tap; the print carries the words
//   3  { text } then { files }              two taps, both shapes bulletproof
//   4  clipboard + camera roll              nothing was lost
//
// Everything here must run inside the tap. Anything async beforehand (rendering
// the print, reading files) burns the user-activation window and iOS refuses.

const isAbort = (e) => e && (e.name === "AbortError" || /abort|cancel/i.test(e.message || ""));

/** Always attempted first, on every share, unconditionally. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function canShareFiles(files) {
  return !!(navigator.canShare && navigator.canShare({ files }));
}

/**
 * Rungs 1 and 2 — both a single tap.
 * @returns {{outcome:"sent"|"cancelled"|"stepper"|"noshare", rung?:number, error?:Error}}
 */
export async function runShareLadder({ files, text }) {
  const rungs = [];
  if (navigator.canShare?.({ files, text })) rungs.push({ n: 1, payload: { files, text } });
  if (navigator.canShare?.({ files }))       rungs.push({ n: 2, payload: { files } });

  if (!rungs.length) {
    return { outcome: navigator.share ? "stepper" : "noshare" };
  }

  let lastError = null;
  for (const rung of rungs) {
    try {
      await navigator.share(rung.payload);
      return { outcome: "sent", rung: rung.n };
    } catch (e) {
      if (isAbort(e)) return { outcome: "cancelled" };
      lastError = e;
      // A rejected share may have consumed the activation, in which case the
      // next rung fails too and we land on the stepper — which needs a fresh
      // tap anyway, so nothing is lost.
    }
  }
  return { outcome: "stepper", error: lastError };
}

/** Rung 3, step one. Text on its own — Web Share Level 1, solid since iOS 12.2. */
export async function shareWords(text) {
  if (!navigator.share) return { outcome: "noshare" };
  try {
    await navigator.share({ text });
    return { outcome: "sent" };
  } catch (e) {
    return isAbort(e) ? { outcome: "cancelled" } : { outcome: "failed", error: e };
  }
}

/** Rung 3, step two. Files with no text — the other shape iOS handles predictably. */
export async function sharePhotos(files) {
  if (!canShareFiles(files)) return { outcome: "noshare" };
  try {
    await navigator.share({ files });
    return { outcome: "sent" };
  } catch (e) {
    return isAbort(e) ? { outcome: "cancelled" } : { outcome: "failed", error: e };
  }
}
