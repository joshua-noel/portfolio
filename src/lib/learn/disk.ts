import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Content, CourseSource } from "./catalog.ts";

/**
 * Reads a content folder laid out as learn-content/CONTRACT.md says:
 * `<course>/course.md`, `<course>/NN-slug.md`, `<course>/diagrams/NN-name.svg`.
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
      const course = readCourse(dir, entry.name);
      if (course) courses.push(course);
    } catch (error) {
      problems.push(`${dir}: cannot be read: ${describe(error)}`);
    }
  }
  courses.sort((a, b) => a.slug.localeCompare(b.slug));
  return courses;
}

function readCourse(dir: string, slug: string): CourseSource | undefined {
  const coursePath = join(dir, "course.md");
  if (!existsSync(coursePath)) return undefined;

  const files = readdirSync(dir);
  const diagrams = new Map<string, string>();
  const diagramDir = join(dir, "diagrams");
  if (existsSync(diagramDir)) {
    for (const name of readdirSync(diagramDir)) {
      if (extname(name) === ".svg") {
        diagrams.set(basename(name, ".svg"), readFileSync(join(diagramDir, name), "utf8"));
      }
    }
  }

  return {
    slug,
    dir,
    course: {
      path: coursePath,
      name: "course.md",
      raw: readFileSync(coursePath, "utf8"),
    },
    lectures: files
      .filter((name) => /^\d{2}-.*\.md$/.test(name) && !name.endsWith(".script.md"))
      .sort()
      .map((name) => ({
        path: join(dir, name),
        name,
        raw: readFileSync(join(dir, name), "utf8"),
      })),
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
