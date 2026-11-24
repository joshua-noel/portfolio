import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDiagram } from "../src/lib/learn/lecture.ts";
import { sanitizeSvg } from "../src/lib/learn/svg.ts";
import { Renderer } from "../src/lib/learn/render.ts";

const OK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" role="img" aria-labelledby="t d"><title id="t">T</title><desc id="d">D</desc><defs><marker id="m" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0L4 2L0 4z" fill="currentColor"/></marker><linearGradient id="g"><stop offset="0" stop-color="var(--c1)"/></linearGradient></defs><g transform="translate(1 1)"><rect x="1" y="1" width="9" height="9" rx="2" fill="var(--c1)" stroke="var(--border)" style="fill:var(--surface);stroke-width:2"/><text x="5" y="5" font-size="3" text-anchor="middle">Hi<tspan dy="1">there</tspan></text><line x1="0" y1="0" x2="9" y2="9" marker-end="url(#m)"/><use href="#m"/><circle cx="5" cy="5" r="2" fill="url(#g)" data-k="3" class="a b"/></g></svg>`;

const wrap = (inner: string): string => OK.replace("</svg>", `${inner}</svg>`);
const issues = (svg: string): string => checkDiagram("01-d", svg).join("\n");

test("a plain diagram passes, and what is inlined is the sanitiser's own output", () => {
  assert.deepEqual(checkDiagram("01-d", OK), []);
  const { html, issues: none } = sanitizeSvg(OK);
  assert.deepEqual(none, []);
  assert.match(html, /^<svg /);
  assert.match(html, /viewBox="0 0 100 50"/);
  assert.match(html, /<use href="#m">/);
});

// Every one of these is a way to run script, or to fetch something, from a diagram.
const HOSTILE: [string, string, RegExp][] = [
  ["script", wrap("<script>alert(1)</script>"), /script/i],
  ["upper-case script", wrap("<SCRIPT>alert(1)</SCRIPT>"), /script/i],
  ["mixed-case script", wrap("<ScRiPt>alert(1)</sCrIpT>"), /script/i],
  ["foreignObject", wrap("<foreignObject><div>x</div></foreignObject>"), /foreignObject/i],
  ["upper-case foreignObject", wrap("<FOREIGNOBJECT></FOREIGNOBJECT>"), /foreignObject/i],
  ["style element", wrap("<style>*{fill:red}</style>"), /style/i],
  ["onload on the svg", OK.replace("<svg ", '<svg onload="alert(1)" '), /event handler onload/],
  ["ONCLICK on a rect", wrap('<rect ONCLICK="alert(1)" width="1" height="1"/>'), /onclick/i],
  ["onmouseover, single quotes", wrap("<rect onmouseover='x()' width='1' height='1'/>"), /onmouseover/],
  ["javascript href, single quotes", wrap("<a href='javascript:alert(1)'><rect/></a>"), /<a>|href/],
  ["javascript href on use", wrap('<use href="javascript:alert(1)"/>'), /href/],
  ["xlink:href javascript", wrap('<use xlink:href="javascript:alert(1)"/>'), /href/],
  ["xlink:href external", wrap('<use xlink:href="https://evil.test/x.svg#a"/>'), /href/],
  ["href external on use", wrap('<use href="//evil.test/x.svg#a"/>'), /href/],
  ["href with a tab in the scheme", wrap('<use href="java&#9;script:alert(1)"/>'), /href/],
  ["href on a rect", wrap('<rect href="#m" width="1" height="1"/>'), /href/],
  ["set targeting href", wrap('<a><set attributeName="href" to="javascript:alert(1)"/></a>'), /<set>|<a>/],
  ["animate targeting href", wrap('<use href="#m"><animate attributeName="href" values="javascript:alert(1)"/></use>'), /<animate>/],
  ["animateTransform", wrap('<animateTransform attributeName="transform"/>'), /animateTransform/i],
  ["embedded image", wrap('<image href="data:image/png;base64,AAAA"/>'), /image/i],
  ["iframe in svg", wrap('<iframe src="https://evil.test"></iframe>'), /iframe/i],
  ["html element breaking out", wrap("<p>hello</p>"), /<p>/],
  ["math element", wrap("<math><mi>x</mi></math>"), /<math>/],
  ["style attribute with url", wrap('<rect width="1" height="1" style="fill:url(https://evil.test/x)"/>'), /style/],
  ["style attribute with import", wrap('<rect width="1" height="1" style="fill:red;@import \'x\'"/>'), /style/],
  ["style attribute with expression", wrap('<rect width="1" height="1" style="width:expression(alert(1))"/>'), /style/],
  ["style attribute, unlisted property", wrap('<rect width="1" height="1" style="background:red"/>'), /background/],
  ["style attribute with an escape", wrap('<rect width="1" height="1" style="fill:\\75rl(x)"/>'), /style/],
  ["fill with an external url", wrap('<rect width="1" height="1" fill="url(https://evil.test/x#a)"/>'), /fill/],
  ["a second svg inside", wrap("<svg viewBox='0 0 1 1'></svg>"), /exactly one <svg>/],
  ["text after the svg", `${OK}<p>after</p>`, /<p>|outside/],
  ["unknown attribute", wrap('<rect width="1" height="1" srcdoc="x"/>'), /srcdoc/],
  ["a bad namespace", OK.replace("http://www.w3.org/2000/svg", "http://evil.test/"), /xmlns/],
];

for (const [name, svg, expected] of HOSTILE) {
  test(`a diagram is rejected at load: ${name}`, () => {
    const text = issues(svg);
    assert.notEqual(text, "", "no issue reported");
    assert.match(text, expected);
    // And nothing is inlined for it.
    assert.equal(sanitizeSvg(svg).html, "");
  });
}

test("comments in a diagram are dropped, not carried into the page", () => {
  const { html, issues: none } = sanitizeSvg(OK.replace("<defs>", "<!-- a note --><defs>"));
  assert.deepEqual(none, []);
  assert.ok(!html.includes("<!--"));
});

// ---------------------------------------------------------------------------
// Lecture Markdown: raw HTML is for <details> and a little inline formatting.

const render = (markdown: string): Promise<string> =>
  new Renderer().render(markdown, "waterline");

test("the details block and basic inline HTML survive", async () => {
  const html = await render(
    "<details><summary>Why?</summary>Because <b>bold</b> and <i>it</i> and <kbd>Ctrl</kbd>.</details>\n\nPlain **text** with <sub>2</sub>.",
  );
  assert.match(html, /<details><summary>Why\?<\/summary>/);
  assert.match(html, /<b>bold<\/b>/);
  assert.match(html, /<kbd>Ctrl<\/kbd>/);
  assert.match(html, /<strong>text<\/strong>/);
  assert.match(html, /<sub>2<\/sub>/);
});

test("KaTeX output survives, with its classes and styles", async () => {
  const html = await render("Inline $x^2$ and\n\n$$\\frac{a}{b}$$\n");
  assert.match(html, /<span class="katex">/);
  assert.match(html, /<math /);
  assert.match(html, /style="[^"]*height:/);
  assert.match(html, /<annotation encoding="application\/x-tex">x\^2<\/annotation>/);
});

const HOSTILE_MD: [string, string, RegExp[]][] = [
  ["script block", "<script>alert(1)</script>\n\nafter", [/<script/i, /alert\(1\)/]],
  ["upper-case script", "<SCRIPT>alert(2)</SCRIPT>", [/<script/i, /alert\(2\)/]],
  ["inline script", "text <script>alert(3)</script> more", [/<script/i, /alert\(3\)/]],
  ["event handler", '<p onclick="alert(4)">x</p>', [/onclick/i, /alert\(4\)/]],
  ["img onerror", '<img src="x" onerror="alert(5)">', [/onerror/i, /alert\(5\)/]],
  ["details ontoggle", '<details open ontoggle="alert(6)"><summary>s</summary>b</details>', [/ontoggle/i, /alert\(6\)/]],
  ["javascript link in html", '<a href="javascript:alert(7)">x</a>', [/javascript:/i]],
  ["javascript link, tab in scheme", '<a href="java&#9;script:alert(8)">x</a>', [/script:/i]],
  ["javascript link in markdown", "[x](javascript:alert(9))", [/javascript:/i]],
  ["data link", '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', [/data:text/i]],
  ["iframe", '<iframe src="https://evil.test"></iframe>', [/<iframe/i, /evil\.test/]],
  ["object and embed", '<object data="x"></object><embed src="y">', [/<object/i, /<embed/i]],
  ["svg with script", '<svg onload="alert(10)"><script>alert(11)</script></svg>', [/<svg/i, /alert\(1[01]\)/, /onload/i]],
  ["style element", "<style>body{display:none}</style>", [/<style/i, /display:none/]],
  ["style attribute", '<p style="position:fixed;inset:0">x</p>', [/style=/i, /position/i]],
  ["form", '<form action="https://evil.test"><input name="a"></form>', [/<form/i, /evil\.test/]],
  ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.test">', [/<meta/i, /evil\.test/]],
  ["base", '<base href="https://evil.test/">', [/<base/i, /evil\.test/]],
  ["link", '<link rel="stylesheet" href="https://evil.test/x.css">', [/<link/i, /evil\.test/]],
  ["id that shadows the page", '<p id="__proto__" name="cookie">x</p>', [/name=/i]],
];

for (const [name, markdown, banned] of HOSTILE_MD) {
  test(`hostile Markdown is made harmless: ${name}`, async () => {
    const html = await render(markdown);
    for (const pattern of banned) {
      assert.ok(!pattern.test(html), `${pattern} survives in: ${html}`);
    }
  });
}

test("ordinary links and images keep working", async () => {
  const html = await render(
    "[site](https://example.com/a) [rel](/c/l) [frag](#x) [mail](mailto:a@b.test)\n\n![alt](/media/c/01-l.png)",
  );
  assert.match(html, /href="https:\/\/example\.com\/a"/);
  assert.match(html, /href="\/c\/l"/);
  assert.match(html, /href="#x"/);
  assert.match(html, /href="mailto:a@b\.test"/);
  assert.match(html, /<img src="\/media\/c\/01-l\.png" alt="alt">/);
});
