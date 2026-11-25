import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CourseSource } from "../../src/lib/learn/catalog.ts";

/** A string that appears in every part of a lecture, so a leak can be found by searching for it. */
export const SECRET = {
  public: "CANARYPUBLICQQ",
  members: "CANARYMEMBERSQQ",
  friends: "CANARYFRIENDSQQ",
  local: "CANARYLOCALQQ",
} as const;

export type Visibility = keyof typeof SECRET;
export const VISIBILITIES: Visibility[] = ["public", "members", "friends", "local"];

export const DIAGRAM = `<svg viewBox="0 0 10 10"><title>Diagram title</title><desc>Diagram desc.</desc><rect width="5" height="5" fill="var(--c1)" stroke="var(--border)" /></svg>`;

export interface FixtureLecture {
  order: number;
  slug: string;
  title: string;
  visibility: string;
  secret: string;
}

/** A small, valid lecture (a placeholder, so word counts do not apply) carrying `secret` everywhere. */
export function lectureMarkdown(course: string, l: FixtureLecture): string {
  return `---
course: ${course}
order: ${l.order}
slug: ${l.slug}
title: ${l.title}
promise: Promise of ${l.title}.
visibility: ${l.visibility}
video: true
placeholder: true
minutes: { tip: 2, waterline: 9, deep: 8, abyss: 6 }
objectives:
  - Objective ${l.secret}.
prerequisites: []
sources:
  - { id: Src, title: "Source ${l.secret}", url: "https://example.com/${l.secret}", used_for: "use ${l.secret}" }
checked: 2026-11-01
---

# Tip

Tip text ${l.secret}.

# Waterline

## The idea in one paragraph

Idea ${l.secret} [Src].

## 1. Section

Body ${l.secret}.

![[diagram: 01-d | Caption ${l.secret}.]]

## Worked example

Example ${l.secret}.

## Check yourself

<details><summary>Question ${l.secret}?</summary>Answer.</details>

## References

# Deep

## 1. Deeper

Deep ${l.secret}.

# Abyss

## 1. Deepest

Abyss ${l.secret}.
`;
}

export function courseMarkdown(
  slug: string,
  shelf: string,
  order: number,
  visibility: string,
  secret: string,
): string {
  return `---
slug: ${slug}
title: Course ${slug}
shelf: ${shelf}
promise: Course promise ${slug}.
visibility: ${visibility}
order: ${order}
cover: { color: "#112233", accent: "#445566", motif: "grid" }
---

Course intro ${secret}.
`;
}

/**
 * A small cover illustration, as a course's cover.svg: the page's own rules
 * (viewBox, no text) and a mark of its own, so a test can tell whose it is.
 */
export const coverArt = (slug: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" data-art="ART-${slug}" data-mark="40 120 80 80" fill="none" stroke="#e8e8e8" stroke-width="2.5"><g><rect class="m" x="40" y="120" width="80" height="80" rx="4"/><circle cx="160" cy="160" r="20"/></g></svg>`;

export interface FixtureCourse {
  slug: string;
  shelf: string;
  order: number;
  visibility: string;
  lectures: FixtureLecture[];
  /** The course has a cover.svg (`coverArt(slug)`). */
  cover?: boolean;
}

const secretOf = (visibility: string): string =>
  SECRET[visibility as Visibility] ?? `CANARYOTHER${visibility.toUpperCase()}QQ`;

/** One course per visibility, each with one lecture of that visibility. */
export function visibilityLibrary(): FixtureCourse[] {
  return VISIBILITIES.map((v, i) => ({
    slug: `c-${v}`,
    shelf: ["foundations", "systems", "agents", "special"][i]!,
    order: 1,
    visibility: v,
    cover: true,
    lectures: [
      {
        order: 1,
        slug: `l-${v}`,
        title: `Lecture ${v}`,
        visibility: v,
        secret: SECRET[v],
      },
    ],
  }));
}

/** In-memory sources, as a loader would hand them over. */
export function sources(courses: FixtureCourse[]): CourseSource[] {
  return courses.map((c) => ({
    slug: c.slug,
    dir: `/fixture/${c.slug}`,
    course: {
      path: `${c.slug}/course.md`,
      name: "course.md",
      raw: courseMarkdown(c.slug, c.shelf, c.order, c.visibility, secretOf(c.visibility)),
    },
    lectures: c.lectures.map((l) => {
      const name = `${String(l.order).padStart(2, "0")}-${l.slug}.md`;
      return { path: `${c.slug}/${name}`, name, raw: lectureMarkdown(c.slug, l) };
    }),
    diagrams: new Map([["01-d", DIAGRAM]]),
    ...(c.cover ? { cover: coverArt(c.slug) } : {}),
    media: new Set(
      c.lectures.flatMap((l) => [
        `${String(l.order).padStart(2, "0")}-${l.slug}.mp4`,
        `${String(l.order).padStart(2, "0")}-${l.slug}.vtt`,
      ]),
    ),
  }));
}

/** The same library on disk, for a server to read. */
export function writeLibrary(root: string, courses: FixtureCourse[]): void {
  for (const c of courses) {
    const dir = join(root, c.slug);
    mkdirSync(join(dir, "diagrams"), { recursive: true });
    writeFileSync(
      join(dir, "course.md"),
      courseMarkdown(c.slug, c.shelf, c.order, c.visibility, secretOf(c.visibility)),
    );
    writeFileSync(join(dir, "diagrams", "01-d.svg"), DIAGRAM);
    if (c.cover) writeFileSync(join(dir, "cover.svg"), coverArt(c.slug));
    for (const l of c.lectures) {
      const stem = `${String(l.order).padStart(2, "0")}-${l.slug}`;
      writeFileSync(join(dir, `${stem}.md`), lectureMarkdown(c.slug, l));
      writeFileSync(join(dir, `${stem}.mp4`), `VIDEO ${l.secret}`);
      writeFileSync(
        join(dir, `${stem}.vtt`),
        `WEBVTT\n\n00:00.000 --> 00:01.000\n${l.secret}\n`,
      );
    }
  }
}
