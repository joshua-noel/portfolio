# Learn v2: what changed and where it lives

Version 2 of the lecture site: one continuous lecture (no depths), then a bare, quiet interface. The format contract is `CONTRACT.md` version 2 in the content repository; the look is `docs/learn-style.md`.

## The lecture format

- `format: 2` in front matter selects version 2; `minutes` is one integer. The parser is `src/lib/learn/lecture.ts`, the section scanner `src/lib/learn/blocks.ts`.
- Hard errors: sections present and in order (`In brief`, numbered sections with `Worked example` allowed between, `Limits and open questions`, `In practice`, `Explain it back`, `Interview questions`, `Check yourself`, `References`), 6 to 14 numbered sections, word ranges per section and for the whole lecture, exactly 5 check-yourself questions, 3 to 5 explain-it-back prompts, 4 to 8 interview questions, at least 4 diagrams. Warnings: formulas or code in the brief, an explain-it-back prompt without "A good explanation covers:", text under References.
- Words are counted by `proseText` over every `##` section; the whole lecture is their sum.
- A malformed diagram line or a formula KaTeX cannot read is an error of that file with its line (`bin/check-learn.mjs` prints it); it never crashes the check or the host.
- Version 1 files still render, as one page: the old Tip under a synthesised `## In brief`, then Waterline, Deep, Abyss, Check yourself and References, with the numbers of Deep and Abyss running on. `depth.ts` keeps `DEPTHS` for that reader only. A `?depth=` in an old link is ignored.
- `Lecture.html`, `.toc` (each heading has `text`, readable form of its formulas, and an `id` made from the prose alone, so old anchors keep working), `.words`.
- `bin/check-learn.mjs` prints "(N still version 1)" per course and in total; `--words` or `--course <slug>` prints words per section for version 2 lectures (always for a failing one).

## Covers

`cover.svg` beside `course.md`: `viewBox="0 0 240 320"`, no text, no ids, no `data-` attributes (a legacy `data-mark` is accepted and dropped), no references; the loader sanitises it (`src/lib/learn/svg.ts`, `readCover`) and sends it only for a course the reader may open. The generator is `tools/learn-covers/generate.mjs`.

## The site

- One column of prose, `--measure: 36rem` (72 to 80 characters a line). Code, tables, display maths, diagrams and video may grow to the centre width so a 100 to 110 character code line does not scroll at 1440p and 1080p.
- Left rail (courses and the lectures of the current course) and right rail ("On this page") are pinned to the window edges; the right rail goes below 1100 px, the left rail is a drawer below 800 px.
- Colour appears only in diagrams and figures, code syntax, book covers and video; the page has greys and one link colour. See `docs/learn-style.md` for the palette, the type scale and the forbidden list, and for the shelf on the landing page.
- Inline diagrams on one page get ids prefixed per figure, so several figures do not share `t`, `d` and `ah`.

## Testing

`pnpm check` and `pnpm test`. The browser tests drive a headless Chromium over the DevTools protocol (`test/helpers/browser.ts`); the link and anchor crawl in `docs/learn-qa.md` is the manual pass for a content change.
