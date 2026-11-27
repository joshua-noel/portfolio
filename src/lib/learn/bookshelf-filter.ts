import type { ShelfView } from "./bookshelf.ts";

/**
 * The capsule above the shelf. Its options do not hide books: each one takes
 * the shelf to the first book of a group, and the lit option follows the book
 * in front, whichever way it got there. Pure and free of the catalog's
 * imports, so the page's script can use the very functions the tests do.
 */

export interface Pill {
  key: string;
  label: string;
  /** Place on the shelf of the first book of the group. */
  first: number;
}

/** All (the first book), then each shelf that has a book. */
export function filterPills(shelves: ShelfView[]): Pill[] {
  const pills: Pill[] = [{ key: "all", label: "All", first: 0 }];
  let first = 0;
  for (const shelf of shelves) {
    if (shelf.books.length > 0) {
      pills.push({ key: `shelf:${shelf.id}`, label: shelf.title, first });
    }
    first += shelf.books.length;
  }
  return pills;
}

/** The key of the lit option when the book at `index` is in front: the last group that starts at or before it. */
export function litPill(pills: Pill[], index: number): string {
  let lit = pills[0]?.key ?? "all";
  for (const pill of pills.slice(1)) if (pill.first <= index) lit = pill.key;
  return lit;
}
