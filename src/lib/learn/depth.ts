/**
 * The four sections of a version 1 lecture, in file order. The site no longer
 * shows them as depths: a lecture is one page. They remain only so the loader
 * can read, check and join the files that are not converted yet.
 */
export const DEPTHS = ["tip", "waterline", "deep", "abyss"] as const;

export type Depth = (typeof DEPTHS)[number];
