import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, start, type Server } from "./helpers/server.ts";
import { Browser, findBrowser, type Page } from "./helpers/browser.ts";
import { SECRET, visibilityLibrary, writeLibrary } from "./helpers/fixtures.ts";

/**
 * The main site, the blog and Learn are one place: one token source, one top
 * bar, one footer, one theme switch. A real build, a real server, a real
 * browser, the three hostnames loaded the way a reader loads them.
 */
if (process.env.PORTFOLIO_SKIP_E2E) process.exit(0);

const library = mkdtempSync(join(tmpdir(), "portfolio-unify-library-"));
// The public course has a second lecture, to move from one lecture to the next.
const courses = visibilityLibrary();
courses[0]!.lectures.push({ order: 2, slug: "l-public-2", title: "Lecture public two", visibility: "public", secret: SECRET.public });
writeLibrary(library, courses);

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
  options: { width?: number; height?: number; reducedMotion?: boolean; recordReveals?: boolean } = {},
): Promise<Page> {
  if (!browser) {
    const executable = findBrowser();
    assert.ok(executable, "no browser");
    browser = await Browser.launch(executable, { host: "*", port: server.port });
  }
  const { recordReveals, ...pageOptions } = options;
  const page = await browser.newPage({
    width: 1440,
    height: 900,
    ...pageOptions,
    headers: { "x-forwarded-proto": "https" },
  });
  // Stored the way the switch stores it, on this host, before the page is read.
  await page.goto(new URL("/robots.txt", url).href);
  await page.evaluate(
    theme ? `localStorage.setItem("learn-theme", "${theme}")` : `localStorage.removeItem("learn-theme")`,
  );
  // Before the page itself loads, so the first document is one of those that report.
  if (recordReveals) await page.onNewDocument(RECORD);
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

test("the footer of the shelf page credits the two posts it was inspired by, as plain links", async () => {
  const shelf = (await server.request("learn", "GET", "/")).text;
  const footer = /<footer class="footer">[\s\S]*?<\/footer>/.exec(shelf)?.[0] ?? "";
  assert.match(footer, /Shelf design inspired by/);
  for (const [url, handle] of [
    ["https://x.com/sahil0x01/status/2124697500229759375", "@sahil0x01"],
    ["https://x.com/vineerpasam/status/2124902293254594759", "@vineerpasam"],
  ] as const) {
    assert.match(footer, new RegExp(`<a href="${url.replace(/[.]/g, "\\.")}" rel="noopener noreferrer">${handle}</a>`));
  }
  // Plain links: nothing from those sites is embedded, scripted or loaded as an image.
  assert.doesNotMatch(shelf, /<(?:script|img|iframe|link)[^>]*(?:x\.com|twitter\.com)/i);
  // Only the shelf page has the line.
  assert.doesNotMatch((await server.request("learn", "GET", "/c-public/l-public")).text, /Shelf design inspired by/);
  const policy = (await server.request("learn", "GET", "/")).headers["content-security-policy"] as string;
  assert.match(policy, /default-src 'self'/);
  assert.doesNotMatch(policy, /x\.com|twitter/);
});

// ---------------------------------------------------------------- page transitions

test("the page transitions are CSS in Learn's stylesheet, honour reduced motion, and the script that names the direction is a file", async () => {
  const learn = read("learn.css");
  assert.match(learn, /@view-transition\s*\{\s*navigation:\s*auto;\s*\}/);
  assert.match(
    learn,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*@view-transition\s*\{\s*navigation:\s*none;\s*\}\s*\}/,
    "no transition at all for a reader who asks for less motion",
  );
  for (const name of ["topbar", "sidenav", "toc"]) assert.match(learn, new RegExp(`view-transition-name:\\s*${name};`));
  for (const type of ["rise", "descend"]) assert.match(learn, new RegExp(`:active-view-transition-type\\(${type}\\)`));
  // About 250 to 400 ms, and the shelf's own spring as the easing of the move.
  const seconds = (name: string): number => Number(new RegExp(`--${name}:\\s*([\\d.]+)s`).exec(learn)?.[1]);
  assert.ok(seconds("vt") >= 0.25 && seconds("vt") <= 0.4, `--vt ${seconds("vt")}s`);
  assert.ok(seconds("vt-fast") >= 0.15 && seconds("vt-fast") <= 0.3, `--vt-fast ${seconds("vt-fast")}s`);
  assert.match(learn, /animation:\s*vt-rise var\(--vt\) var\(--spring\)/);
  assert.match(learn, /:root \{[^}]*--spring: linear\(/s);
  assert.doesNotMatch(read("learn-bookshelf.css"), /--spring: linear\(/, "one definition of the spring");
  // The other two hostnames have none of it.
  for (const name of ["chrome.css", "global.css", "blog.css", "tokens.css"]) assert.doesNotMatch(read(name), /view-transition/);

  // On every Learn page the script is a file in <head>, and no script is inline: the policy needs nothing new.
  for (const path of ["/", "/c-public", "/c-public/l-public", "/signin"]) {
    const res = await server.request("learn", "GET", path);
    const head = /<head>[\s\S]*?<\/head>/.exec(res.text)?.[0] ?? "";
    assert.match(head, /<script src="\/_astro\/learn-transitions\.[\w-]+\.js"><\/script>/, path);
    assert.doesNotMatch(res.text, /<script(?![^>]*\bsrc=)[^>]*>\s*\S/, `${path}: an inline script`);
    assert.match(String(res.headers["content-security-policy"]), /script-src 'self'(;|$)/);
  }
  // The main site and the blog do not load it.
  for (const host of ["site", "blog"] as const) assert.doesNotMatch((await server.request(host, "GET", "/")).text, /learn-transitions/);
});

const RECORD = `window.addEventListener("pagereveal", (e) => {
  const note = (what) => { try { sessionStorage.setItem("vt", JSON.stringify({ what, path: location.pathname })); } catch {} };
  if (!e.viewTransition) return note({ transition: false });
  e.viewTransition.ready.then(() => note({ transition: true, types: [...e.viewTransition.types] }), () => note({ transition: "skipped" }));
});`;

/** Navigates the way a link does, and waits for the new document. */
async function go(page: Page, path: string): Promise<void> {
  await page.evaluate(`sessionStorage.removeItem("vt"); setTimeout(() => location.assign(${JSON.stringify(path)}), 0); 1`);
  await page.waitFor(`document.readyState === "complete" && location.pathname === ${JSON.stringify(path)}`, `arrive at ${path}`);
}

async function seen(page: Page): Promise<{ what: { transition: boolean | string; types?: string[] }; path: string }> {
  await page.waitFor(`sessionStorage.getItem("vt")`, "the page reveal", 5000, `location.href + " " + JSON.stringify(Object.entries(sessionStorage)) + " " + document.readyState`);
  return JSON.parse(await page.evaluate<string>(`sessionStorage.getItem("vt")`));
}

test(
  "in a browser: up into a lecture, down on the way back, a cross-fade from one lecture to the next, and every script starts once",
  { skip: NO_BROWSER },
  async () => {
    const page = await pageAt("http://learn.test/", "dark", { recordReveals: true });
    try {
      const front = (): Promise<string> =>
        page.evaluate<string>(`document.querySelector('.names button[aria-current="true"]')?.getAttribute('aria-label') ?? ''`);
      const number = async (): Promise<number> => Number.parseInt((await front()).slice(0, 2), 10);

      // The shelf to a lecture rises.
      await go(page, "/c-public/l-public");
      let reveal = await seen(page);
      assert.deepEqual(reveal.what, { transition: true, types: ["rise"] }, "shelf to lecture");
      // Scripts start once: one press of the theme switch is one change, not two.
      const before = await page.evaluate<string>("document.documentElement.dataset.theme");
      await page.click("[data-theme-toggle]");
      assert.notEqual(await page.evaluate("document.documentElement.dataset.theme"), before, "the switch changed the theme once");
      await page.click("[data-theme-toggle]");
      assert.equal(await page.evaluate("document.documentElement.dataset.theme"), before);

      // Back to the shelf descends; the shelf's own script has started once (one arrow, one book).
      await page.evaluate(`sessionStorage.removeItem("vt"); history.back(); 1`);
      await page.waitFor(`location.pathname === "/" && document.readyState === "complete"`, "back at the shelf");
      reveal = await seen(page);
      assert.deepEqual(reveal.what, { transition: true, types: ["descend"] }, "lecture back to the shelf");
      await page.waitFor("document.querySelectorAll('.names button').length >= 3", "the books");
      await page.settle();
      const at = await number();
      await page.press("ArrowRight");
      await page.waitFor(`Number.parseInt((${"document.querySelector('.names button[aria-current=\"true\"]')?.getAttribute('aria-label') ?? ''"}).slice(0, 2), 10) !== ${at}`, "the next book");
      await page.settle();
      assert.equal(await number(), at + 1, "one arrow moves one book");

      // A course page to a lecture rises; one lecture to the next is the quiet cross-fade.
      await go(page, "/c-public");
      await go(page, "/c-public/l-public");
      assert.deepEqual((await seen(page)).what, { transition: true, types: ["rise"] }, "course to lecture");
      await go(page, "/c-public/l-public-2");
      assert.deepEqual((await seen(page)).what, { transition: true, types: ["fade"] }, "lecture to lecture");
      assert.deepEqual(page.errors, [], "console errors");
      assert.deepEqual(await page.reportedViolations(), [], "policy violations");
    } finally {
      await page.close();
    }
  },
);

test("in a browser: a reader who asks for less motion gets no transition", { skip: NO_BROWSER }, async () => {
  const page = await pageAt("http://learn.test/", "dark", { reducedMotion: true, recordReveals: true });
  try {
    await go(page, "/c-public/l-public");
    assert.deepEqual((await seen(page)).what, { transition: false });
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------- stealth release

test("the stealth switch: off is today's behaviour, on hides Learn from search and from the other two hosts, private needs an account", async () => {
  const stop: Server[] = [];
  try {
    // OFF (the default): the lecture host is indexable, announced and linked.
    const off = await server.request("learn", "GET", "/");
    assert.equal(off.headers["x-robots-tag"], undefined);
    assert.match(off.text, /<meta property="og:title"/);
    assert.match((await server.request("site", "GET", "/")).text, /href="https:\/\/learn\.test\/"/);
    assert.match((await server.request("site", "GET", "/sitemap.xml")).text, /learn\.test/);
    assert.doesNotMatch((await server.request("learn", "GET", "/robots.txt")).text, /Disallow: \/\n/);

    // ON.
    const on = await start({ out, contentDirs: [library], env: { PORTFOLIO_LEARN_STEALTH: "1" } });
    stop.push(on);
    for (const path of ["/", "/c-public", "/c-public/l-public", "/signin", "/nothing-here"]) {
      const res = await on.request("learn", "GET", path);
      assert.equal(res.headers["x-robots-tag"], "noindex, nofollow, noarchive", path);
      if (res.headers["content-type"]?.toString().includes("html")) {
        assert.match(res.text, /<meta name="robots" content="noindex, nofollow, noarchive"/, path);
        assert.doesNotMatch(res.text, /og:|twitter:/, `${path}: no preview card`);
      }
    }
    assert.equal((await on.request("learn", "GET", "/robots.txt")).text, "User-agent: *\nDisallow: /\n");
    assert.equal((await on.request("learn", "GET", "/sitemap.xml")).status, 404);
    assert.equal((await on.request("learn", "GET", "/rss.xml")).status, 404);
    assert.equal((await on.request("learn", "GET", "/c-public/l-public")).status, 200, "on is not access control");
    for (const [host, path] of [["site", "/"], ["site", "/sitemap.xml"], ["site", "/robots.txt"], ["blog", "/"], ["blog", "/rss.xml"], ["blog", "/sitemap.xml"]] as const) {
      const res = await on.request(host, "GET", path);
      assert.equal(res.status, 200, `${host}${path}`);
      assert.doesNotMatch(res.text, /learn\.test/i, `${host}${path} names the Learn host`);
      assert.doesNotMatch(res.text, />\s*Learn\s*</, `${host}${path} has a Learn link`);
    }
    // resume.pdf names no Learn host either.
    assert.doesNotMatch((await on.request("site", "GET", "/resume.pdf")).text, /learn\.test/i);

    // PRIVATE.
    const priv = await start({ out, contentDirs: [library], env: { PORTFOLIO_LEARN_STEALTH: "private" } });
    stop.push(priv);
    assert.equal(priv.user(["add", "mia", "--role", "member"], { password: "correct horse battery" }).status, 0);
    for (const path of ["/", "/c-public", "/c-public/l-public", "/search", "/search.json", "/covers/c-public.svg", "/media/c-public/x.mp4", "/zzz"]) {
      const res = await priv.request("learn", "GET", path);
      assert.equal(res.status, 404, path);
      assert.equal(res.text, "Not found", `${path}: the bare 404, which does not name the site`);
    }
    assert.equal((await priv.request("learn", "GET", "/signin")).status, 200);
    assert.equal((await priv.request("learn", "GET", "/robots.txt")).status, 200);
    const login = await priv.request("learn", "POST", "/signin", {
      form: { username: "mia", password: "correct horse battery", next: "/" },
      origin: "https://learn.test",
      headers: { "x-forwarded-for": "198.51.100.77" },
    });
    const cookie = login.cookies.find((c) => c.startsWith("__Host-learn_session="))?.split(";")[0] ?? "";
    assert.ok(cookie, "signed in");
    assert.equal((await priv.request("learn", "GET", "/c-public/l-public", { cookie })).status, 200);
    assert.equal((await priv.request("learn", "GET", "/c-members/l-members", { cookie })).status, 200, "the existing visibility rules still decide");
    assert.equal((await priv.request("learn", "GET", "/c-friends/l-friends", { cookie })).status, 403, "and a member still cannot read a friends lecture");
  } finally {
    for (const s of stop) await s.stop();
  }
});

test("a mistyped stealth value refuses to start", async () => {
  // Through the production launcher, which checks it before the socket opens.
  await assert.rejects(
    start({ out, contentDirs: [library], env: { PORTFOLIO_LEARN_STEALTH: "maybe" }, viaLauncher: true }),
    /PORTFOLIO_LEARN_STEALTH must be/,
  );
});
