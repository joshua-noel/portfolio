import { whyLocked } from "../access.ts";
import type { Catalog, Course } from "./catalog.ts";
import { lectureUrl } from "./catalog.ts";
import {
  coverStyle,
  coverTitleSize,
  NOMINAL_LECTURE_MINUTES,
  numberOf,
  spineTitle,
  splitTitle,
  thickness,
  type CoverStyle,
} from "./cover.ts";

/**
 * The landing page's bookshelf as data: one book per course, in the catalog's
 * order (shelf by shelf), numbered from 01. It is built from a catalog that
 * `forViewer` has already cut down to what this reader may see, and it reads
 * only what a locked stub carries (a course's title, promise, shelf and
 * cover; a lecture's number, title and promise), so a book of a locked
 * course cannot show more.
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
  /** Place on the shelf from 0, and the two digits shown on its spine and cover. */
  index: number;
  number: string;
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
  /**
   * The course's `cover.svg`, already sanitised, as inline markup; empty for a
   * course with none and for a locked one (the loader sends nothing for it).
   */
  art: string;
  lectures: BookLecture[];
  /** Lectures the reader may open that have a video. */
  videos: number;
  /** Reading time of the whole course; absent when locked. */
  minutes?: number;
  /** Spine thickness as a fraction of the book's height. */
  thickness: number;
  /** Type size on the spine (a fraction of the book's height) and the columns the title takes. */
  spine: { size: number; lines: number };
  /** Type size of the title on the cover, a fraction of the book's height. */
  coverTitle: number;
}

export interface ShelfView {
  id: string;
  title: string;
  books: Book[];
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

function bookOf(course: Course, shelfTitle: string, index: number): Book {
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
  const spine = thickness(sum(lectures.map(full)));
  return {
    slug: front.slug,
    href: `/${front.slug}`,
    index,
    number: numberOf(index),
    title: front.title,
    main,
    sub,
    promise: front.promise,
    shelf: front.shelf,
    shelfTitle,
    locked: course.locked,
    why: course.locked ? whyLocked(front.visibility) : undefined,
    cover: coverStyle(front.cover),
    art: course.coverSvg,
    lectures,
    videos: open.filter((lecture) => lecture.video).length,
    minutes,
    thickness: spine,
    spine: spineTitle(main, spine),
    coverTitle: coverTitleSize(main),
  };
}

/** Every shelf that has a book, in the catalog's order, each book as its reader may see it, numbered across the shelves. */
export function buildShelves(catalog: Catalog): ShelfView[] {
  let index = 0;
  return catalog.shelves.map((shelf) => ({
    id: shelf.id,
    title: shelf.title,
    books: shelf.courses.map((course) => bookOf(course, shelf.title, index++)),
  }));
}
