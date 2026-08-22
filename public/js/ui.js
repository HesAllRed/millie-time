// Small DOM helpers plus the crescent geometry, shared by the sort and deck views.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/**
 * Tile size and how many fit on the arc.
 *
 * A Saturday with nine photos cannot use a Tuesday's arc, so the shape degrades
 * on purpose: tiles shrink, overlap deepens, and past five we cap and show a
 * chip that opens the full grid.
 */
export function crescentGeometry(count, compact = false) {
  const scale = compact ? 0.62 : 1;
  const pick =
    count <= 1 ? { w: 168, h: 210, gap: 0,   max: 1 } :
    count <= 3 ? { w: 100, h: 126, gap: -9,  max: count } :
    count <= 5 ? { w: 80,  h: 100, gap: -14, max: count } :
                 { w: 74,  h: 92,  gap: -15, max: 5 };
  return {
    w: Math.round(pick.w * scale),
    h: Math.round(pick.h * scale),
    gap: Math.round(pick.gap * scale),
    max: pick.max,
  };
}

/** Rotation and drop for tile i of m, tracing a shallow arc. */
export function tilt(i, m, compact = false) {
  if (m <= 1) return { rot: -3, ty: 0 };
  const t = (i / (m - 1)) * 2 - 1;           // -1 .. 1
  const lift = compact ? 12 : 22;
  return { rot: t * 12, ty: Math.abs(t) * lift };
}

// NB: the size options are `width`/`height`, not `w`/`h` — destructuring `h`
// here would shadow the element helper above and break every tile.
export function tile(item, { width, height, onTap, selected } = {}) {
  const el = h("button", {
    type: "button",
    class: `ph${item.kind === "video" ? " vid" : ""}${selected ? " sel" : ""}`,
    "data-id": item.id,
    "aria-label": item.kind === "video" ? "Video" : "Photo",
  });
  if (width) { el.style.width = `${width}px`; el.style.height = `${height}px`; }
  if (item.url) el.style.backgroundImage = `url("${item.url}")`;
  if (onTap) el.addEventListener("click", (e) => onTap(item, el, e));
  return el;
}

export function crescent(items, { compact = false, onTapTile, onTapMore } = {}) {
  const geo = crescentGeometry(items.length, compact);
  const shown = items.slice(0, geo.max);
  const rest = items.length - shown.length;

  const wrap = h("div", { class: `cres${compact ? " compact" : ""}` });
  shown.forEach((item, i) => {
    const el = tile(item, { width: geo.w, height: geo.h, onTap: onTapTile });
    const { rot, ty } = tilt(i, shown.length, compact);
    el.style.transform = `rotate(${rot.toFixed(1)}deg) translateY(${ty.toFixed(0)}px)`;
    el.style.margin = `0 ${geo.gap}px`;
    el.style.zIndex = String(10 - Math.abs(i - (shown.length - 1) / 2) | 0);
    wrap.append(el);
  });

  if (rest > 0) {
    wrap.append(h("button", {
      type: "button", class: "more", text: `+${rest}`,
      onclick: () => onTapMore && onTapMore(),
    }));
  }
  return wrap;
}
