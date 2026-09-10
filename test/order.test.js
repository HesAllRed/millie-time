// End-to-end share ordering, in a real browser.
//
// The unit tests cover the sort; these cover the thing that actually goes
// wrong, which is everything in between — the picker, EXIF read off real
// bytes, the deck, and the exact array handed to navigator.share(). It drives
// Chromium over the DevTools protocol (tools/harness), so it needs no
// dependencies, and skips itself where there is no browser to drive.
//
// What it cannot cover is what Messages does with the payload afterwards.
// That is on the far side of the OS and only the order probe on #debug can
// answer it — see public/js/probe.js.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { rm } from "node:fs/promises";
import { hasBrowser } from "../tools/harness/cdp.mjs";
import { openApp } from "../tools/harness/app.mjs";
import { makeFixtures } from "../tools/harness/fixtures.mjs";

const DAY = 86400000;
const dir = path.join(os.tmpdir(), "millie-order-fixtures");

/** An ISO day `back` days ago, and a Date at a given time on it. */
const isoBack = (back) => {
  const d = new Date(Date.now() - back * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const at = (back, hour, minute = 0) => {
  const d = new Date(Date.now() - back * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const runnable = await hasBrowser();
const options = { skip: runnable ? false : "no Chromium to drive" };

after(() => rm(dir, { recursive: true, force: true }));

/** iOS refuses { files, text } together, so the ladder lands on rung 2. */
const IOS_ISH = { filesWithText: false, files: true, text: true };

async function withApp(body) {
  const app = await openApp({ caps: IOS_ISH });
  try {
    return await body(app);
  } finally {
    await app.close();
  }
}

/** The photos in the payload, in order, each named by the fixture it came from. */
const shotOrder = (files) => files.filter((f) => f.from).map((f) => f.from);

test("the week sends oldest first, day by day, whatever order she picked in", options, async () => {
  await withApp(async (app) => {
    const specs = await makeFixtures(app.page, dir, [
      // Picked the way anyone picks: scrolling the roll and tapping about.
      { label: "wed-noon", takenAt: at(1, 12, 5) },
      { label: "mon-am",   takenAt: at(3, 9, 0) },
      { label: "wed-am",   takenAt: at(1, 12, 0) },
      { label: "tue-clip", takenAt: at(2, 19, 0), kind: "video" },
      { label: "tue-am",   takenAt: at(2, 8, 15) },
      { label: "mon-pm",   takenAt: at(3, 17, 30) },
    ]);

    await app.pick(specs.map((s) => s.file));
    await app.write({ [isoBack(3)]: "monday", [isoBack(1)]: "wednesday" });
    await app.toDeck();
    await app.share();

    const [sent] = await app.payloads();
    assert.ok(sent, "the ladder got as far as an actual share");
    assert.deepEqual(shotOrder(sent.files),
      ["mon-am", "mon-pm", "tue-am", "tue-clip", "wed-am", "wed-noon"]);
    assert.match(sent.files[0].name, /^00-/, "and the print leads, so it reads first");
  });
});

test("a photo with no capture date sends at the END of the day she put it on", options, async () => {
  await withApp(async (app) => {
    const specs = await makeFixtures(app.page, dir, [
      { label: "morning",    takenAt: at(2, 9, 0) },
      { label: "screenshot", takenAt: at(2, 15, 0), exif: false },
      { label: "evening",    takenAt: at(2, 20, 0) },
    ]);

    await app.pick(specs.map((s) => s.file));
    const items = await app.items();
    assert.equal(items.find((i) => i.name.includes("screenshot")).day, null,
      "it has no date, so it waits in the Unsorted tray");

    // She finds it there and puts it on the right day herself.
    await app.assign("pick2-screenshot.jpg", isoBack(2));
    const placed = await app.items();
    assert.equal(placed.find((i) => i.name.includes("screenshot")).day, isoBack(2),
      "and it really is on that day now — otherwise this test proves nothing");
    await app.write({ [isoBack(2)]: "a day out" });
    await app.toDeck();
    await app.share();

    const [sent] = await app.payloads();
    assert.deepEqual(shotOrder(sent.files), ["morning", "evening", "screenshot"],
      "undated has no claim to a position, so it takes the one that displaces nothing");
  });
});

test("filename, file date and capture date all agree with the order we send", options, async () => {
  await withApp(async (app) => {
    const specs = await makeFixtures(app.page, dir, [
      { label: "mon-am",   takenAt: at(3, 9, 0) },
      { label: "mon-shot", takenAt: at(3, 15, 0), exif: false },
      { label: "mon-pm",   takenAt: at(3, 19, 0) },
      { label: "tue-am",   takenAt: at(2, 8, 0) },
      { label: "tue-shot", takenAt: at(2, 10, 0), exif: false },
      { label: "wed",      takenAt: at(1, 11, 0) },
    ]);

    await app.pick(specs.map((s) => s.file));
    await app.assign("pick2-mon-shot.jpg", isoBack(3));
    await app.assign("pick5-tue-shot.jpg", isoBack(2));
    await app.write({ [isoBack(3)]: "monday" });
    await app.toDeck();
    await app.share();

    const [sent] = await app.payloads();
    const photos = sent.files.filter((f) => f.from);
    assert.equal(photos.length, 6);

    const names = photos.map((f) => f.name);
    assert.deepEqual([...names].sort(), names, "sorted by filename is the same list");

    for (let i = 1; i < photos.length; i++) {
      assert.ok(photos[i].lastModified > photos[i - 1].lastModified,
        `file dates must ascend, but #${i} does not`);
      assert.ok(photos[i].taken !== null && photos[i - 1].taken !== null,
        `every photo must carry a capture date, but #${i} does not`);
      assert.ok(photos[i].taken > photos[i - 1].taken,
        `capture dates must ascend, but #${i} does not`);
    }
  });
});

test("a real capture date is never overwritten", options, async () => {
  await withApp(async (app) => {
    const takenAt = at(2, 14, 30);
    const specs = await makeFixtures(app.page, dir, [{ label: "only", takenAt }]);

    await app.pick(specs.map((s) => s.file));
    await app.toDeck();
    await app.share();

    const [sent] = await app.payloads();
    const photo = sent.files.find((f) => f.from === "only");
    assert.equal(photo.taken, takenAt.getTime(),
      "it is the truth, the recipient's Photos app files by it, and it already agrees with us");
  });
});

test("the order probe sends six photos whose rules deliberately disagree", options, async () => {
  await withApp(async (app) => {
    await app.page.goto(`${app.url}/#debug`);
    await app.page.waitFor(`(async () => {
      const btns = [...document.querySelectorAll("button")];
      return btns.some((b) => b.textContent.includes("Send the order test") && !b.disabled);
    })()`, { timeout: 20000, label: "the probe to be built" });

    await app.page.eval(`
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Send the order test")).click();
    `);
    await app.page.waitFor("window.__shares.length > 0", { label: "the probe to be shared" });

    const [sent] = await app.payloads();
    assert.equal(sent.files.length, 6);

    // Position in the array is the order we intend; the other three signals are
    // each a different permutation, which is what makes one send conclusive.
    const byName = [...sent.files].sort((a, b) => a.name.localeCompare(b.name));
    const byTaken = [...sent.files].sort((a, b) => a.taken - b.taken);
    const byStamp = [...sent.files].sort((a, b) => a.lastModified - b.lastModified);
    const positions = (list) => list.map((f) => sent.files.indexOf(f) + 1);

    assert.deepEqual(positions(byName), [6, 5, 4, 3, 2, 1], "filename order");
    assert.deepEqual(positions(byTaken), [4, 5, 6, 1, 2, 3], "capture-date order");
    assert.deepEqual(positions(byStamp), [2, 1, 4, 3, 6, 5], "file-timestamp order");
  });
});

test("a screenshot in the week goes out carrying a date like everything else", options, async () => {
  await withApp(async (app) => {
    const specs = await makeFixtures(app.page, dir, [
      { label: "camera-am",  takenAt: at(2, 9, 0) },
      { label: "screenshot", takenAt: at(2, 15, 0), kind: "screenshot" },
      { label: "camera-pm",  takenAt: at(2, 20, 0) },
      { label: "next-day",   takenAt: at(1, 10, 0) },
    ]);

    await app.pick(specs.map((s) => s.file));
    const items = await app.items();
    const shot = items.find((i) => i.name.includes("screenshot"));
    assert.equal(shot.container, "png", "recognised by its bytes, not its name");
    assert.equal(shot.day, null, "an iOS screenshot says nothing about when it was taken");

    await app.assign("pick2-screenshot.png", isoBack(2));
    await app.toDeck();
    await app.share();

    const [sent] = await app.payloads();
    const photos = sent.files.filter((f) => f.from);
    assert.deepEqual(shotOrder(sent.files), ["camera-am", "camera-pm", "screenshot", "next-day"]);

    for (const f of photos) {
      assert.ok(f.taken !== null, `${f.from} (${f.name}) went out with no capture date at all`);
    }
    for (let i = 1; i < photos.length; i++) {
      assert.ok(photos[i].taken > photos[i - 1].taken,
        `capture dates must still ascend, but ${photos[i].from} does not`);
    }
  });
});

test("the heavy probe is a real week's shape: 11 files, 28 MB, only size varying", options, async () => {
  await withApp(async (app) => {
    await app.page.goto(`${app.url}/#debug`);
    await app.page.waitFor(`(async () => [...document.querySelectorAll("button")]
      .some((b) => b.textContent.includes("Prepare the heavy test")))()`,
      { timeout: 20000, label: "the debug screen" });
    await app.page.eval(`
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Prepare the heavy test")).click();
    `);
    await app.page.waitFor(`(async () => [...document.querySelectorAll("button")]
      .some((b) => b.textContent.includes("Send the heavy test") && !b.disabled))()`,
      { timeout: 120000, label: "the heavy probe to build" });

    await app.page.eval(`
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Send the heavy test")).click();
    `);
    await app.page.waitFor("window.__shares.length > 0", { timeout: 60000, label: "the heavy probe to be shared" });

    const [sent] = await app.payloads();
    assert.equal(sent.files.length, 11);

    const total = sent.files.reduce((sum, f) => sum + f.size, 0);
    assert.ok(total > 27 * 1024 * 1024 && total < 30 * 1024 * 1024,
      `should weigh about what a real week weighs, got ${(total / 1048576).toFixed(1)} MB`);

    // Every signal agrees with the order sent — that is the whole point here,
    // so that any deviation on the device is attributable to size alone.
    const names = sent.files.map((f) => f.name);
    assert.deepEqual([...names].sort(), names, "filenames ascend with the order sent");
    for (let i = 1; i < sent.files.length; i++) {
      assert.ok(sent.files[i].taken > sent.files[i - 1].taken, `capture date #${i}`);
      assert.ok(sent.files[i].lastModified > sent.files[i - 1].lastModified, `timestamp #${i}`);
    }

    // …and the sizes deliberately do not, with the two smallest photos late.
    const mb = sent.files.map((f) => f.size / 1048576);
    const bySize = mb.map((m, i) => [m, i + 1]).sort((a, b) => a[0] - b[0]).map((pair) => pair[1]);
    assert.notDeepEqual(bySize, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      "if size order matched send order the probe would prove nothing");
    assert.ok(mb[8] < 0.5 && mb[9] < 0.8, "the small ones sit at 9 and 10, where a race would show");
    assert.ok(Math.max(...mb) > 5, "and a 5.8 MB camera original is in there to lose that race");

    // The screenshot stand-ins have to be readable as PNGs, date and all.
    assert.match(sent.files[0].name, /\.png$/);
    assert.match(sent.files[2].name, /\.png$/);
  });
});
