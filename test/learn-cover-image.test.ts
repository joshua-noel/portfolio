import { test } from "node:test";
import assert from "node:assert/strict";
import { coverSvgText, wrap } from "../src/lib/learn/cover-image.ts";
import { coverStyle, coverTitleSize, numberOf, spineTitle, thickness } from "../src/lib/learn/cover.ts";
import { readCover } from "../src/lib/learn/lecture.ts";
import { coverSvg } from "../tools/learn-covers/generate.mjs";
import type { Book } from "../src/lib/learn/bookshelf.ts";

const art = readCover(coverSvg("system-design", { color: "#2a6fb5", accent: "#f4f2ed" })!).html;
const book = (over: Partial<Book> = {}): Book => ({
  slug: "c", href: "/c", index: 2, number: numberOf(2), title: "A <b>bold</b> & \"odd\" title: sub", main: "A <b>bold</b> & \"odd\" title",
  promise: "Promise with <script>alert(1)</script> and a long tail ".repeat(4), shelf: "systems", shelfTitle: "Sys & Co", locked: false,
  cover: coverStyle({ color: "#ece9e1", accent: "#c8372d", motif: "grid" }), art, lectures: [{ slug: "l", href: "/c/l", order: 1, title: "L", promise: "p", locked: false, placeholder: false, video: false, minutes: 10 }],
  videos: 0, minutes: 10, thickness: thickness(10), spine: spineTitle("x", thickness(10)), coverTitle: coverTitleSize("A title"), ...over,
});

test("a cover is one SVG image of the book's own words and picture, with nothing from a course able to break out of it", () => {
  const svg = coverSvgText(book());
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="240" height="320"/);
  // The course's words are text, escaped.
  assert.doesNotMatch(svg, /<script|<b>|alert\(1\)<\/|onload=/i);
  assert.match(svg, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(svg, /&amp;/);
  assert.match(svg, /&quot;odd&quot;/);
  assert.match(svg, />03</, "its number");
  assert.match(svg, /SYS &amp; CO/);
  assert.match(svg, /1 LECTURE</);
  // The illustration is inside it, and the colours are the course's.
  assert.ok(svg.includes(art.trim()));
  assert.ok(svg.includes('fill="#ece9e1"'));
  assert.doesNotMatch(svg, /href=|url\(["']?https?:|@import|<image|<foreignObject/i);
  // Text on a light cover is dark.
  assert.match(svg, /fill="#15161a"/);
});

test("a locked cover has no illustration, only a padlock; one with no illustration has its motif", () => {
  const locked = coverSvgText(book({ locked: true, art: "" }));
  assert.doesNotMatch(locked, /ART|<g transform/);
  assert.match(locked, /<circle cx="120"/);
  const plain = coverSvgText(book({ art: "" }));
  assert.match(plain, /<g transform="translate\(/);
});

test("long titles and promises are wrapped and cut", () => {
  assert.deepEqual(wrap("one two three four", 9), ["one two", "three", "four"]);
  const cut = wrap("aaaa bbbb cccc dddd eeee ffff", 9, 2);
  assert.equal(cut.length, 2);
  assert.match(cut[1]!, /…$/);
  assert.ok(coverSvgText(book({ main: "x ".repeat(80) })).split("<text").length < 20, "a very long title is cut to a few lines");
});
