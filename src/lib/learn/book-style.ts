import type { Book } from "./bookshelf.ts";

/**
 * The custom properties a book's styles read: its colours (always `#rrggbb`,
 * made so by `coverStyle`, so nothing else can reach a style attribute), its
 * spine thickness and its type sizes, as fractions of the book's height.
 */
export const bookStyle = (book: Book): string =>
  `--b-color:${book.cover.color};--b-accent:${book.cover.accent};--b-ink:${book.cover.ink};` +
  `--b-soft:${book.cover.inkSoft};--b-mark:${book.cover.mark};--b-band-ink:${book.cover.bandInk};` +
  `--t:${book.thickness};--b-fs:${book.spine.size};--b-cs:${book.coverTitle}`;
