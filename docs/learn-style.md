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

- Root 100%; 106.25% from 1800 px wide; 112.5% from 2300 px.
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

No pills or chips, no cards with borders and shadows, no gradients, glows or shadows, no coloured left borders, no badges, no emoji, no decorative icons, no small-caps eyebrow labels, no tinted callout boxes, no hover lifts, no rounded-everything (radius is 4px at most), no marketing sentences or taglines, no oversized hero type. A note is a plain indented paragraph with a bold lead-in. Objectives are a plain list under a plain heading. Buttons are plain text or a thin outline. Current item: the link colour, nothing else (no bar, no box, no weight). The only icons are the functional ones: search, theme, lock, the play mark of a video.
