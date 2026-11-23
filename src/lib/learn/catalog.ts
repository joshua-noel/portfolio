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
  /** The course's own paragraph, as HTML; empty when the course is locked. */
  introHtml: string;
  /** True when this process may not show the course or its lectures. */
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
}

/**
 * Builds every course and lecture. Throws `LectureError` for the first file
 * with problems and for any inconsistency between files. `audience` is the
 * visibilities this process may show: a lecture outside it is still checked,
 * and listed as locked, but its body is never rendered or kept. Content that
 * lives in the repository is public by definition, so `repository` makes any
 * other visibility an error: a members-only lecture must never be committed.
 */
export async function loadCatalog(
  content: Content,
  audience: readonly Visibility[],
  { repository = false }: { repository?: boolean } = {},
): Promise<Catalog> {
  const issues: string[] = [];
  const courses: Course[] = [];

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

    const courseShown = audience.includes(front.visibility);
    if (repository && front.visibility !== "public") {
      issues.push(
        `${front.slug}: a "${front.visibility}" course must not be committed; this repository is public`,
      );
    }

    const lectures: Lecture[] = [];
    for (const file of source.lectures) {
      // A public course can hold a locked lecture, so this is decided per lecture.
      const lecture = await buildLecture(
        file,
        front.slug,
        source.diagrams,
        source.media,
        {
          shows: (visibility) => courseShown && audience.includes(visibility),
        },
      );
      lectures.push(lecture);
      if (repository && lecture.front.visibility !== "public") {
        issues.push(
          `${front.slug}/${lecture.slug}: a "${lecture.front.visibility}" lecture must not be committed; this repository is public`,
        );
      }
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

    const introHtml = courseShown
      ? await new Renderer().render(split.body, "waterline")
      : "";
    courses.push({ front, introHtml, locked: !courseShown, lectures });
  }

  const slugs = courses.map((course) => course.front.slug);
  for (const slug of new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i))) {
    issues.push(`two courses named "${slug}"`);
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

  for (const course of courses) {
    for (const lecture of course.lectures) {
      lecture.locked = course.locked || !audience.includes(lecture.front.visibility);
    }
  }

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
  };
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
