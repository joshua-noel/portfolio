import { whyLocked } from "../access.ts";
import type { Catalog, Course } from "./catalog.ts";
import { lectureUrl } from "./catalog.ts";
import {
  coverStyle,
  coverTitleSize,
  heightRem,
  NOMINAL_LECTURE_MINUTES,
  spineTitle,
  splitTitle,
  thicknessRem,
  type CoverStyle,
} from "./cover.ts";
import { DEPTHS, type Depth } from "./depth.ts";
import { minutesAt } from "./lecture.ts";

/**
 * The landing page's bookshelf as data: one book per course, shelves in the
 * catalog's order. It is built from a catalog that `forViewer` has already
 * cut down to what this reader may see, and it reads only what a locked stub
 * carries (a course's title, promise, shelf and cover; a lecture's number,
 * title and promise), so a book of a locked course cannot show more.
 */

export interface BookLecture {
  slug: string;
  href: string;
  order: number;
  title: string;
  promise: string;
  locked: boolean;
  placeholder: boolean;
  video: boolean;
  /** Reading time at each depth; absent for a lecture the reader may not open. */
  minutes?: Record<Depth, number>;
}

export interface Book {
  slug: string;
  href: string;
  title: string;
  /** The title before a colon, and what follows it. */
  main: string;
  sub?: string;
  promise: string;
  shelf: string;
  shelfTitle: string;
  locked: boolean;
  /** Why a locked book is locked, in the words of the course page. */
  why?: string;
  cover: CoverStyle;
  lectures: BookLecture[];
  /** Lectures the reader may open that have a video. */
  videos: number;
  /** Reading time of the whole course at each depth; absent when locked. */
  minutes?: Record<Depth, number>;
  /** Spine width and height in rem. */
  thickness: number;
  height: number;
  /** Type size in rem on the spine and on the cover, and the lines the spine title takes. */
  spine: { size: number; lines: number };
  coverTitle: number;
}

export interface ShelfView {
  id: string;
  title: string;
  books: Book[];
  /** Too many books for half the page: the shelf takes the whole width. */
  wide: boolean;
}

/** Spines this wide (rem, with the gaps between them) fill half a page; more and the shelf spans it. */
export const WIDE_SHELF_REM = 26;

/** How wide the books of a shelf stand, in rem. */
export function standingWidth(books: { thickness: number }[]): number {
  return sum(books.map((book) => book.thickness)) + Math.max(0, books.length - 1) * 0.125;
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

function bookOf(course: Course, shelfTitle: string): Book {
  const { front } = course;
  const lectures = course.lectures.map((lecture): BookLecture => {
    const base = {
      slug: lecture.slug,
      href: lectureUrl(lecture),
      order: lecture.front.order,
      title: lecture.front.title,
      promise: lecture.front.promise,
    };
    // A stub's minutes and flags are placeholders, not facts: say nothing.
    if (lecture.locked) {
      return { ...base, locked: true, placeholder: false, video: false };
    }
    return {
      ...base,
      locked: false,
      placeholder: lecture.front.placeholder,
      video: lecture.front.video,
      minutes: lecture.front.minutes,
    };
  });
  const open = lectures.filter((lecture) => !lecture.locked);
  // The spine is as thick as the whole course reads, at every depth but Tip
  // (which is a short text of its own). A lecture the reader may not open
  // counts as a typical one, so a locked book still stands on the shelf.
  const full = (lecture: BookLecture): number =>
    lecture.minutes ? minutesAt(lecture.minutes, "abyss") : NOMINAL_LECTURE_MINUTES;
  const minutes = course.locked
    ? undefined
    : (Object.fromEntries(
        DEPTHS.map((depth) => [
          depth,
          sum(open.map((lecture) => minutesAt(lecture.minutes!, depth))),
        ]),
      ) as Record<Depth, number>);
  const { main, sub } = splitTitle(front.title);
  const thickness = thicknessRem(sum(lectures.map(full)));
  const height = heightRem(front.slug);
  return {
    slug: front.slug,
    href: `/${front.slug}`,
    title: front.title,
    main,
    sub,
    promise: front.promise,
    shelf: front.shelf,
    shelfTitle,
    locked: course.locked,
    why: course.locked ? whyLocked(front.visibility) : undefined,
    cover: coverStyle(front.cover),
    lectures,
    videos: open.filter((lecture) => lecture.video).length,
    minutes,
    thickness,
    height,
    spine: spineTitle(main, thickness, height),
    coverTitle: coverTitleSize(main),
  };
}

/** Every shelf that has a book, in the catalog's order, each book as its reader may see it. */
export function buildShelves(catalog: Catalog): ShelfView[] {
  return catalog.shelves.map((shelf) => {
    const books = shelf.courses.map((course) => bookOf(course, shelf.title));
    return {
      id: shelf.id,
      title: shelf.title,
      books,
      wide: standingWidth(books) > WIDE_SHELF_REM,
    };
  });
}
