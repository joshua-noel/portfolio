#!/usr/bin/env node
// Build-time check for lecture content: renders every course and lecture and
// enforces learn-content/CONTRACT.md, exiting 1 and listing every problem.
//
//   node bin/check-learn.mjs [content-dir]
//
// With no argument it checks the folder named by PORTFOLIO_LEARN_CONTENT_DIR,
// or else the sample lectures in this repository. `pnpm build` and
// `pnpm check` run it on the sample lectures, which must all be public: the
// repository is public. Run it on a private folder to check that.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/lib/learn/catalog.ts";
import { readContentDir } from "../src/lib/learn/disk.ts";
import { LectureError, VISIBILITIES } from "../src/lib/learn/lecture.ts";

const sample = fileURLToPath(new URL("../content/learn", import.meta.url));
const dir = resolve(process.argv[2] ?? process.env.PORTFOLIO_LEARN_CONTENT_DIR ?? sample);

try {
  // Every visibility, so locked lectures are checked as strictly as public ones.
  const catalog = await loadCatalog(readContentDir(dir), VISIBILITIES, {
    repository: dir === sample,
  });
  for (const warning of catalog.warnings)
    process.stderr.write(`learn: warning: ${warning}\n`);
  process.stdout.write(
    `learn: ${catalog.lectures.length} lectures in ${catalog.courses.length} courses (${dir}), all checks passed\n`,
  );
} catch (error) {
  if (!(error instanceof LectureError)) throw error;
  process.stderr.write(`learn: ${error.message}\n`);
  process.exit(1);
}
