import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, start, type Server } from "./helpers/server.ts";
import { Browser, findBrowser, type Page } from "./helpers/browser.ts";
import { visibilityLibrary, writeLibrary } from "./helpers/fixtures.ts";

/**
 * The main site, the blog and Learn are one place: one token source, one top
 * bar, one footer, one theme switch. A real build, a real server, a real
 * browser, the three hostnames loaded the way a reader loads them.
 */
if (process.env.PORTFOLIO_SKIP_E2E) process.exit(0);

const library = mkdtempSync(join(tmpdir(), "portfolio-unify-library-"));
writeLibrary(library, visibilityLibrary());

let out: string;
let server: Server;
let browser: Browser | undefined;

before(async () => {
  out = build({ PORTFOLIO_LEARN_CONTENT_DIRS: library });
  server = await start({ out, contentDirs: [library] });
});

after(async () => {
  await browser?.close();
  await server?.stop();
});

const NO_BROWSER = findBrowser()
  ? false
  : "no Chrome, Chromium or Edge found (set PORTFOLIO_TEST_BROWSER)";

/** The three hostnames: a page of each, one that is not Learn's landing page, so the bar is the reading one. */
const PAGES = [
  ["main", "http://site.test/"],
  ["blog", "http://blog.test/"],
  ["learn", "http://learn.test/c-public/l-public"],
  ["learn sign-in", "http://learn.test/signin"],
] as const;

async function pageAt(
  url: string,
  theme: "dark" | "light" | null,
  options: { width?: number; height?: number; reducedMotion?: boolean } = {},
): Promise<Page> {
  if (!browser) {
    const executable = findBrowser();
    assert.ok(executable, "no browser");
    browser = await Browser.launch(executable, { host: "*", port: server.port });
  }
  const page = await browser.newPage({
    width: 1440,
    height: 900,
    ...options,
    headers: { "x-forwarded-proto": "https" },
  });
  // Stored the way the switch stores it, on this host, before the page is read.
  await page.goto(new URL("/robots.txt", url).href);
  await page.evaluate(
    theme ? `localStorage.setItem("learn-theme", "${theme}")` : `localStorage.removeItem("learn-theme")`,
  );
  await page.goto(url);
  await page.settle();
  return page;
}

const read = (name: string): string => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");

/** The values tokens.css gives, as the browser reports a colour. */
function tokenValues(theme: "dark" | "light"): Record<string, string> {
  const css = read("tokens.css");
  const block = (selector: string): string => {
    const start = css.indexOf(`\n${selector}`);
    return css.slice(start, css.indexOf("\n}", start));
  };
  const found: Record<string, string> = {};
  const blocks = theme === "dark" ? [block(":root,")] : [block(":root,"), block(':root[data-theme="light"]')];
  for (const body of blocks)
    for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) found[name!] = value!.trim();
  return found;
}

const rgb = (hex: string): string => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

interface Look {
  bodyBackground: string;
  bodyColor: string;
  bodyFont: string;
  rootFontSize: string;
  line: string;
  border: string;
  accent: string;
  focus: string;
  radius: string;
  topbarRems: number;
  topbarBackground: string;
  topbarBorder: string;
  brandFont: string;
  footerColor: string;
  footerFontSize: string;
  footerBorder: string;
  footerPadding: string;
  toggleCount: number;
  topbars: number;
  footers: number;
}

const LOOK = `(() => {
  // A scrollbar or none moves vw by a fraction of a pixel; the look is compared to the pixel.
  const px = (v) => String(v).replace(/\\d+\\.\\d+/g, (n) => Math.round(Number(n)));
  const css = (el, p) => px(getComputedStyle(el)[p]);
  const root = document.documentElement;
  const bar = document.querySelector("header.topbar");
  const foot = document.querySelector("footer.footer");
  const brand = bar.querySelector(".brand .site");
  return {
    bodyBackground: css(document.body, "backgroundColor"),
    bodyColor: css(document.body, "color"),
    bodyFont: css(document.body, "fontFamily"),
    rootFontSize: css(root, "fontSize"),
    line: getComputedStyle(root).getPropertyValue("--line"),
    border: getComputedStyle(root).getPropertyValue("--border"),
    accent: getComputedStyle(root).getPropertyValue("--accent"),
    focus: getComputedStyle(root).getPropertyValue("--focus"),
    radius: getComputedStyle(root).getPropertyValue("--radius"),
    topbarRems: Math.round((bar.getBoundingClientRect().height / parseFloat(getComputedStyle(root).fontSize)) * 10) / 10,
    topbarBackground: css(bar, "backgroundColor"),
    topbarBorder: css(bar, "borderBottomColor") + " " + css(bar, "borderBottomWidth"),
    brandFont: css(brand, "fontSize") + " " + css(brand, "fontFamily"),
    footerColor: css(foot, "color"),
    footerFontSize: css(foot, "fontSize"),
    footerBorder: css(foot, "borderTopColor") + " " + css(foot, "borderTopWidth"),
    footerPadding: css(foot, "padding"),
    toggleCount: document.querySelectorAll("[data-theme-toggle]").length,
    topbars: document.querySelectorAll("header.topbar").length,
    footers: document.querySelectorAll("footer.footer").length,
  };
})()`;

for (const theme of ["dark", "light"] as const) {
  test(
    `${theme}: the main site, the blog and Learn read the same tokens, and have the same bar and footer`,
    { skip: NO_BROWSER },
    async () => {
      const tokens = tokenValues(theme);
      const looks: [string, Look][] = [];
      for (const [name, url] of PAGES) {
        const page = await pageAt(url, theme);
        try {
          assert.equal(await page.evaluate("document.documentElement.dataset.theme"), theme, `${name}: theme`);
          looks.push([name, await page.evaluate<Look>(LOOK)]);
          assert.deepEqual(page.errors, [], `${name}: console errors`);
          assert.deepEqual(await page.reportedViolations(), [], `${name}: policy violations`);
        } finally {
          await page.close();
        }
      }
      const [firstName, first] = looks[0]!;
      for (const [name, look] of looks.slice(1)) assert.deepEqual(look, first, `${name} differs from ${firstName}`);
      // And they are the values of the one file.
      assert.equal(first.bodyBackground, rgb(tokens.bg!));
      assert.equal(first.bodyColor, rgb(tokens.fg!));
      assert.equal(first.accent, tokens.accent);
      assert.equal(first.focus, tokens.focus);
      assert.equal(first.radius, tokens.radius);
      assert.equal(first.topbarRems, 3.5, "a 3.5rem bar");
      assert.equal(first.toggleCount, 1);
      assert.equal(first.topbars, 1);
      assert.equal(first.footers, 1);
    },
  );
}

test("no stylesheet but tokens.css defines a colour or a font stack of the site", () => {
  for (const name of ["chrome.css", "global.css", "blog.css"]) {
    const css = read(name);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${name}: a hex colour`);
    assert.doesNotMatch(css, /\b(?:rgba?|hsla?|oklch|oklab)\(/, `${name}: a colour function`);
    assert.doesNotMatch(css, /font-family:(?!\s*(?:var\(|inherit))/, `${name}: a font stack`);
  }
});

test("the theme is dark by default, the switch changes it, and the choice is kept on that host", { skip: NO_BROWSER }, async () => {
  for (const [name, url] of PAGES) {
    const page = await pageAt(url, null);
    try {
      assert.equal(await page.evaluate("document.documentElement.dataset.theme"), "dark", `${name}: default`);
      await page.click("[data-theme-toggle]");
      assert.equal(await page.evaluate("document.documentElement.dataset.theme"), "light", `${name}: switched`);
      assert.equal(await page.evaluate("localStorage.getItem('learn-theme')"), "light");
      await page.goto(url);
      assert.equal(await page.evaluate("document.documentElement.dataset.theme"), "light", `${name}: kept`);
      assert.deepEqual(page.errors, [], name);
    } finally {
      await page.close();
    }
  }
});

test("at 360 px wide nothing overflows sideways, on any host", { skip: NO_BROWSER }, async () => {
  for (const [name, url] of PAGES) {
    for (const theme of ["dark", "light"] as const) {
      const page = await pageAt(url, theme, { width: 360, height: 780 });
      try {
        const over = await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
        assert.ok(over <= 0, `${name} ${theme}: ${over}px too wide`);
      } finally {
        await page.close();
      }
    }
  }
});

test("the icons of the main site are one colour, the text colour of where they stand, in both themes", { skip: NO_BROWSER }, async () => {
  for (const theme of ["dark", "light"] as const) {
    const page = await pageAt("http://site.test/", theme);
    try {
      const result = await page.evaluate<{ icons: number; bad: string[]; chips: string[] }>(`(() => {
        const bad = [], chips = [];
        const icons = [...document.querySelectorAll(".work-icon svg, .contact-card-logo svg")];
        const fg = getComputedStyle(document.body).color;
        for (const svg of icons) {
          const s = getComputedStyle(svg);
          const p = svg.querySelector("path, circle");
          const ps = getComputedStyle(p);
          const ink = s.fill !== "none" ? ps.fill : ps.stroke;
          if (s.color !== fg || ink !== fg) bad.push(svg.parentElement.className + " " + s.color + " " + ink);
          for (let e = svg.parentElement; e && e !== document.body; e = e.parentElement) {
            const bg = getComputedStyle(e).backgroundColor;
            if (bg !== "rgba(0, 0, 0, 0)") chips.push(e.className + " " + bg);
          }
        }
        return { icons: icons.length, bad, chips };
      })()`);
      assert.ok(result.icons >= 10, `${theme}: ${result.icons} icons`);
      assert.deepEqual(result.bad, [], `${theme}: coloured icons`);
      assert.deepEqual(result.chips, [], `${theme}: icons on a coloured chip`);
    } finally {
      await page.close();
    }
  }
});

test("Chaperone is named, linked to its repository, and Access Broker is nowhere in the built site or its pages", async () => {
  const gone = /access[\s-]+broker/i;
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(?:m?js|css|html|json|xml|txt|svg|map)$/i.test(entry)) files.push(path);
    }
  };
  walk(out);
  assert.ok(files.length > 20, "the built files were found");
  for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), gone, file);

  for (const [host, path] of [
    ["site", "/"],
    ["blog", "/"],
    ["site", "/sitemap.xml"],
    ["blog", "/rss.xml"],
    ["learn", "/"],
  ] as const) {
    const res = await server.request(host, "GET", path);
    assert.doesNotMatch(res.text, gone, `${host}${path}`);
  }
  const home = (await server.request("site", "GET", "/")).text;
  assert.match(home, /<a href="https:\/\/github\.com\/joshua-noel\/chaperone">Chaperone<\/a>/);
  assert.match(home, /Apache-2\.0/);
});

test("the shelf's floor shadow fades to nothing on every side of its box: no hard edge, no band", () => {
  const css = readFileSync(new URL("../src/styles/learn-bookshelf.css", import.meta.url), "utf8");
  const rule = /\n\.floor \{([^}]*)\}/.exec(css)?.[1] ?? "";
  const gradient = /background:\s*radial-gradient\(([\s\S]*?)\);\s*pointer-events/.exec(rule)?.[1] ?? "";
  // Centred in its box, reaching the nearest side at 100%: every edge of the box is on the last stop.
  assert.match(gradient, /^\s*ellipse closest-side at 50% 50%,/);
  const stops = [...gradient.matchAll(/^\s*(?:ellipse[^,]*,\s*)?(.+?)\s+(\d+)%,?\s*$/gm)];
  assert.ok(stops.length >= 4, "a bell of several stops");
  assert.match(gradient.trimEnd(), /transparent 100%$/, "ends on nothing");
  // And it is a bell: each stop is no stronger than the one before it.
  const strengths = [...gradient.matchAll(/(?:var\(--pool\)|--pool\) (\d+)%)/g)].map((m) => Number(m[1] ?? 100));
  for (let i = 1; i < strengths.length; i++) assert.ok(strengths[i]! <= strengths[i - 1]!, "stops fade out");
});
