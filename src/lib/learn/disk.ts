import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Content, CourseSource } from "./catalog.ts";

/**
 * Reads a content folder laid out as learn-content/CONTRACT.md says:
 * `<course>/course.md`, `<course>/NN-slug.md`, `<course>/diagrams/NN-name.svg`.
 * The server, the build-time check and the tests all load content through here.
 */
export function readContentDir(root: string): Content {
  const courses: CourseSource[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const coursePath = join(dir, "course.md");
    if (!existsSync(coursePath)) continue;

    const files = readdirSync(dir);
    const diagrams = new Map<string, string>();
    const diagramDir = join(dir, "diagrams");
    if (existsSync(diagramDir)) {
      for (const name of readdirSync(diagramDir)) {
        if (extname(name) === ".svg") {
          diagrams.set(
            basename(name, ".svg"),
            readFileSync(join(diagramDir, name), "utf8"),
          );
        }
      }
    }

    courses.push({
      slug: entry.name,
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
    });
  }
  courses.sort((a, b) => a.slug.localeCompare(b.slug));
  return { courses };
}

/**
 * A cheap fingerprint of a content folder: every file's path, size and
 * modification time. The server compares it to reload content that changed.
 */
export function contentSignature(root: string): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
  walk(root);
  return parts.join("\n");
}
