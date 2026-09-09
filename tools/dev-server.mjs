// Static server for local testing:  node tools/dev-server.mjs
//
// The iOS keyboard and the real share sheet still need a deploy and a phone
// (PLAN.md §6), but the picker, EXIF and the exact order of the share payload
// are all reachable from here — test/e2e drives this same server headlessly.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** Start the server and resolve with { url, close }. Port 0 picks a free one. */
export function serve(port = 0) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }

    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    } catch {
      file = path.join(root, "index.html");        // SPA fallback
    }

    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

// Run directly, and it behaves exactly as it always did.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  serve(Number(process.env.PORT || 5173)).then(({ url }) => console.log(`Millie Time → ${url}`));
}
