import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Content, CourseSource } from "./catalog.ts";

/**
 * Reads a content folder laid out as learn-content/CONTRACT.md says:
 * `<course>/course.md`, `<course>/NN-slug.md`, `<course>/diagrams/NN-name.svg`, and an optional `<course>/cover.svg`.
 * The server, the build-time check and the tests all load content through here.
 */
export function readContentDir(root: string): Content {
  return readContentDirs([root]);
}

/**
 * Several folders, merged: their courses side by side. A name in two is the
 * catalog's error to report. A folder or a course that cannot be read is
 * described in `problems` and skipped: the rest is still read.
 */
export function readContentDirs(roots: readonly string[]): Content {
  const problems: string[] = [];
  const courses = roots.flatMap((root) => readCourses(root, problems));
  return { courses, problems };
}

/**
 * Size limits, so one huge file cannot stall the process that serves every
 * host while it is parsed and rendered (a 52 MB lecture held the event loop
 * for minutes). Set from the real content, whose largest lecture is 40 KB and
 * largest diagram 43 KB, with a margin; a file over its limit is not
 * read, and the log line says which and by how much. The lecture limit is
 * the tight one: rendering runs on the main thread, and a lecture of one long
 * paragraph of inline maths held every host for 31 s at 512 KiB and about
 * 90 s at 1 MiB, against 1.7 s at 128 KiB (measured in the second sweep).
 */
export const MAX_LECTURE_BYTES = 128 * 1024;
export const MAX_DIAGRAM_BYTES = 512 * 1024;
export const MAX_COURSE_BYTES = 256 * 1024;

/** The file's text, or undefined (with a problem described) if it is over `limit` bytes. */
function readCapped(path: string, limit: number, problems: string[]): string | undefined {
  const { size } = statSync(path);
  if (size > limit) {
    problems.push(
      `${path}: ${size} bytes is over the ${limit} byte limit for this kind of file; not loaded`,
    );
    return undefined;
  }
  return readFileSync(path, "utf8");
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function readCourses(root: string, problems: string[]): CourseSource[] {
  const courses: CourseSource[] = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    problems.push(`${root}: cannot be read: ${describe(error)}`);
    return courses;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    try {
      const course = readCourse(dir, entry.name, problems);
      if (course) courses.push(course);
    } catch (error) {
      problems.push(`${dir}: cannot be read: ${describe(error)}`);
    }
  }
  courses.sort((a, b) => a.slug.localeCompare(b.slug));
  return courses;
}

function readCourse(dir: string, slug: string, problems: string[]): CourseSource | undefined {
  const coursePath = join(dir, "course.md");
  if (!existsSync(coursePath)) return undefined;
  const courseRaw = readCapped(coursePath, MAX_COURSE_BYTES, problems);
  if (courseRaw === undefined) return undefined;

  const files = readdirSync(dir);
  const diagrams = new Map<string, string>();
  const diagramDir = join(dir, "diagrams");
  if (existsSync(diagramDir)) {
    for (const name of readdirSync(diagramDir)) {
      if (extname(name) === ".svg") {
        const svg = readCapped(join(diagramDir, name), MAX_DIAGRAM_BYTES, problems);
        if (svg !== undefined) diagrams.set(basename(name, ".svg"), svg);
      }
    }
  }

  const coverPath = join(dir, "cover.svg");
  const cover = existsSync(coverPath)
    ? readCapped(coverPath, MAX_DIAGRAM_BYTES, problems)
    : undefined;

  return {
    slug,
    dir,
    ...(cover === undefined ? {} : { cover }),
    course: {
      path: coursePath,
      name: "course.md",
      raw: courseRaw,
    },
    lectures: files
      .filter((name) => /^\d{2}-.*\.md$/.test(name) && !name.endsWith(".script.md"))
      .sort()
      .flatMap((name) => {
        const path = join(dir, name);
        const raw = readCapped(path, MAX_LECTURE_BYTES, problems);
        return raw === undefined ? [] : [{ path, name, raw }];
      }),
    diagrams,
    media: new Set(files),
  };
}

/**
 * A cheap fingerprint of a content folder: every file's path, size and
 * modification time. The server compares it to reload content that changed.
 */
export function contentSignature(roots: readonly string[]): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      // A folder that cannot be listed is part of the fingerprint: it changes when it can.
      parts.push(`${dir}:unreadable:${describe(error)}`);
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        /\.(md|svg)$/.test(entry.name) ||
        /\.(mp4|vtt|png|jpg)$/.test(entry.name)
      ) {
        const stat = statSync(path);
        parts.push(`${path}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  for (const root of roots) walk(root);
  return parts.join("\n");
}
