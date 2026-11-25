# Learn v2: where the work stands

Branch `feat/learn-v2`, worktree `.tmp/sitev2`. Plan: one continuous lecture (no depths), then a bare, quiet interface in the style of `style-bible-reference.png`. Contract: `learn-content/CONTRACT.md` version 2.

STATUS: ALL FOUR STEPS ARE DONE and committed, plus the coordinator's scale, top-bar, landing, rail and video items. No server from this worktree is left running (ports 48000 and 48001 stopped). The scratch folder under `D:\SundayMarket\scratch\learn\SiteV2\` is deleted at the end.

## Step 1: lecture format version 2 (done, commit 6a0501cd44)

- `src/lib/learn/lecture.ts`: `format: 2` in front matter selects version 2. `minutes` is one integer. Hard errors: sections present and in order (`In brief`, numbered sections with `Worked example` allowed between, `Limits and open questions`, `In practice`, `Explain it back`, `Interview questions`, `Check yourself`, `References`), 6 to 14 numbered sections, word ranges (In brief 150-350, whole lecture 3,000-9,000, Limits 200-900, In practice 200-700), exactly 5 check-yourself, 3-5 explain-it-back, 4-8 interview questions, at least 4 diagrams, plus the old rules. Warnings: In brief with formulas or code, explain-it-back without "A good explanation covers:" and bullets, text under References.
- Words counted by `proseWords` over every `##` section incl. questions; whole lecture = sum of all sections.
- Version 1 files render as ONE page: old Tip under a synthesised `## In brief`, then Waterline, Deep, Abyss, then Check yourself and References; Deep/Abyss numbers run on (`Heading.shown`). `front.minutes` = sum of four.
- `Lecture.html`, `.toc` (with `shown`), `.words`; `segments`/`minutesAt`/depth helpers gone; `depth.ts` keeps `DEPTHS`/`Depth` for the v1 reader only.
- `cover.svg`: `readCover` (viewBox `0 0 240 320`, no text, sanitiser); `Course.coverSvg`, EMPTY for a course the reader may not open (decision for the bookshelf task: change in `forViewer` if covers should show on locked books).
- `bin/check-learn.mjs`: "(N still version 1)" per course and total; `--words` or `--course` prints words per section for version 2 lectures (always for a failing one).
- Tests: `test/learn-lecture-v2.test.ts`, `test/helpers/lecture-v2.ts`, `test/check-learn.test.ts`.

## Step 2: depths removed from the site (done, commit 647533e9f2)

- Removed: DepthSwitch, `?depth=` handling (ignored; test proves old links load identically), depth colours and CSS (`--d-*`, layers, tip-go, toc-layer, toc toggle), depth wording on landing/course/bookshelf, depth code in `learn.js`, `learn-init.js`, bookshelf script.
- Lecture page: header (crumb `Course · Lecture N`, h1, promise, `N min read`, "Objectives" plain h2 + list, prereq), video, `<article class="prose" set:html={lecture.html}>`, footer (mark read, pager without arrows), `<aside class="toc">` ("On this page", no toggle button). Landing: h1, one plain sentence, bookshelf.
- Reading time is one number everywhere (`class="rt"` in bookshelf lists, `data-minutes` on a book).
- Left in the old CSS until step 3 rewrites it: everything else (still coral/serif look). `docs/learn-qa.md` still mentions depths: rewrite in step 4.

## Step 3: restyle (done; the decisions below are what was built; rules in `docs/learn-style.md`)

Decisions made (from sampling the style bible with the headless browser):
- Dark: `--bg #1b1a1f` (page, topbar), left rail / search / `--bg-sunken #161618`, `--surface #222127`, `--fg #f0efed`, `--muted #a9a8ae`, `--text-3 #8c8b93`, `--accent` (the ONE muted link/current colour) `#a5a8f6` (reference `#aaacff`), `--line rgba(255,255,255,.09)`, `--border rgba(255,255,255,.22)`, `--code-bg #151418`. Light: `--bg #fff`, `--surface #f5f5f7`, `--bg-sunken #f1f1f4`, `--fg #1b1a1f`, `--muted #55545c`, `--text-3 #66656e`, `--accent #4547c7`, `--code-bg #f6f6f8`. Keep token names (tests read them: bg, surface, bg-sunken, fg, muted, text-3, accent, on-accent, focus, code-bg, c1-c6, alert, border/line as rgba). Drop `--success` (remove from `test/learn-contrast.test.ts` coloured list). Keep `--font-text` (serif) ONLY for the bookshelf covers. UI and prose: system UI stack; mono for code. Radius at most 4px. No shadows/gradients.
- Layout: body flex column `min-height:100dvh`; `.shell` grid `[rail-l] [centre] [rail-r]`, rails `position:sticky; top:var(--topbar); height:calc(100dvh - var(--topbar)); overflow:auto`, `--rail-l: clamp(14rem,13vw,18rem)`, `--rail-r: clamp(13rem,11vw,16rem)`; footer last (margin-top auto). Root font 100%, 106.25% from 1800px, 112.5% from 2300px. `scrollbar-gutter: stable`.
- Prose measure `--measure: 38rem` (check 70-80 chars). `.prose` is a 3-track grid (`1fr | min(measure,100%) | 1fr`); wide blocks (`pre`, `.table-wrap` max 64rem, `.math-block`, `figure.diagram`, video) take `grid-column: 1/-1; justify-self:center; width:max-content; min-width:min(100%,measure); max-width:100%` so a 100-110 char code line fits at 1440p and 1920x1080 (measure with a fixture; ~100 chars expected at 1440 wide).
- Remove: eyebrow caps, boxed objectives (plain list), callout boxes (`.callout`: plain indent, bold lead-in), question circles (plain summary, reset counter `q` at each h2), diagram box/gradients (no fill, figcaption muted), `.tag` chip (plain muted text), pager boxes (plain text links), progress marks in grey only, placeholder banner as plain paragraph.
- Nav markup to change: shelf `h2.part-title` (bold plain), course `p.course-title` (rename from part-title), current = `--accent` colour only. TOC: hairline at left, current = accent. Right rail gone below 1100px; left rail drawer below 800px (existing JS `data-nav-toggle`, `.is-open`, `.scrim`).
- Bookshelf: rename `.pill` to a plain text toggle (`filter-option`), `.filters` centred over the bookcase, current marked like a current nav item (`aria-pressed=true` -> accent); delete the dead `.intro-text` rule; do not touch the bookcase, motion or covers. `[data-filters]` must stay hidden without JS (an e2e test checks it).
- `.dg-controls`: grey native range (`accent-color: var(--muted)`), plain text buttons with thin outline; behaviour unchanged.
- Update `test/learn-contrast.test.ts` to the new palette; write `docs/learn-style.md` (palette, type scale, spacing, forbidden list).

## Step 4: prove it (TODO)

Full `pnpm test` + `pnpm check`; link/anchor crawl from `docs/learn-qa.md` over `learn-content-stable` (rewrite the qa doc's depth parts); screenshots into `.data\learn-screenshots\v2\` at 2560x1440, 1920x1080, 1440x900, 820, 390, dark and light: landing, course, long lecture top+middle (code, table, maths, diagram, interactive diagram, video; convert lectures 01-03 of how-language-models-work to version 2 in scratch for this), search results, sign-in, locked lecture as a visitor (scratch copy with one `friends` lecture), 404, print preview; verify with `pnpm build` + `node bin/serve.mjs` AND `pnpm learn:dev` (content dir = stable copy, ports 48000-48049, 127.0.0.1); zero CSP violations/console errors; side-by-side with the style bible and list of kept differences; list served/in-page files changed for the security re-sweep: `src/lib/learn/{lecture,render,blocks,catalog,disk,bookshelf,depth}.ts`, `src/pages/learn/**`, `src/layouts/Learn.astro`, `src/components/learn/*`, `src/scripts/learn.js`, `learn-init.js`, `learn-bookshelf/index.js`, CSS. Sanitisers (`sanitize.ts`, `svg.ts`), `access.ts`, auth and the CSP were NOT changed.

## Step 3 measured (dev server, stable-copy content)

- Code that fits without scrolling (characters per line in a code block): 199 at 2560x1440, 152 at 1920x1080, 108 at 1440x900. Prose measure `--measure: 35rem`, about 72 to 80 characters a line.
- No sideways page scroll at 2560, 1920, 1440, 820, 390 in dark and light. The footer is at the bottom of the window on landing, sign-in, 404, search with no results and locked pages.

## Step 4 results

- Production (`pnpm build` + `node bin/serve.mjs`, stable content, port 48001) and `pnpm learn:dev` (stable content, port 48000): link and anchor crawl of the landing, search, sign-in, 5 course pages and 40 lectures: about 5,100 internal links, 3,885 in-page anchors, 0 dead links, 0 dead anchors; every lecture loads identically with `?depth=tip|waterline|deep|abyss`. Zero Content-Security-Policy violations. The only console errors are the browser's own log of the 404 and 403 pages.
- Type and measure: root 16px up to 1280 wide, growing to 21px at 2560 (`clamp(1rem, 0.6875rem + 0.390625vw, 1.3125rem)`); prose measure 36rem. At 2560x1440: prose 20.9px, column 754px (29.5% of the window), code fits 163 characters without scrolling. At 1920x1080: 18.4px, 664px (34.6%), 135 characters. At 1440x900: 16.6px, 596px (41%), 103 characters. About 74 to 78 characters a line.
- Screenshots: `.data/learn-screenshots/v2/` (all sizes, both themes), `prod/` (production server), `dev/`, `print-lecture-*.png`, `side-by-side-bible-vs-lecture.png`.

## Differences from the style bible that were kept

- The bible is a macOS window with a rounded frame and shadow; the site is the page itself.
- Prose is 30% of the window at 2560 (the bible's is 32% of its window, at a smaller type size): a wider column would break the 75 to 80 character line. The rest of the centre is for code, tables, diagrams and video, which the bible has none of.
- Top bar: shelf names instead of "Part 0 .. Part IV"; no language menu and no GitHub icon; the theme control is an icon button, not a switch; the search hint is "/" (the key that focuses it), not a badge.
- Left rail: shelves, then courses, then the lectures of the current course; the bible lists the chapters of one course. Titles in "On this page" wrap instead of being cut with an ellipsis.
- Link colour `#a5a8f6` is a little more muted than the bible's `#aaacff`; it passes AA on every surface.
- Colour is kept only where the brief allows it: diagrams and figures, code syntax, book covers and video. The bookcase on the landing page is untouched.
