import type { ShelfView } from "./bookshelf.ts";

/**
 * Which books show. Pure and free of the catalog's imports, so the page's
 * script can use the very functions the tests do.
 */

/** What the pills choose: everything, one shelf, or what has a video. */
export type BookFilter =
  { kind: "all" } | { kind: "shelf"; id: string } | { kind: "video" };

export const ALL: BookFilter = { kind: "all" };

/** Whether a book stays on the shelf under `filter`. */
export function matchesFilter(
  book: { shelf: string; videos: number },
  filter: BookFilter,
): boolean {
  if (filter.kind === "shelf") return book.shelf === filter.id;
  if (filter.kind === "video") return book.videos > 0;
  return true;
}

/** The shelves under `filter`, in the same order; a shelf left with no book is gone. */
export function filterShelves(shelves: ShelfView[], filter: BookFilter): ShelfView[] {
  return shelves
    .map((shelf) => ({
      ...shelf,
      books: shelf.books.filter((book) => matchesFilter(book, filter)),
    }))
    .filter((shelf) => shelf.books.length > 0);
}

/** The pills: All, each shelf that has a book, and Has video when any book has one. */
export function filterPills(
  shelves: ShelfView[],
): { filter: BookFilter; label: string; key: string }[] {
  const pills: { filter: BookFilter; label: string; key: string }[] = [
    { filter: ALL, label: "All", key: "all" },
    ...shelves.map((shelf) => ({
      filter: { kind: "shelf", id: shelf.id } as BookFilter,
      label: shelf.title,
      key: `shelf:${shelf.id}`,
    })),
  ];
  if (shelves.some((shelf) => shelf.books.some((book) => book.videos > 0))) {
    pills.push({ filter: { kind: "video" }, label: "Has video", key: "video" });
  }
  return pills;
}

/** A pill's key back to its filter (the page keeps keys in attributes); anything else is All. */
export function filterFromKey(key: string | undefined): BookFilter {
  if (key === "video") return { kind: "video" };
  if (key?.startsWith("shelf:")) return { kind: "shelf", id: key.slice(6) };
  return ALL;
}
