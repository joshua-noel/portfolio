# Learn site: QA pass

The checklist used for the polish pass. Repeat it before showing the site to anyone new. Every script drives headless Chrome through `test/helpers/browser.ts` (a DevTools client with no dependencies); screenshots go to `.data/learn-screenshots/polish/`.

## Set up

1. `pnpm install --frozen-lockfile`, then set `PORTFOLIO_LEARN_CONTENT_DIRS` to the content folder.
2. Production: `pnpm build`, then `node bin/serve.mjs` (set the `PORTFOLIO_*_URL` variables to `*.localhost:<port>`, and `PORTFOLIO_ADMIN_PASSWORD_HASH_FILE`). Development: `PORT=<port> pnpm learn:dev`. Check both: the dev page must be styled and work.
3. Use a copy of the content for the member and friend views: set `visibility: members` or `friends` on one lecture of the copy, and add `data-interactive="…"` to a diagram that lacks it. Never edit the real content. Make users with `node bin/user.mjs add <name> --role member|friend|admin`.
4. Ports 47400 to 47449 only. A page opened with the tool's CSP bypass is for experiments with injected style only; the real checks run with the policy on.
5. Every check ends with: zero Content-Security-Policy violations (`page.reportedViolations()`) and zero console errors (`page.errors`).

## Every page, every width

Widths 1440, 1280, 820, 390 and 360, dark and light, and with reduced motion on.

- [ ] No sideways page scroll: `document.documentElement.scrollWidth <= innerWidth` (less the scrollbar). Script it over all lectures at 360 and 390. Wide formulas, code, tables, display maths and diagrams scroll inside their own box, and the box takes keyboard focus. At 2560x1440 and 1920x1080 a code line of 100 to 110 characters does not scroll (measure with a fixture; see `docs/learn-v2-notes.md`).
- [ ] Look for the elements that stick out: walk `document.body` for boxes with `right > innerWidth` that no ancestor with `overflow` clips. Text with two `$` signs and no escape (`\$`) makes a very wide formula: that is a content mistake.
- [ ] Baseline of inline maths: screenshot a paragraph with several inline formulas before and after any change to the maths CSS. Only formulas that are too wide may become boxes.
- [ ] Line length 60 to 75 characters, heading rhythm, code size, table legibility.
- [ ] Reading time shown against `minutes` in the front matter (for a version 1 lecture, the four old numbers added up).
- [ ] Headings in order (no jump from h2 to h4), every diagram has a title and a description, every image has alt text.
- [ ] Nothing jumps on load. An old link with `?depth=` still loads the lecture, unchanged.

## Keyboard and screen reader

- [ ] Tab reaches every control, in reading order; the focus ring is visible (check `outline` or `box-shadow` of `document.activeElement` and look at one screenshot per component).
- [ ] Skip link, search (`/` focuses it, arrows move, Enter opens, Escape closes), "On this page" rail, check-yourself questions (open and close), citations (jump and back), previous and next, theme toggle, mobile drawer (Escape closes).
- [ ] No focus trap: Tab leaves every widget.
- [ ] Reduced motion: nothing slides or turns.

## Interactive diagrams

For each module in `src/scripts/learn-diagrams/` (a module loads only when its figure scrolls near, so scroll first): `node` script that Tabs to each control, then:

- slider: arrow keys change the value, Home and End reach the ends, the live sentence changes;
- toggle: Space flips it and flips it back;
- select: arrow keys change it;
- button: Space and Enter both work;
- Reset restores every value and the first sentence.

Then check by eye, at 360 px and in the light theme: the result is one or two short sentences in the body font at normal weight; the longer explanation is behind "How this is computed"; American spelling; arrowheads match their line; nothing overlaps or leaves its box.

## Diagrams in both themes

- [ ] Render every diagram (`figure.diagram`) in dark and light, into contact sheets (dark left, light right).
- [ ] Programmatic pass: text contrast against the fill under it (4.5 for small text), text wider than its box, overlapping labels, `--c6` use, marker color against line color.
- [ ] By eye: does each hue read as its meaning? `--c6` is a rose, the alert tone: it must not mark a thing that is fine, successful or neutral. Are two hues too close (CIE76 distance under 25)? Is a hue too dim in the light theme?

## Landing page and bookshelf

- [ ] The bookcase is centered or spans the content; a hovered or opened book does not hide a shelf name; neighbours step aside.
- [ ] A book that stepped aside can be clicked: `document.elementFromPoint` at its center returns that book (the next shelf must not lie over it).
- [ ] Click a book while it is moving: it still opens. Keyboard: arrows move along a shelf, Enter opens, Escape closes and returns focus.
- [ ] Filters, "continue where you left off", scroll arrows when a shelf is wider than the page.

## Behavior

- [ ] Search: real queries, open results, no results, Enter without the script.
- [ ] References: each citation jumps to its entry and back.
- [ ] Links: crawl every internal link and every `#anchor` on all lectures; report every dead one, and check that `?depth=` links still load.
- [ ] Video: player, captions on and off, poster, keyboard control (use a lecture of `agent-systems/video`).
- [ ] Sign-in page, wrong password (one message, no hint), sign-out; a locked lecture as a visitor (stub and sign-in link, nothing of the text); member and friend views; the 404 page.
- [ ] Print preview of a lecture: no navigation, diagrams visible, links shown, no cut-off boxes.

## Course alert hue

- [ ] A course that uses one hue for failing, hostile or wasted things says so in `course.md` (`alert: c6`). Render its alert-hue figures in both themes and look: that hue is the rose there, and the other courses show `--c6` as green. A hue that means "bad" in a course that did not declare it is a content mistake.
- [ ] `node bin/check-learn.mjs <content>` is clean: no inline maths that swallowed prose (write `\$2.50`), and every interactive diagram of `src/lib/learn/interactive.ts` is declared by its diagram file.

## Tests to run at the end

`pnpm check`, `pnpm test`. The browser test of the bookshelf (`in a browser: the books stand…`) must pass 20 times in a row under load (start `pnpm build` in a loop and busy loops beside it): it waits on state, never on time, and `page.settle()` makes every click and hover wait until nothing on the page is still sliding or scrolling.

## Runs

### 2026-11-24 (second pass, machine loaded by video renders)

- `pnpm check`: 0 errors, 0 warnings, 3 hints.
- Full `pnpm test`: 330 tests, 329 pass, 1 fail: "a lecture over the size limit is refused with a log line, and the host stays up", which asserts that a refused file costs under 10 s. It took 34 to 38 s with nine busy loops running, and passes alone on a quiet machine (9.6 s in all). It does not touch anything changed here.
- Bookshelf browser test, 20 runs in a row with nine busy loops and the machine's own load: 19 pass. The one failure (run 3) was `read ECONNRESET` in the test client, which reused an idle socket the server had just closed; the client now opens a new connection per request, and runs 4 to 20 all pass (17 in a row). The earlier "timed out waiting for the book turns" could not be made to happen in 40 fresh browsers under load; the test now waits for the page's own decision first (the book is marked as pulled), then for the draw with a 30 s limit, and prints what the page saw if it still times out.
- `node bin/check-learn.mjs` on the 40 lectures: 3 errors, all in `training-and-fine-tuning/07-reasoning-post-training.md` (lines 136 and 245: unescaped dollar amounts).
- Link crawl, all 40 lectures, the 5 course pages, the landing, search and sign-in pages, at 4 depths: 4,440 internal links, 14,248 in-page anchors, 389 distinct targets; no dead link, anchor or asset (apart from lecture 07 of training, which the checker leaves out).
- Page audit, all 40 lectures at 4 depths at 1440: no heading jump, no image without alt, no unnamed diagram, no anchor to something hidden at its depth, no sideways scroll, one h1; about 70 characters a line.
