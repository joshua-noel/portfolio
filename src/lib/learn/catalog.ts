import { canRead } from "../access.ts";
import {
  buildLecture,
  LectureError,
  readCourse,
  SHELVES,
  splitFrontmatter,
  type CourseFront,
  type Diagrams,
  type Lecture,
  type SourceFile,
  type Visibility,
} from "./lecture.ts";
import { Renderer } from "./render.ts";

/** One course folder as a loader found it: bundled, on disk, or from anywhere else. */
export interface CourseSource {
  /** The folder's name, which is the course's slug. */
  slug: string;
  /** Where the folder is, for serving the files beside a lecture. */
  dir: string;
  course: SourceFile;
  /** `NN-slug.md` files, not the `.script.md` ones. */
  lectures: SourceFile[];
  /** `diagrams/NN-name.svg`, by `NN-name`. */
  diagrams: Diagrams;
  /** Every file name in the folder, to find the video, captions and poster. */
  media: ReadonlySet<string>;
}

export interface Content {
  courses: CourseSource[];
}

export interface Course {
  front: CourseFront;
  /** The folder on disk. Empty for a course the reader may not open. */
  dir: string;
  /** The course's own paragraph, as HTML; empty when the course is locked. */
  introHtml: string;
  /** True when the reader may not open the course or its lectures. */
  locked: boolean;
  lectures: Lecture[];
}

export interface Shelf {
  id: string;
  title: string;
  courses: Course[];
}

export interface Catalog {
  /** Shelves that have at least one course, in the order they stand. */
  shelves: Shelf[];
  /** Every course in shelf order. */
  courses: Course[];
  /** Every lecture, in reading order. */
  lectures: Lecture[];
  warnings: string[];
  /** Lectures and courses of visibility `local` that were left out. */
  localIgnored: number;
}

export interface LoadOptions {
  /**
   * Whether `local` content may be loaded. When it may not, it is read only as
   * far as its front matter, left out of the catalog entirely, and counted.
   */
  allowLocal: boolean;
  /**
   * Content that lives in the repository is public by definition, so this
   * makes any other visibility an error: a members-only lecture must never be
   * committed.
   */
  repository?: boolean;
}

/**
 * Builds every course and lecture, rendering all of them whatever their
 * visibility: who may read what is decided later, per reader, by `forViewer`.
 * Throws `LectureError` for the first file with problems and for any
 * inconsistency between files.
 */
export async function loadCatalog(
  content: Content,
  options: LoadOptions,
): Promise<Catalog> {
  const { allowLocal, repository = false } = options;
  const issues: string[] = [];
  const courses: Course[] = [];
  let localIgnored = 0;

  for (const source of content.courses) {
    let split;
    try {
      split = splitFrontmatter(source.course.raw);
    } catch (error) {
      throw new LectureError(source.course.path, [
        error instanceof Error ? error.message : String(error),
      ]);
    }
    const { front, issues: problems } = readCourse(split.data, source.slug);
    if (!front) throw new LectureError(source.course.path, problems);

    if (repository && front.visibility !== "public") {
      issues.push(
        `${front.slug}: a "${front.visibility}" course must not be committed; this repository is public`,
      );
    }
    if (front.visibility === "local" && !allowLocal) {
      localIgnored += 1;
      continue;
    }

    const lectures: Lecture[] = [];
    for (const file of source.lectures) {
      const lecture = await buildLecture(
        file,
        front.slug,
        source.diagrams,
        source.media,
        {
          shows: (visibility) => visibility !== "local" || allowLocal,
        },
      );
      if (repository && lecture.front.visibility !== "public") {
        issues.push(
          `${front.slug}/${lecture.slug}: a "${lecture.front.visibility}" lecture must not be committed; this repository is public`,
        );
      }
      if (lecture.front.visibility === "local" && !allowLocal) {
        localIgnored += 1;
        continue;
      }
      lectures.push(lecture);
    }
    lectures.sort((a, b) => a.front.order - b.front.order);

    const slugs = lectures.map((lecture) => lecture.slug);
    for (const slug of new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i))) {
      issues.push(`${front.slug}: two lectures named "${slug}"`);
    }
    const orders = lectures.map((lecture) => lecture.front.order);
    for (const order of new Set(orders.filter((n, i) => orders.indexOf(n) !== i))) {
      issues.push(`${front.slug}: two lectures have order ${order}`);
    }

    const introHtml = await new Renderer().render(split.body, "waterline");
    courses.push({ front, dir: source.dir, introHtml, locked: false, lectures });
  }

  const slugs = courses.map((course) => course.front.slug);
  for (const slug of new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i))) {
    const where = content.courses
      .filter((c) => c.slug === slug)
      .map((c) => c.dir)
      .join(" and ");
    issues.push(`two courses named "${slug}", in ${where}`);
  }
  for (const course of courses) {
    const twin = courses.find(
      (other) =>
        other !== course &&
        other.front.shelf === course.front.shelf &&
        other.front.order === course.front.order,
    );
    if (twin)
      issues.push(`${course.front.slug} and ${twin.front.slug} share shelf and order`);
    for (const lecture of course.lectures) {
      for (const wanted of lecture.front.prerequisites) {
        const same = course.lectures.filter((other) => other.slug === wanted);
        const anywhere = courses
          .flatMap((c) => c.lectures)
          .filter((other) => other.slug === wanted);
        if (same.length === 0 && anywhere.length !== 1) {
          issues.push(
            `${course.front.slug}/${lecture.slug}: prerequisite "${wanted}" ${anywhere.length === 0 ? "is not a lecture" : "is ambiguous"}`,
          );
        }
      }
    }
  }
  if (issues.length > 0) throw new LectureError("courses", [...new Set(issues)]);
  return assemble(courses, localIgnored);
}

/** Shelves, flat lists and warnings from courses in any order. */
function assemble(courses: Course[], localIgnored: number): Catalog {
  const shelves = SHELVES.map((shelf) => ({
    id: shelf.id as string,
    title: shelf.title as string,
    courses: courses
      .filter((course) => course.front.shelf === shelf.id)
      .sort((a, b) => a.front.order - b.front.order),
  })).filter((shelf) => shelf.courses.length > 0);

  const flat = shelves.flatMap((shelf) => shelf.courses);
  return {
    shelves,
    courses: flat,
    lectures: flat.flatMap((course) => course.lectures),
    warnings: flat.flatMap((course) =>
      course.lectures.flatMap((lecture) =>
        lecture.warnings.map(
          (warning) => `${course.front.slug}/${lecture.slug}: ${warning}`,
        ),
      ),
    ),
    localIgnored,
  };
}

/**
 * What a lecture shows a reader who may not open it: its place and its title
 * and promise, which the listing shows anyway, and nothing else. Every other
 * field is empty, so no template can print what it was never given.
 */
function lockedLecture(lecture: Lecture): Lecture {
  const { course, order, slug, title, promise, visibility, placeholder } = lecture.front;
  return {
    course,
    slug,
    file: "",
    front: {
      course,
      order,
      slug,
      title,
      promise,
      visibility,
      placeholder,
      video: false,
      minutes: { tip: 0, waterline: 0, deep: 0, abyss: 0 },
      objectives: [],
      prerequisites: [],
      sources: [],
      checked: "",
    },
    locked: true,
    segments: [],
    objectivesHtml: [],
    toc: [],
    text: "",
    media: { video: false, captions: false },
    warnings: [],
  };
}

/**
 * The catalog as one reader sees it: every course and lecture is still listed,
 * but those this reader may not open are stubs. `role` is the reader's role,
 * or undefined for a visitor. A course the reader may not open locks all of
 * its lectures, whatever their own visibility: the stricter of the two wins.
 */
export function forViewer(catalog: Catalog, role: unknown, allowLocal: boolean): Catalog {
  const courses = catalog.courses.map((course): Course => {
    const open = canRead(course.front.visibility, role, allowLocal);
    const lectures = course.lectures.map((lecture) =>
      open && canRead(lecture.front.visibility, role, allowLocal)
        ? lecture
        : lockedLecture(lecture),
    );
    if (open) return { ...course, lectures };
    const { slug, title, shelf, promise, visibility, order, cover } = course.front;
    return {
      front: { slug, title, shelf, promise, visibility, order, cover },
      dir: "",
      introHtml: "",
      locked: true,
      lectures,
    };
  });
  return assemble(courses, catalog.localIgnored);
}

export function findCourse(
  catalog: Catalog,
  slug: string | undefined,
): Course | undefined {
  return catalog.courses.find((course) => course.front.slug === slug);
}

export function findLecture(
  course: Course,
  slug: string | undefined,
): Lecture | undefined {
  return course.lectures.find((lecture) => lecture.slug === slug);
}

export const lectureUrl = (lecture: Lecture): string =>
  `/${lecture.course}/${lecture.slug}`;

export interface Neighbours {
  previous?: Lecture;
  next?: Lecture;
}

export function neighbours(course: Course, slug: string): Neighbours {
  const index = course.lectures.findIndex((lecture) => lecture.slug === slug);
  return { previous: course.lectures[index - 1], next: course.lectures[index + 1] };
}
