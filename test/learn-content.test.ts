import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, type Catalog } from "../src/lib/learn/catalog.ts";
import { createCatalogStore } from "../src/lib/learn/content.ts";
import {
  MAX_COURSE_BYTES,
  MAX_DIAGRAM_BYTES,
  MAX_LECTURE_BYTES,
  readContentDirs,
} from "../src/lib/learn/disk.ts";
import {
  courseMarkdown,
  lectureMarkdown,
  sources,
  visibilityLibrary,
} from "./helpers/fixtures.ts";

const empty = (build: number): Catalog => ({
  shelves: [],
  courses: [],
  lectures: [],
  warnings: [],
  // The number of the build that made it: what a view of it still carries.
  localIgnored: build,
  problems: [],
  problemCount: 0,
});

/** A promise that is settled from outside, and a loader that hands them out one by one. */
function loader() {
  const pending: { catalog: Catalog; resolve: () => void }[] = [];
  const calls: number[] = [];
  const load = (): Promise<Catalog> => {
    const { promise, resolve } = Promise.withResolvers<Catalog>();
    const catalog = empty(pending.length + 1);
    pending.push({ catalog, resolve: () => resolve(catalog) });
    calls.push(pending.length);
    return promise;
  };
  return { load, pending, calls };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("the first request waits for the first build, and nothing else does", async () => {
  const l = loader();
  let signature = "a";
  const store = createCatalogStore({
    dirs: ["x"],
    allowLocal: false,
    signature: () => signature,
    load: l.load,
    recheckMs: 0,
  });
  const first = store.get(undefined);
  const second = store.get("admin");
  await settle();
  assert.equal(l.calls.length, 1, "one build for two waiting requests");
  l.pending[0]!.resolve();
  assert.equal((await first).localIgnored, 1);
  assert.equal((await second).localIgnored, 1);
  assert.equal(signature, "a");
});

test("a change is built in the background while the old catalog keeps being served", async () => {
  const l = loader();
  let signature = "a";
  const store = createCatalogStore({
    dirs: ["x"],
    allowLocal: false,
    signature: () => signature,
    load: l.load,
    recheckMs: 0,
  });
  const initial = store.get(undefined);
  await settle();
  l.pending[0]!.resolve();
  await initial;

  signature = "b"; // a file was edited
  // The request that notices the change is not held up by the build, and nor are the next ones.
  const during = await Promise.race([
    store.get(undefined).then((c) => c.localIgnored),
    new Promise<number>((resolve) => setTimeout(() => resolve(-1), 500)),
  ]);
  assert.equal(during, 1);
  assert.equal(l.calls.length, 2, "the build started");
  assert.equal((await store.get("member")).localIgnored, 1);
  assert.equal(l.calls.length, 2, "and only one build runs at a time");

  // Another edit while it builds does not start a second build, nor stop the first.
  signature = "c";
  assert.equal((await store.get(undefined)).localIgnored, 1);
  assert.equal(l.calls.length, 2);

  // The swap: once built, everyone gets the new one, and the change made meanwhile is picked up next.
  l.pending[1]!.resolve();
  await settle();
  assert.equal((await store.get(undefined)).localIgnored, 2);
  assert.equal(l.calls.length, 3, "the later edit is built next");
  l.pending[2]!.resolve();
  await settle();
  assert.equal((await store.get("friend")).localIgnored, 3);
});

test("a build that fails leaves the previous catalog in place and is tried again on the next change", async () => {
  let signature = "a";
  let fail = false;
  const store = createCatalogStore({
    dirs: ["x"],
    allowLocal: false,
    signature: () => signature,
    load: async () => {
      if (fail) throw new Error("boom");
      return empty(signature === "a" ? 1 : signature === "c" ? 3 : 2);
    },
    recheckMs: 0,
    log: () => {},
  });
  assert.equal((await store.get(undefined)).localIgnored, 1);
  fail = true;
  signature = "b";
  await store.get(undefined);
  await settle();
  assert.equal((await store.get(undefined)).localIgnored, 1);
  fail = false;
  signature = "c";
  await store.get(undefined);
  await settle();
  assert.equal((await store.get(undefined)).localIgnored, 3);
});

test("views are per reader and per local switch, and the local switch never widens a catalog that was loaded without it", async () => {
  const store = createCatalogStore({
    dirs: ["x"],
    allowLocal: false,
    signature: () => "a",
    load: () => loadCatalog({ courses: sources(visibilityLibrary()) }, { allowLocal: false, lenient: true }),
    recheckMs: 0,
  });
  const visitor = await store.get(undefined, true);
  assert.ok(!JSON.stringify(visitor).includes("l-local"));
  assert.ok(!(await store.get("admin", true)).courses.some((c) => c.front.slug === "c-local"));
});

test("loading a catalog gives the event loop back between lectures", async () => {
  const courses = sources(visibilityLibrary().slice(0, 3));
  let ticks = 0;
  let running = true;
  const spinner = (async () => {
    while (running) {
      await settle();
      ticks += 1;
    }
  })();
  await loadCatalog({ courses }, { allowLocal: false, lenient: true });
  running = false;
  await spinner;
  // Three lectures: other work ran between them, not only after the whole load.
  assert.ok(ticks >= 3, `only ${ticks} turns of the event loop during the load`);
});

test("a file over its size limit is not read, and the log line says so", () => {
  const root = mkdtempSync(join(tmpdir(), "portfolio-limits-"));
  const dir = join(root, "alpha");
  mkdirSync(join(dir, "diagrams"), { recursive: true });
  writeFileSync(join(dir, "course.md"), courseMarkdown("alpha", "foundations", 1, "public", "C"));
  const ok = lectureMarkdown("alpha", { order: 1, slug: "ok", title: "Ok", visibility: "public", secret: "S" });
  writeFileSync(join(dir, "01-ok.md"), ok);
  writeFileSync(join(dir, "02-big.md"), ok);
  truncateSync(join(dir, "02-big.md"), MAX_LECTURE_BYTES + 1);
  writeFileSync(join(dir, "diagrams", "01-small.svg"), "<svg/>");
  writeFileSync(join(dir, "diagrams", "02-big.svg"), "<svg/>");
  truncateSync(join(dir, "diagrams", "02-big.svg"), MAX_DIAGRAM_BYTES + 1);
  // A lecture exactly at the limit is read.
  writeFileSync(join(dir, "03-edge.md"), ok);
  truncateSync(join(dir, "03-edge.md"), MAX_LECTURE_BYTES);
  // A course file over its limit drops the course, and says so.
  const other = join(root, "beta");
  mkdirSync(other);
  writeFileSync(join(other, "course.md"), courseMarkdown("beta", "systems", 1, "public", "C"));
  truncateSync(join(other, "course.md"), MAX_COURSE_BYTES + 1);

  const content = readContentDirs([root]);
  const alpha = content.courses.find((c) => c.slug === "alpha")!;
  assert.deepEqual(alpha.lectures.map((l) => l.name), ["01-ok.md", "03-edge.md"]);
  assert.deepEqual([...alpha.diagrams.keys()], ["01-small"]);
  assert.equal(content.courses.some((c) => c.slug === "beta"), false);
  const text = (content.problems ?? []).join("\n");
  assert.match(text, /02-big\.md.*over the .*limit/is);
  assert.match(text, /02-big\.svg.*over the .*limit/is);
  assert.match(text, /beta.*course\.md.*over the .*limit/is);
  // Room for real content to grow (the largest real lecture is 40 KB, diagram 43 KB).
  assert.ok(MAX_LECTURE_BYTES >= 40_000 * 3 && MAX_DIAGRAM_BYTES >= 43_000 * 10);
});
