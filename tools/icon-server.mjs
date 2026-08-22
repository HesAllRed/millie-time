// Serves tools/icon-maker.html and lets it POST the rendered PNGs straight into
// public/icons/. Browsers can't write to disk on their own, so this is the
// shortest path from "canvas" to "committed file".
//
//   node tools/icon-server.mjs
//   open http://localhost:8787   (it saves automatically)

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const iconDir = path.join(root, "public", "icons");

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url.startsWith("/save/")) {
      const name = path.basename(decodeURIComponent(req.url.slice(6)));
      if (!/^[a-z0-9._-]+\.png$/i.test(name)) {
        res.writeHead(400); res.end("bad name"); return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      await mkdir(iconDir, { recursive: true });
      await writeFile(path.join(iconDir, name), buf);
      console.log(`wrote ${name}  ${buf.length} bytes`);
      res.writeHead(200); res.end("ok");
      return;
    }

    if (req.url === "/" || req.url.startsWith("/index.html")) {
      const html = await readFile(path.join(root, "tools", "icon-maker.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    res.writeHead(404); res.end("not found");
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end(String(e));
  }
});

server.listen(8787, () => console.log("icon server → http://localhost:8787"));
