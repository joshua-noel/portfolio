/** The courses (by slug) that have a drawing. */
export const DRAWN: string[];

/** The text of a course's cover.svg, or undefined when there is no drawing of it. */
export function coverSvg(slug: string, cover: { color: string; accent: string }): string | undefined;
