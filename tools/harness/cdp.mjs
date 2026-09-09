// A ~150-line Chrome DevTools Protocol client, so the end-to-end harness can
// drive a real browser without the project growing a dependency. Node 22 ships
// a global WebSocket, which is the only thing that made this worth doing.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

async function chromeBinary() {
  const { access } = await import("node:fs/promises");
  for (const candidate of CHROME_CANDIDATES) {
    try { await access(candidate); return candidate; } catch { /* next */ }
  }
  throw new Error(`No Chromium found. Tried:\n  ${CHROME_CANDIDATES.join("\n  ")}`);
}

/** So the end-to-end tests can skip politely on a machine with no browser. */
export async function hasBrowser() {
  try { await chromeBinary(); return true; } catch { return false; }
}

class Connection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (ev) => this.#onMessage(JSON.parse(ev.data)));
  }

  #onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.method || ""})`));
      else resolve(msg.result);
      return;
    }
    const listeners = this.handlers.get(msg.method);
    if (listeners) for (const fn of listeners) fn(msg.params, msg.sessionId);
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(fn);
    return () => this.handlers.get(method).delete(fn);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

/** One page, with just the verbs this harness needs. */
class Page {
  constructor(conn, sessionId) {
    this.conn = conn;
    this.sessionId = sessionId;
    this.consoleLines = [];
  }

  send(method, params) { return this.conn.send(method, params, this.sessionId); }

  async ready() {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("DOM.enable");
    this.conn.on("Runtime.consoleAPICalled", (p, sid) => {
      if (sid !== this.sessionId) return;
      const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
      this.consoleLines.push(`[${p.type}] ${text}`);
    });
    this.conn.on("Runtime.exceptionThrown", (p, sid) => {
      if (sid !== this.sessionId) return;
      const d = p.exceptionDetails;
      this.consoleLines.push(`[pageerror] ${d.exception?.description || d.text}`);
    });
  }

  /** Runs before any of the app's own script, which is the only place a share stub can go. */
  onNewDocument(source) {
    return this.send("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'");
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }
    return result.value;
  }

  async waitFor(expression, { timeout = 10000, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await this.eval(`return !!(await (${expression}));`)) return true;
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  /**
   * Hand a file input real files from disk. This is the whole reason the
   * harness drives a browser at all: it is the closest thing to her tapping
   * photos in the iOS picker that exists off-device.
   */
  async setFiles(selector, paths) {
    const { result } = await this.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
    });
    if (!result.objectId) throw new Error(`no element matched ${selector}`);
    await this.send("DOM.setFileInputFiles", { files: paths, objectId: result.objectId });
  }

  async screenshot(file) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, Buffer.from(data, "base64"));
    return file;
  }
}

export async function launch({ headless = true } = {}) {
  const bin = await chromeBinary();
  const profile = await mkdtemp(path.join(tmpdir(), "millie-cdp-"));
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=390,844",          // an iPhone-ish viewport, so layout is honest
    "about:blank",
  ];
  if (headless) args.unshift("--headless=new");

  const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error(`Chromium never printed a DevTools URL:\n${buffered}`)), 20000);
    proc.stderr.on("data", (chunk) => {
      buffered += chunk;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffered);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Chromium exited early (${code})\n${buffered}`)); });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("could not connect to Chromium")), { once: true });
  });
  const conn = new Connection(ws);

  return {
    conn,
    async newPage() {
      const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
      const page = new Page(conn, sessionId);
      await page.ready();
      return page;
    },
    async close() {
      try { ws.close(); } catch { /* already gone */ }
      proc.kill();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
