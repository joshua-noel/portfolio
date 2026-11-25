# Learn v2: where the work stands

Branch `feat/learn-v2`, worktree `.tmp/sitev2`. Plan: one continuous lecture (no depths), then a bare, quiet interface in the style of `style-bible-reference.png`. Contract: `learn-content/CONTRACT.md` version 2.

## Step 1: lecture format version 2 (done, committed)

- `src/lib/learn/lecture.ts`: `format: 2` in front matter selects version 2. `minutes` is one integer. Hard errors: sections present and in order (`In brief`, numbered sections with `Worked example` allowed between, `Limits and open questions`, `In practice`, `Explain it back`, `Interview questions`, `Check yourself`, `References`), 6 to 14 numbered sections, word ranges (In brief 150-350, whole lecture 3,000-7,000, Limits 200-900, In practice 200-700), exactly 5 check-yourself, 3-5 explain-it-back, 4-8 interview questions, at least 4 diagrams, plus the old rules (diagram colours, prose swallowed by maths, source ids). Warnings: In brief with formulas or code, an explain-it-back prompt without "A good explanation covers:" and bullets, text under References.
- Words are counted by `proseWords` (the old counter) over every `##` section, including the questions inside `<details>`; the whole lecture is the sum of all sections.
- A file without `format: 2` is version 1 and is checked by the old rules. It renders as ONE page: the old Tip under a synthesised `## In brief`, then Waterline, Deep, Abyss, then Check yourself and References. The numbered sections of Deep and Abyss run on from Waterline (`Heading.shown`), so no two sections are "1". `Lecture.front.minutes` is the sum of the four old numbers.
- `Lecture` now has `html` (whole page), `toc` (reading order, `shown` numbers), `words` (per `##` section, version 2 only). `segments`, `Segment`, `minutesAt` and the depth helpers are gone; `depth.ts` keeps only `DEPTHS`/`Depth`, which the version 1 reader needs.
- `blocks.ts`: `splitSectionsV2` (a `#` heading outside a fence is an error).
- `render.ts`: `Renderer(ids, format)`; frame sections by title (`FRAMES_V2`); `briefHeading()` for version 1.
- `course.md`: optional `cover.svg` (checked by `readCover`: `viewBox="0 0 240 320"`, no text, sanitiser rules; literal colours allowed). The catalog exposes it as `Course.coverSvg` (sanitised markup) and EMPTY for a course the reader may not open (decision: a locked course keeps only title, promise, shelf and cover colours, as today).
- `bin/check-learn.mjs`: per-course "(N still version 1)", `--words` and `--course` print the words of every section of version 2 lectures (also for any version 2 lecture that fails).
- Tests: `test/learn-lecture-v2.test.ts`, `test/helpers/lecture-v2.ts`, `test/check-learn.test.ts`; older tests moved off `segments`.

## Step 2: remove the depths from the site (todo)

Pages, layout, scripts and CSS still use the old shape until this step lands: `src/pages/learn/**`, `src/layouts/Learn.astro`, `src/components/learn/{DepthSwitch,Bookshelf,LearnNav}.astro`, `src/scripts/learn*.js`, `src/styles/learn*.css`, `docs/learn-qa.md`.

## Step 3: restyle (todo)

## Step 4: prove it (todo)
