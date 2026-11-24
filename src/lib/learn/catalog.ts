import { canRead, parseRole } from "../access.ts";
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
  /** Folders or files the reader of the disk could not read, as text for the owner. */
  problems?: string[];
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
  /**
   * Files that could not be loaded, in `lenient` mode, as text for the owner.
   * `forViewer` empties it for everyone but an admin.
   */
  problems: string[];
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
  /**
   * The server's mode: a file that cannot be loaded is left out and described
   * in `Catalog.problems`, and everything else still loads. Strict (the
   * default, for the checker and tests) throws at the first bad file.
   */
  lenient?: boolean;
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
  const { allowLocal, repository = false, lenient = false } = options;
  const issues: string[] = [];
  // Files that could not be loaded, when `lenient`: reported, never served.
  const problems: string[] = [...(content.problems ?? [])];
  const courses: Course[] = [];
  let localIgnored = 0;

  /** Strict: the first bad file stops the load. Lenient: it is set aside and described. */
  const reject = (path: string, why: string[]): void => {
    if (!lenient) throw new LectureError(path, why);
    problems.push(new LectureError(path, why).message);
  };

  for (const source of content.courses) {
    let split;
    try {
      split = splitFrontmatter(source.course.raw);
    } catch (error) {
      reject(source.course.path, [error instanceof Error ? error.message : String(error)]);
      continue;
    }
    const { front, issues: frontIssues } = readCourse(split.data, source.slug);
    if (!front) {
      reject(source.course.path, frontIssues);
      continue;
    }

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
    let leftOut = 0;
    for (const file of source.lectures) {
      let lecture: Lecture;
      try {
        lecture = await buildLecture(file, front.slug, source.diagrams, source.media, {
          shows: (visibility) => visibility !== "local" || allowLocal,
        });
      } catch (error) {
        if (!lenient) throw error;
        // Anything a lecture's own build throws (a bad formula as well as a bad
        // front matter) costs that lecture alone.
        reject(
          file.path,
          error instanceof LectureError
            ? error.issues
            : [error instanceof Error ? error.message : String(error)],
        );
        continue;
      }
      if (repository && lecture.front.visibility !== "public") {
        issues.push(
          `${front.slug}/${lecture.slug}: a "${lecture.front.visibility}" lecture must not be committed; this repository is public`,
        );
      }
      if (lecture.front.visibility === "local" && !allowLocal) {
        localIgnored += 1;
        leftOut += 1;
        continue;
      }
      lectures.push(lecture);
    }
    lectures.sort((a, b) => a.front.order - b.front.order);
    // A lecture left out as `local` must not leave a hole in the numbers a
    // reader sees: that hole would say a lecture is there that they cannot have.
    if (leftOut > 0) {
      lectures.forEach((lecture, index) => {
        lecture.front.order = index + 1;
      });
    }

    const slugs = lectures.map((lecture) => lecture.slug);
    for (const slug of new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i))) {
      issues.push(`${front.slug}: two lectures named "${slug}"`);
    }
    const orders = lectures.map((lecture) => lecture.front.order);
    for (const order of new Set(orders.filter((n, i) => orders.indexOf(n) !== i))) {
      issues.push(`${front.slug}: two lectures have order ${order}`);
    }

    let introHtml: string;
    try {
      introHtml = await new Renderer().render(split.body, "waterline");
    } catch (error) {
      if (!lenient) throw error;
      reject(source.course.path, [error instanceof Error ? error.message : String(error)]);
      continue;
    }
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
  if (issues.length > 0) {
    // Between files: a clash of names or orders. Lenient, everything that did
    // load is still served, and the clash is told to the owner.
    if (!lenient) throw new LectureError("courses", [...new Set(issues)]);
    problems.push(new LectureError("courses", [...new Set(issues)]).message);
  }
  return assemble(courses, localIgnored, problems);
}

/** Shelves, flat lists and warnings from courses in any order. */
function assemble(courses: Course[], localIgnored: number, problems: string[]): Catalog {
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
    problems,
  };
}

/**
 * What a lecture shows a reader who may not open it: its place and its title
 * and promise, which the listing shows anyway, and nothing else. Every other
 * field is empty, so no template can print what it was never given.
 */
function lockedLecture(lecture: Lecture): Lecture {
  const { course, order, slug, title, promise, visibility } = lecture.front;
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
      // Not the lecture's own flag: it would say a draft stands behind the lock.
      placeholder: false,
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
 *
 * Without `allowLocal` there is no `local` content at all, not even as a stub:
 * the loader already leaves it out on a server, and here a catalog that was
 * loaded with it (the owner's dev server) loses it for any request that is not
 * the owner's own.
 */
export function forViewer(catalog: Catalog, role: unknown, allowLocal: boolean): Catalog {
  const courses = catalog.courses
    .filter((course) => allowLocal || course.front.visibility !== "local")
    .map((course): Course => {
      let { lectures } = course;
      if (!allowLocal && lectures.some((l) => l.front.visibility === "local")) {
        // And no gap in the numbers where one was.
        lectures = lectures
          .filter((l) => l.front.visibility !== "local")
          .map((l, index) => ({ ...l, front: { ...l.front, order: index + 1 } }));
      }
      const open = canRead(course.front.visibility, role, allowLocal);
      lectures = lectures.map((lecture) =>
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
  // What went wrong with the files is for the owner (the admin) only.
  return assemble(
    courses,
    catalog.localIgnored,
    parseRole(role) === "admin" ? catalog.problems : [],
  );
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
