# Learn: the style rules

The learn site looks like a plain documentation page: `style-bible-reference.png` in `learn-plan`. This file is the short rule set `src/styles/learn.css` follows. Keep to it. `test/learn-contrast.test.ts` checks the palette and bans the worst slips.

## Colour

The chrome has greys and ONE link colour. Colour lives only in diagrams and figures (`--c1` to `--c6`, `--alert`), code syntax, book covers and video.

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg` | `#1b1a1f` | `#ffffff` | page, top bar |
| `--bg-sunken` | `#161618` | `#f1f1f4` | left rail, search box, inline code |
| `--surface` | `#222127` | `#f5f5f7` | hover rows in search results; diagram fills |
| `--fg` | `#f0efed` | `#1b1a1f` | text, headings |
| `--muted` | `#a9a8ae` | `#55545c` | navigation, captions, secondary text |
| `--text-3` | `#8c8b93` | `#66656e` | numbers, hints, footer |
| `--accent` | `#a5a8f6` | `#4547c7` | links and the current item. Nothing else is coloured |
| `--line` | white at 9% | ink at 10% | hairline dividers |
| `--border` | white at 24% | ink at 30% | outlines of inputs and buttons |
| `--code-bg` | `#151418` | `#f6f6f8` | code blocks |

All text is at least 4.5:1 on `--bg`, `--surface` and `--bg-sunken`, in both themes.

## Type

One sans family (the system UI stack) for chrome and prose; one mono family for code. No font downloads. The serif is only for book covers.

- Root 16px below 1100 px wide; from 1100 px it is 14px, growing smoothly to 16.5px at 2560 px (`clamp(0.875rem, 0.7573rem + 0.1712vw, 1.03125rem)`). Everything is in rem, so the whole site scales with it.
- Body 1rem, line height 1.75. Prose measure 38rem (70 to 80 characters).
- h1 `clamp(1.75rem, 1.4rem + 1vw, 2.25rem)`, weight 600. h2 1.5rem with a hairline above. h3 1.1875rem. h4 1rem. All weight 600.
- Chrome 0.875rem; right rail 0.8125rem; code 0.85rem.

## Layout

- The top bar spans the window. The left rail (courses, and the lectures of the current course) is pinned to the left edge, the "On this page" rail to the right edge. Both are sticky and scroll on their own. The centre takes what is left.
- Prose keeps its measure. Code, tables (up to 64rem), display maths, diagrams and video may grow to the centre width, centred over the text, so a code line of 100 to 110 characters does not scroll at 2560x1440 and 1920x1080.
- Below 1100 px the right rail goes; below 800 px the left rail is a drawer.
- The footer is at the bottom of the window on a short page and after the content on a long one (a min-height column).
- Spacing: multiples of 0.25rem; 1.25em between blocks of prose; 3rem above an h2.

## Forbidden

No pills or chips (except the capsule and the two round buttons of the shelf on the landing page, below), no cards with borders and shadows, no gradients, glows or shadows, no coloured left borders, no badges, no emoji, no decorative icons, no small-caps eyebrow labels, no tinted callout boxes, no hover lifts, no rounded-everything (radius is 4px at most), no marketing sentences or taglines, no oversized hero type. A note is a plain indented paragraph with a bold lead-in. Objectives are a plain list under a plain heading. Buttons are plain text or a thin outline. Current item: the link colour, nothing else (no bar, no box, no weight). The only icons are the functional ones: search, theme, lock, the play mark of a video.

## The shelf on the landing page (the one rich object)

The rules above are for the page. The shelf is an object, and it may be rich, never loud: nothing glows, nothing bounces, nothing sparkles. `src/styles/learn-bookshelf.css` has the details; the rules that matter:

- **What it is.** A tape of books that wraps around the page, full width, standing on the plain page: no case, no wood, no frame. The book in front is turned to show its cover (about 90 degrees, tilted 4.5 degrees, a little forward); the others show their spines. A click on a spine, an arrow button, a key, a sideways wheel or swipe, or a drag brings another to the front; the capsule above takes the shelf to the first book of a group and lights the group of the book in front. A click on the book in front opens the panel with its lectures, under the buttons.
- **One scene, one spring.** One `perspective` on one box over the middle of the page; every book is a box of two faces (spine, cover) moved by `transform` alone, from custom properties (`--x`, and a class for the book in front), with one critically damped spring as `linear()` (0.7 s). The compositor moves them; nothing is measured while a book moves and no script runs per frame. A book that wraps from one end to the other has no transition (it is off the screen at both ends). Reduced motion: no transitions, no ring.
- **Everything is a fraction of the book's height** (`--H`, about half the window's height): spine thickness 0.125 to 0.17, a cover 0.75 wide, text sizes. A book is the same object at every size.
- **No cost per frame.** No filters, no blur, no `data:` textures, no live gradients on moving parts. Faces are a flat colour with a plain gradient, a shadow is a static `box-shadow` in the face's own layer, shading is an overlay whose `opacity` moves. Offscreen copies are `display: none`.
- **The series.** All books the same height, one grid. Spine: a band with the two-digit number in the course's accent, the title down the spine in a bold sans, the lecture count at the foot. Cover: the series mark and number on top, the title large, the promise as the subtitle, the illustration in the lower half, the shelf name and the lecture count at the foot. Text is real HTML; the illustration is the course's `cover.svg`, inlined once per book.
- **Covers.** `tools/learn-covers/generate.mjs <content-dir>` writes all nine `cover.svg` from each course's `cover` colours: each drawing is made at about its final size, measured, scaled to fill the ART FRAME (x 20, y 156, 200 x 124 on the 240 x 320 canvas) with even margins and centred, at one stroke weight (2.6); `--check` says which files are stale. No text, no ids, no `data-` attributes, no references. A locked book is a plain cover in its colours with the lock: the loader sends no art for it.
- **Accessibility.** The pictures are `aria-hidden`. What a screen reader and the keyboard meet is a list of buttons, one per book (number, title, lectures, minutes, locked), with one tab stop; arrows, Home and End move the front, Enter opens, Escape closes. The front cover is ringed while the keyboard has its name. Without JavaScript the same markup is a grid of cards.

### The design page

Design a book here, then put it on the shelf. `src/lab/books.astro` is a page of the dev server only: `astro.config.mjs` adds its route (`/lab/books` on the lecture host) when the command is `dev`, never in a build, so it is not in the production bundle and not reachable on the lecture host (a test builds the site and asks for it). It shows every book closed, lifted and turned, at 1x and 2x, on the dark and the light page; each illustration alone, large; a locked book, a very long and a very short title; thirty books in a row. Iterate there: screenshot, look, fix, repeat; the shelf uses the same `BookFaces.astro`.
