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
  /** Reading time; absent for a lecture the reader may not open. */
  minutes?: number;
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
  /** Reading time of the whole course; absent when locked. */
  minutes?: number;
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
export const WIDE_SHELF_REM = 22;

/** The widest a bookcase may be (rem): the page, at the narrowest width that shows bookcases (76 rem less the page's margins). */
export const CASE_MAX_REM = 72;
/** How much bigger than their natural size the books stand when every case has room for it, biggest first. */
export const CASE_SCALES = [1.2, 1.1, 1] as const;
/** A cover is this wide (rem) at scale 1, and 7.5 rem wider for each whole step of scale. */
const COVER_REM = 11.5;
const COVER_PER_SCALE_REM = 7.5;
/** Each group of books adds a bookend and a gap. */
const GROUP_REM = 2.4;

/** One bookcase: shelves that stand side by side, as big as the books are drawn. */
export interface CasePlan {
  shelves: ShelfView[];
  /** A single shelf too wide for the page: its row scrolls. */
  scrolls: boolean;
}

/**
 * The width a bookcase needs: its books at `scale`, the bookends and gaps
 * between its groups, and room at both ends for the books to slide aside
 * when one is pulled out.
 */
export function caseWidth(shelves: ShelfView[], scale: number): number {
  const cover = COVER_REM + (scale - 1) * COVER_PER_SCALE_REM;
  const slack = 2 * (cover * 0.66 + 0.3);
  const books = shelves.flatMap((shelf) => shelf.books);
  return standingWidth(books) * scale + shelves.length * GROUP_REM + slack;
}

/**
 * Shelves into bookcases, in the catalog's order: each case takes shelves as
 * long as they fit the page, so a few books share one case and no case is
 * mostly empty; a shelf that is wider than the page has a case to itself and
 * scrolls. `scale` is one size for every book: the biggest that fits every case.
 */
export function packCases(shelves: ShelfView[]): { cases: CasePlan[]; scale: number } {
  const cases: CasePlan[] = [];
  for (const shelf of shelves) {
    const last = cases.at(-1);
    if (last && caseWidth([...last.shelves, shelf], 1) <= CASE_MAX_REM)
      last.shelves.push(shelf);
    else cases.push({ shelves: [shelf], scrolls: false });
  }
  for (const plan of cases) plan.scrolls = caseWidth(plan.shelves, 1) > CASE_MAX_REM;
  const scale =
    CASE_SCALES.find((s) =>
      cases.every((plan) => caseWidth(plan.shelves, s) <= CASE_MAX_REM),
    ) ?? 1;
  return { cases, scale };
}

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
  // The spine is as thick as the whole course reads. A lecture the reader may
  // not open counts as a typical one, so a locked book still stands on the shelf.
  const full = (lecture: BookLecture): number => lecture.minutes ?? NOMINAL_LECTURE_MINUTES;
  const minutes = course.locked ? undefined : sum(open.map((lecture) => lecture.minutes!));
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
