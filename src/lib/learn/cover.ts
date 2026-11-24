import { resolveMotif } from "./motifs.ts";

/**
 * What a book looks like, worked out from a course's own `cover` and title:
 * colours that stay readable, a motif, a split title, a thickness. Pure, so the
 * page and the tests use the same code, and nothing here reads a lecture.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

/** What a cover falls back to when the front matter is not a hex colour (the loader refuses that, but a style attribute is no place to trust). */
export const DEFAULT_COVER = { color: "#2b2f3a", accent: "#e0a43a", motif: "layers" };

const LIGHT_INK = "#fbfaf7";
const DARK_INK = "#15161a";

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** `amount` (0 to 1) of `a` mixed into `b`, as `#rrggbb`. */
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return (
    "#" +
    x
      .map((v, i) =>
        Math.round(v * amount + y[i]! * (1 - amount))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** Soft light or dark text, whichever reads better; pure white or black only for a mid-tone that neither soft one can carry. */
function pickInk(color: string): string {
  const best = (inks: string[]): string =>
    inks.reduce((a, b) => (contrast(b, color) > contrast(a, color) ? b : a));
  const soft = best([LIGHT_INK, DARK_INK]);
  return contrast(soft, color) >= 4.5 ? soft : best(["#ffffff", "#000000"]);
}

export interface CoverStyle {
  color: string;
  accent: string;
  /** Text on the cover: whichever of light and dark reads better on `color`. */
  ink: string;
  /** Secondary text; at least 4.5:1 on `color`, like `ink`. */
  inkSoft: string;
  /** For drawings: the accent when it can be seen on `color`, else `ink`. */
  mark: string;
  /** The motif that is drawn: the one named, or one chosen from its name. */
  motif: string;
}

export function coverStyle(cover: {
  color: string;
  accent: string;
  motif: string;
}): CoverStyle {
  const color = HEX.test(cover.color) ? cover.color.toLowerCase() : DEFAULT_COVER.color;
  const accent = HEX.test(cover.accent)
    ? cover.accent.toLowerCase()
    : DEFAULT_COVER.accent;
  const ink = pickInk(color);
  const soft = mix(ink, color, 0.8);
  return {
    color,
    accent,
    ink,
    inkSoft: contrast(soft, color) >= 4.5 ? soft : ink,
    mark: contrast(accent, color) >= 3 ? accent : ink,
    motif: resolveMotif(cover.motif),
  };
}

/** "Agent Systems: Tools and Harnesses" is a title and a subtitle, as on a book. */
export function splitTitle(title: string): { main: string; sub?: string } {
  const at = title.indexOf(": ");
  if (at < 3) return { main: title.trim() };
  const sub = title.slice(at + 2).trim();
  return sub === ""
    ? { main: title.slice(0, at).trim() }
    : { main: title.slice(0, at).trim(), sub };
}

/** What a lecture is assumed to take when its minutes are not shown: a typical one at Abyss. */
export const NOMINAL_LECTURE_MINUTES = 26;

export const THICKNESS = { min: 2.6, max: 6, perMinute: 0.018 } as const;

/** Spine width in rem for a course of `minutes` reading: proportional, within limits that keep a book findable and a shelf unbroken. */
export function thicknessRem(minutes: number): number {
  const raw = Math.max(0, minutes) * THICKNESS.perMinute;
  return Math.round(Math.min(THICKNESS.max, Math.max(THICKNESS.min, raw)) * 100) / 100;
}

/** A small fixed number from a name, so a book always looks the same. */
export function hashName(name: string): number {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Spine height in rem: books on a shelf differ a little, and always the same little. */
export function heightRem(slug: string, base = 17): number {
  const wobble = (hashName(slug) % 1000) / 1000; // 0 to 1
  return Math.round(base * (0.94 + wobble * 0.06) * 100) / 100;
}

/**
 * How a title is set down a spine: the biggest type that fits in one, two or
 * three lines of the room there is between the motif and the count, and the
 * number of lines that gives it. Widths are estimates for a bold serif, kept
 * on the cautious side so a title is cut by its ellipsis rather than overflows.
 */
export function spineTitle(
  main: string,
  thickness: number,
  height: number,
): { size: number; lines: number } {
  const room = height - 7.4;
  let best = { size: 0, lines: 1 };
  for (const lines of [1, 2, 3]) {
    const perLine = Math.ceil(main.length / lines);
    const size = Math.min(
      room / (perLine * 0.58),
      (thickness - 0.9) / (lines * 1.15),
      1.1,
    );
    if (size > best.size + 0.001) best = { size, lines };
  }
  return { size: Math.round(Math.max(0.64, best.size) * 100) / 100, lines: best.lines };
}

/** Size in rem of a title on a cover, from how long it is. */
export function coverTitleSize(main: string): number {
  if (main.length > 40) return 0.98;
  if (main.length > 26) return 1.1;
  return 1.28;
}
