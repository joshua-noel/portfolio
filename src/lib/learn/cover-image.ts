import { MOTIFS } from "./motifs.ts";
import type { Book } from "./bookshelf.ts";

/**
 * A book's front cover as ONE image: an SVG document drawn at 240 x 320, used
 * as the face's `background-image` through a `data:` URL (the page's
 * Content-Security-Policy allows `img-src data:` and nothing is fetched). The
 * browser rasterises it once, so a cover is a single texture however many
 * shapes and words it holds, where the same cover as markup was some forty
 * boxes and a small SVG per copy of the book. The words are also on the page
 * for anyone who needs them: the card's text, and the list of names a screen
 * reader and the keyboard use; the picture is decoration.
 *
 * Everything that comes from a course (colours, title, promise) is escaped or
 * checked (colours are `#rrggbb` by `coverStyle`), and the illustration is the
 * loader's sanitised `cover.svg`, so the document holds no script, link or
 * reference to anything outside it; as an image it could not run one anyway.
 */

const FONT = "system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const W = 240;
const H = 320;
const MARGIN = 21.4;

const xml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const num = (n: number): string => String(Math.round(n * 100) / 100);

/** Words onto lines of at most `max` characters; more than `lines` lines are cut with an ellipsis. */
export function wrap(text: string, max: number, lines = 99): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (line !== "" && (line + " " + word).length > max) {
      out.push(line);
      line = word;
    } else line = line === "" ? word : line + " " + word;
  }
  if (line !== "") out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = kept[lines - 1]!.replace(/[\s.,;:]*$/, "").slice(0, Math.max(1, max - 1)) + "…";
  return kept;
}

/** The cover as SVG text. */
export function coverSvgText(book: Book): string {
  const { cover } = book;
  const size = book.coverTitle * H;
  const titleLines = wrap(book.main, Math.floor((W - 2 * MARGIN) / (size * 0.58)), 4);
  const top = 0.125 * H;
  const subSize = 0.0225 * H;
  const subTop = top + titleLines.length * size * 1.05 + 0.02 * H;
  const sub = wrap(book.promise, Math.floor(((W - 2 * MARGIN) * 0.92) / (subSize * 0.5)), 2);
  const lectures = `${book.lectures.length} lecture${book.lectures.length === 1 ? "" : "s"}`;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${xml(FONT)}">`,
    `<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".2"/><stop offset=".016" stop-color="#000" stop-opacity="0"/><stop offset=".024" stop-color="#fff" stop-opacity=".08"/><stop offset=".04" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="b" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="${cover.color}"/><rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#a)"/>`,
  ];
  if (book.art) parts.push(book.art.trim());
  else if (book.locked) {
    // A thin padlock in a ring where the picture would be.
    parts.push(
      `<g fill="none" stroke="${cover.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".8">` +
        `<circle cx="120" cy="${num(0.46 * H)}" r="${num(0.13 * H)}"/>` +
        `<rect x="106" y="${num(0.46 * H - 4)}" width="28" height="22" rx="4"/><path d="M111 ${num(0.46 * H - 4)}v-6a9 9 0 0 1 18 0v6"/></g>`,
    );
  } else {
    const paths = MOTIFS[cover.motif] ?? [];
    const s = (0.3 * H) / 64;
    parts.push(
      `<g transform="translate(${num(120 - 32 * s)} ${num(0.46 * H - 32 * s)}) scale(${num(s)})" fill="none" stroke="${cover.mark}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">` +
        paths.map((d) => `<path d="${xml(d)}"/>`).join("") +
        `</g>`,
    );
  }
  // Series mark (three bars, the first in the accent) and the number.
  const m = 0.024 * H;
  const y = 0.056 * H + m * 0.8;
  parts.push(
    `<g fill="${cover.ink}"><rect x="${MARGIN}" y="${num(y - m * 0.85)}" width="${num(m * 1.1)}" height="${num(m * 0.28)}" rx="1" fill="${cover.mark}"/>` +
      `<rect x="${MARGIN}" y="${num(y - m * 0.44)}" width="${num(m * 0.84)}" height="${num(m * 0.28)}" rx="1"/>` +
      `<rect x="${MARGIN}" y="${num(y - m * 0.03)}" width="${num(m * 0.57)}" height="${num(m * 0.28)}" rx="1"/></g>`,
    `<text x="${num(MARGIN + m * 1.65)}" y="${num(y)}" font-size="${num(m)}" font-weight="700" letter-spacing=".04em" fill="${cover.ink}">Learn</text>`,
    `<text x="${num(W - MARGIN)}" y="${num(y)}" font-size="${num(m)}" font-weight="700" text-anchor="end" fill="${cover.ink}">${xml(book.number)}</text>`,
  );
  titleLines.forEach((line, i) =>
    parts.push(
      `<text x="${MARGIN}" y="${num(top + size * 0.88 + i * size * 1.05)}" font-size="${num(size)}" font-weight="750" letter-spacing="-.015em" fill="${cover.ink}">${xml(line)}</text>`,
    ),
  );
  sub.forEach((line, i) =>
    parts.push(
      `<text x="${MARGIN}" y="${num(subTop + subSize * 0.95 + i * subSize * 1.36)}" font-size="${num(subSize)}" fill="${cover.inkSoft}">${xml(line)}</text>`,
    ),
  );
  const foot = 0.0185 * H;
  const fy = H - 0.05 * H;
  parts.push(
    `<line x1="${MARGIN}" x2="${W - MARGIN}" y1="${num(fy - foot - 0.014 * H)}" y2="${num(fy - foot - 0.014 * H)}" stroke="${cover.ink}" stroke-opacity=".28"/>`,
    `<text x="${MARGIN}" y="${num(fy)}" font-size="${num(foot)}" font-weight="650" letter-spacing=".08em" fill="${cover.ink}">${xml(book.shelfTitle.toUpperCase())}</text>`,
    `<text x="${num(W - MARGIN)}" y="${num(fy)}" font-size="${num(foot)}" font-weight="650" letter-spacing=".08em" text-anchor="end" fill="${cover.ink}">${xml(lectures.toUpperCase())}</text>`,
    `</svg>`,
  );
  return parts.join("");
}
