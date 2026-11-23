import type { Lecture } from "./lecture.ts";

export interface Hit {
  /** The address, `/course/lecture`. */
  url: string;
  title: string;
  promise: string;
  /** A stretch of the text around the first match, or empty when only the title matched. */
  snippet: string;
}

const tokens = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);

const SNIPPET_BEFORE = 50;
const SNIPPET_LENGTH = 160;

/**
 * Ranks lectures against a query. Every word must appear somewhere in the
 * lecture; a word in the title counts most, then the promise, then the body.
 * Small enough to run per keystroke over a whole book: plain substring scans.
 */
export function search(lectures: readonly Lecture[], query: string, limit = 8): Hit[] {
  const words = tokens(query);
  if (words.length === 0) return [];

  const hits: (Hit & { score: number })[] = [];
  for (const lecture of lectures) {
    // A locked lecture has no text to search, and its title is not a secret
    // only because it is listed anyway: it is not offered as a result.
    if (lecture.locked) continue;
    const title = lecture.front.title.toLowerCase();
    const promise = lecture.front.promise.toLowerCase();
    const body = lecture.text.toLowerCase();

    let score = 0;
    let first = -1;
    let matchedAll = true;
    for (const word of words) {
      const inTitle = title.includes(word);
      const inPromise = promise.includes(word);
      const at = body.indexOf(word);
      if (!inTitle && !inPromise && at === -1) {
        matchedAll = false;
        break;
      }
      score += (inTitle ? 10 : 0) + (inPromise ? 3 : 0) + (at === -1 ? 0 : 1);
      if (first === -1 && at !== -1 && !inTitle) first = at;
    }
    if (!matchedAll) continue;

    const start = Math.max(0, first - SNIPPET_BEFORE);
    const snippet =
      first === -1
        ? ""
        : `${start > 0 ? "…" : ""}${lecture.text
            .slice(start, start + SNIPPET_LENGTH)
            .replace(/\s+/g, " ")
            .trim()}…`;
    hits.push({
      url: `/${lecture.course}/${lecture.slug}`,
      title: lecture.front.title,
      promise: lecture.front.promise,
      snippet,
      score,
    });
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...hit }) => hit);
}
