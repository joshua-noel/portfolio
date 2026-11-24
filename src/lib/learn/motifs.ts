/**
 * The small drawings on a book: one per `cover.motif` a course may name.
 * Each is line art on a 64 x 64 grid, as SVG path data, drawn with a round
 * 3-unit stroke in whatever colour the page gives it. They are original: no
 * outside artwork is used anywhere on a cover.
 */

/** A circle as path data, so every motif is paths only. */
const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const MOTIFS: Readonly<Record<string, readonly string[]>> = {
  // Text cut into pieces of different lengths.
  tokens: [
    "M6 14h14v11H6z",
    "M25 14h21v11H25z",
    "M50 14h8v11h-8z",
    "M6 30h22v11H6z",
    "M33 30h11v11H33z",
    "M49 30h9v11h-9z",
    "M6 46h10v11H6z",
    "M21 46h25v11H21z",
  ],
  // Nodes joined by edges.
  graph: [
    "M15 17 32 33M49 13 32 33M32 33 51 51M32 33 13 50",
    circle(15, 17, 6),
    circle(49, 13, 5),
    circle(32, 33, 7),
    circle(51, 51, 6),
    circle(13, 50, 5),
  ],
  // Three sheets stacked, seen from the side.
  layers: ["M32 7 58 19 32 31 6 19z", "M6 31 32 43 58 31", "M6 43 32 55 58 43"],
  waves: [
    "M4 19q7-11 14 0t14 0t14 0t14 0",
    "M4 33q7-11 14 0t14 0t14 0t14 0",
    "M4 47q7-11 14 0t14 0t14 0t14 0",
  ],
  grid: ["M8 8h48v48H8z", "M24 8v48M40 8v48M8 24h48M8 40h48"],
  // Traces that turn at right angles, ending in pads.
  circuit: [
    "M10 20h16l8 8v14h20",
    "M10 44h10l6 6h10",
    "M32 10v10h14l6 6",
    circle(10, 20, 3),
    circle(54, 42, 3),
    circle(10, 44, 3),
    circle(52, 26, 3),
    circle(32, 10, 3),
    circle(46, 50, 3),
  ],
  orbit: [
    "M32 14c16 0 28 8 28 18s-12 18-28 18S4 42 4 32s12-18 28-18z",
    "M20 8c8-3 20 8 26 24s6 28-2 24c-8-4-14-14-20-30S14 10 20 8z",
    circle(32, 32, 6),
    circle(54, 24, 3),
  ],
  // Three blocks, one on another.
  stack: ["M14 8h36v12H14z", "M8 26h48v12H8z", "M14 44h36v12H14z"],
  lock: ["M13 28h38v28H13z", "M21 28V20a11 11 0 0 1 22 0v8", circle(32, 42, 4)],
  // An arrow that comes back to where it began.
  loop: ["M52 32a20 20 0 1 1-6-14", "M48 6v13H35"],
  // The same thing at three sizes, each closer to the work.
  cache: ["M24 24h16v16H24z", "M14 14h36v36H14z", "M4 4h56v56H4z"],
  "boxes-and-arrows": [
    "M6 8h20v14H6z",
    "M38 8h20v14H38z",
    "M22 42h20v14H22z",
    "M26 15h12M16 22v8h32v-8M32 30v12",
    "M28 38l4 4 4-4",
  ],
  // A staircase down to the lowest point.
  "gradient-steps": ["M6 10h12v12h12v12h12v12h14", circle(56, 46, 3)],
};

export const MOTIF_NAMES: readonly string[] = Object.keys(MOTIFS);

/** The motif a course names, or one chosen from its name when it names none we draw. */
export function resolveMotif(name: string): string {
  if (Object.hasOwn(MOTIFS, name)) return name;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MOTIF_NAMES[h % MOTIF_NAMES.length]!;
}
