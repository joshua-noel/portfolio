/** The courses (by slug) that have a drawing. */
export const DRAWN: string[];

/** The stroke weight, in canvas units, on every cover. */
export const SW: number;

/** The art frame on the 240 x 320 canvas: where a cover's drawing is fitted. */
export const FRAME: { x: number; y: number; w: number; h: number };

/** The text of a course's cover.svg, or undefined when there is no drawing of it. */
export function coverSvg(slug: string, cover: { color: string; accent: string }): string | undefined;

/** Where a cover's drawing sits on the canvas: its box [x0, y0, x1, y1] (stroke included), the frame, and the scale it was drawn at. */
export function coverBox(
  slug: string,
  cover: { color: string; accent: string },
): { box: [number, number, number, number]; frame: { x: number; y: number; w: number; h: number }; scale: number } | undefined;
