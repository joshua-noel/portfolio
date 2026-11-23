/**
 * The four depths of every lecture, shallowest first. Each one adds to the
 * one before it, except Tip, which is a short text of its own.
 */
export const DEPTHS = ["tip", "waterline", "deep", "abyss"] as const;

export type Depth = (typeof DEPTHS)[number];

export const DEFAULT_DEPTH: Depth = "waterline";

export const DEPTH_LABELS: Record<Depth, string> = {
  tip: "Tip",
  waterline: "Waterline",
  deep: "Deep",
  abyss: "Abyss",
};

export const DEPTH_HINTS: Record<Depth, string> = {
  tip: "Two minutes, no jargon",
  waterline: "How it works, with diagrams",
  deep: "The mechanism, exactly",
  abyss: "Edge cases and open questions",
};

/** The depth named by a `?depth=` value; anything else is no choice at all. */
export function parseDepth(value: string | null | undefined): Depth | undefined {
  return DEPTHS.find((depth) => depth === value);
}

/** Whether text written for `layer` is visible when reading at `depth`. */
export function visibleAt(layer: Depth, depth: Depth): boolean {
  if (layer === "tip" || depth === "tip") return layer === depth;
  return DEPTHS.indexOf(layer) <= DEPTHS.indexOf(depth);
}
