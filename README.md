# Joshua Noel — Personal Site

Personal site, blog and lectures. One Astro server on Node 24 with SQLite,
serving three hostnames: the site at `noelejoshua.com`, the blog at
`blog.noelejoshua.com` and the lectures at `learn.noelejoshua.com`.

The homepage says who I am, shows my work and my latest writing, and ends with how to reach me. The work list is the `work` array at the top of `src/pages/index.astro`. The blog and admin stay on the blog hostname; both hostnames share one header and footer (`src/components/`).

## How it fits together

Posts live in SQLite, not in git, so publishing is instant and needs no
rebuild. Markdown is rendered to HTML **when a post is saved**, so serving a
page is one `SELECT`. The editor is [Milkdown Crepe](https://milkdown.dev)
with a raw-markdown toggle; both sides parse with remark, so the WYSIWYG and
the published page cannot disagree.

All hostnames are served by the same process. Routes live under
`src/pages/blog/` and `src/pages/learn/`, and `src/middleware.ts` maps each
host's root onto its subtree — `blog.noelejoshua.com/a-post` renders
`/blog/a-post` without the prefix ever appearing in a URL. Every other
spelling redirects to the canonical one, and the admin lives on the blog host
alone.

The server bundle is self-contained (`ssr.noExternal`), so the package ships
no `node_modules` and has **no native dependencies** — no `sharp`, no
`better-sqlite3`, nothing compiled. Images are downscaled and re-encoded to
WebP in the browser before upload; SQLite comes from `node:sqlite`, built
into Node 24.

## Lectures

The lecture site reads courses from a folder, laid out as the lecture contract (`learn-content/CONTRACT.md`, kept with the lecture sources) describes. That file is the contract between the writers and this site: if the format must change, it changes there first, and `src/lib/learn/lecture.ts` is where this site enforces it.

```
<content-dir>/
  <course-slug>/
    course.md                      shelf, order, visibility, cover, a paragraph
    NN-<lecture-slug>.md           one lecture; NN is its order
    NN-<lecture-slug>.script.md    video script (the site ignores it)
    NN-<lecture-slug>.mp4, .vtt    video and captions, if video: true
    NN-<lecture-slug>.poster.png   optional poster image (png or jpg)
    diagrams/NN-<name>.svg
```

`PORTFOLIO_LEARN_CONTENT_DIRS` (or `PORTFOLIO_LEARN_CONTENT_DIR` for one folder) names where. It is read at run time and reloaded within a second of a file changing, so a lecture can be edited without a restart. When neither is set, the site serves the sample lectures in `content/learn/`, which ship in the package.

Each lecture is four `#` sections, Tip, Waterline, Deep and Abyss, and the site shows them as four depths. Every layer is in the page and `<html data-depth>` picks which are shown, so `?depth=deep` works without JavaScript and the switch in the browser only changes that attribute and the URL. At Deep and Abyss the layers add to the Waterline, and Check yourself and References stay last. The reader's last choice is remembered in `localStorage`. The elements:

| In the file                                         | On the page                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `![[diagram: 03-name \| Caption.]]` on its own line | `diagrams/03-name.svg`, inlined, with the caption; follows the theme      |
| `$x$` and `$$x$$`                                   | KaTeX, rendered on the server; no maths library reaches the browser       |
| `<details><summary>Q?</summary>A</details>`         | a question whose answer is hidden until asked                             |
| `[Transformer]`                                     | a link to that source in References, which the site builds from `sources` |
| `> **Note.**`, `> **Common mistake.**`              | a callout                                                                 |
| `video: true`                                       | a player with captions, if the `.mp4` and `.vtt` are there                |

A course may name one hue as its alert hue, `alert: c1` to `alert: c6` in `course.md` (optional; the loader and `bin/check-learn.mjs` refuse any other value). The lecture and course pages carry it as `data-alert` on `<html>`, and `learn.css` then draws that hue as the alert rose (`--alert`) on that course's pages only, interactive diagrams included. By default `--c6` is a green, so a hue never means "bad" unless its course says so (`agent-systems` and `inference-and-serving` use `c6`).

A diagram uses colours only through `currentColor`, `var(--fg)`, `--muted`, `--border`, `--surface`, `--accent` and `--c1` to `--c6`, which `learn.css` defines in both themes (and `test/learn-contrast.test.ts` holds to WCAG AA). It may carry `data-interactive="<name>"` on its `<svg>`; the site then loads `src/scripts/learn-diagrams/<name>.js`, which builds the controls and updates the drawing. The file itself stays plain SVG.

An interactive module exports its model as a plain function (the lecture's own formula, no page code) and a default `init(figure)`. It builds its controls with `panel()` from `controls.js` (labelled sliders, toggles, selects, a Reset button and an `aria-live` sentence that states the result in words), then redraws the SVG from the model on every change. At the default settings it draws what the static file shows, and the static SVG stays the no-JavaScript and print fallback. Each model has a unit test, `test/learn-diagram-<name>.test.ts`, that checks it against the numbers printed in the lecture and against the lecture's own code at other settings. A module is loaded only on a page whose figure names it.

`pnpm check` and `pnpm build` first run `bin/check-learn.mjs`, which renders every lecture of the sample folder and fails, listing every problem, when one breaks the contract: a missing section or depth, objectives, five check-yourself questions, sources, diagrams or numbering, a word count out of range, a diagram with a literal colour, or maths that does not parse. It also fails on inline maths that holds ordinary words (a bare money amount such as `$2.50` pairs with the next dollar sign and swallows the prose between them: write `\$2.50`), and on interactive diagrams: `src/lib/learn/interactive.ts` lists, for each course, the diagram that must say `data-interactive="<module>"` on its `<svg>` (a regenerated diagram that drops the attribute would otherwise just stop being interactive), and a `data-interactive` name that is no module of the site is an error. Run `node bin/check-learn.mjs <dir>` on any folder, including a private one. A lecture marked `placeholder: true` (a site extension, used for the sample stand-in) keeps every kind of block but not the counts.

### The landing page: a bookshelf

Each course is a book, and the shelves (Foundations, Systems, Language models, Agents, Frontier, Special; one with no book is not drawn) are the catalog's own. Spine, cover and panel are made from what a reader's catalog holds, so a locked course shows only its stub:

- **The book.** Its colours and motif come from the course's `cover: { color, accent, motif }` and its title (a title with a colon is a title and a subtitle). `src/lib/learn/motifs.ts` draws thirteen motifs as line art (`tokens`, `graph`, `layers`, `waves`, `grid`, `circuit`, `orbit`, `stack`, `lock`, `loop`, `cache`, `boxes-and-arrows`, `gradient-steps`); a name it does not draw gets one of them, chosen from the name. Text colours are picked for contrast (`src/lib/learn/cover.ts`). No outside artwork is used.
- **Thickness** is proportional to the whole course's reading time (Waterline, Deep and Abyss added up, so it does not change with the depth switch), between 2.6 and 6 rem; a lecture the reader may not open counts as a typical one.
- **Rendering** is CSS 3D transforms on real elements, with no canvas, image or library. Hovering or focusing a book (or opening it) slides it out of the row and turns its cover to the reader (about 0.4 s; only `transform`, `opacity` and the eye's `perspective-origin` change), and the books beside it step aside, those before it one way and those after it the other, so none is hidden. The pulled-out book is a solid: a page block on its fore-edge and top, a cast shadow on the board and on its neighbours. Click, Enter or Space opens a panel with the promise, an Open link and the numbered lectures (reading time at the chosen depth, a mark for video, a lock for what the reader may not open); Escape, the close button or a click elsewhere closes it and Escape returns focus to the book. Arrow keys, Home and End move along a shelf (Up and Down between shelves), with one Tab stop per shelf. Each book's accessible name is its title, its lecture count, its reading time at the chosen depth and, if so, "Locked"; the panel is a labelled region that takes focus; the pills are buttons with `aria-pressed`.
- **Bookcases.** On a screen 76 rem wide or more, `packCases` (`src/lib/learn/bookshelf.ts`) puts shelves into bookcases in the catalog's order, as many to a case as fit the page: a few books share one case, as big as fits (up to 1.2 times), each shelf a group with a bookend after it and its name lettered into the board below, and a case is as wide as its books. A shelf wider than the page has a case to itself and scrolls, with arrows. Narrower screens give each shelf its own case, and every row keeps room for a cover to swing out, in CSS, so nothing moves when the script runs.
- **Without JavaScript** the page is a grid of course cards with the cover, text and every lecture link. With `prefers-reduced-motion` the books stay on the shelf and are lit and ringed instead of turned, and the cover shows beside the text in the panel. Shelves with more books than fit scroll sideways (with arrows and, on a phone, snap); a phone keeps the shelf because a list would lose the cover and the lock, which are the point of it.
- **Code.** `src/components/learn/Bookshelf.astro` is the one markup for both looks; `src/scripts/learn-bookshelf/index.js` (about 2.5 KB gzipped) and `src/styles/learn-bookshelf.css` (about 4 KB gzipped) do the rest. What the books and pills are is in `src/lib/learn/bookshelf.ts` and `bookshelf-filter.ts`, tested in `test/learn-bookshelf.test.ts`; `test/learn-e2e.test.ts` loads the page in a headless Chrome, Chromium or Edge (found by `test/helpers/browser.ts`, or named by `PORTFOLIO_TEST_BROWSER`; those tests are skipped on a machine with none) and fails on any Content-Security-Policy violation.

### Who may read what

`visibility` is `public`, `members`, `friends` or `local`, on the course and on each lecture; the stricter of the two wins. One function, `canRead` in `src/lib/access.ts`, decides, and everything that serves lecture content (pages, search, the sitemap, video and captions) gets its catalog from `getCatalogFor(role)`, in which what a reader may not open is a stub: title and promise, nothing else.

| reader  | reads                                        |
| ------- | -------------------------------------------- |
| visitor | `public`                                     |
| member  | `public`, `members`                          |
| friend  | `public`, `members`, `friends`               |
| admin   | everything above                             |
| anyone  | never `local`, which a server does not serve |

Locked courses and lectures stay listed with a lock icon. Opened, they show a short page: what it is and "Sign in to read" (for `members`, also that membership is not open yet). Roles and visibilities this code does not know read as no access.

`local` is for the owner's own machine. A server leaves `local` content out entirely, without a stub or a gap in the lecture numbers, and logs how much. `PORTFOLIO_LEARN_ALLOW_LOCAL=1` is honoured only under the dev server (`pnpm learn:dev`), and only when `PORTFOLIO_LEARN_URL` is itself a `localhost` or `*.localhost` address; otherwise the configuration is refused, so the built server (`dist/server/entry.mjs`, `bin/serve.mjs`) never serves `local` whatever the environment says, behind a proxy or not, and the NixOS module has no option for it. Even then each request is checked: the socket peer must be loopback and the request must carry none of `X-Forwarded-*`, `Forwarded`, `Via`, `X-Real-IP`, so a tunnel that adds a header gets no `local` content, not even a stub. (A tunnel that forwards raw TCP to the dev server looks like loopback and cannot be told apart: do not expose the dev server.)

### Accounts

There is no sign-up and no payment. The environment admin (`PORTFOLIO_ADMIN_USERNAME` and its hash) is the bootstrap account: it keeps the blog's admin and can also sign in on the lecture host, as admin. Every other account is made by the owner, with a command on the machine that holds the database:

```
node bin/user.mjs add <username> --role friend|member|admin
node bin/user.mjs list
node bin/user.mjs set-role <username> --role friend|member|admin
node bin/user.mjs set-password <username>
node bin/user.mjs disable <username>      # also: enable
```

The password is read from a hidden prompt (asked twice) or from standard input, never from an argument. Disabling an account, or changing its password, deletes its sessions at once. The server makes and migrates the database, so start it once first. Locally, `$env:PORTFOLIO_STATE_DIR = ".data"` points the command at the dev database; on the server it is `portfolio-user` (in the package), run as the service's user with `PORTFOLIO_STATE_DIR=/var/lib/portfolio`.

Accounts sign in on the lecture host at `/signin`. The session cookie is host-only, HttpOnly, SameSite=Lax, and named `__Host-learn_session` on https (a browser then refuses a `Domain=` cookie of that name planted from the blog or the main site; the server reads no other name on https) and `learn_session` on plain http for local development; sign-out clears both, and is a different cookie, in a different scope of the `sessions` table, from the blog admin's: a friend's or member's session is worthless on the admin and its API, and an admin session from the blog is not a lecture session. (Accounts with the `admin` role read everything on the lecture host but do not get the blog's admin: that stays with the environment admin.) Changing the environment admin's password ends all of its sessions (each stores a fingerprint of the hash it was made with). Sign-in is throttled by address (five failures lock that address for 15 minutes) and by name *at that address*; there is deliberately no counter on the name alone, because one that locks would let anyone lock the owner out from anywhere. It answers every failure alike, runs one key derivation whatever the name, rotates the session, checks `Origin`, and only follows a `next` that is a path on the lecture host.

### Where private lectures live

This repository is public, so `members` and `friends` content comes from outside it: `PORTFOLIO_LEARN_CONTENT_DIRS` names several folders (separated like `PATH`: `;` on Windows, `:` elsewhere), merged, read at run time, never copied into the build output (a test greps `dist` for a canary placed in a members lecture). In NixOS, `services.portfolio.learnContentDirs`. The sample folder here may hold `public` only, and the check fails if it finds anything else.

### What a lecture may contain

Lecture files come from outside this repository, so what they say is not trusted. Raw HTML in Markdown is cut down to an allow-list (`src/lib/learn/sanitize.ts`): `details`, `summary`, basic inline formatting, tables, lists, links (relative, `#fragment`, `http`, `https`, `mailto`) and images; scripts, event handlers, `javascript:` URLs, frames, forms, `style` and the rest are removed. KaTeX's output is added afterwards and is trusted. A diagram is parsed as a browser would parse it and every element and attribute must be on a list (`src/lib/learn/svg.ts`): no `script`, `style`, `foreignObject`, animation (`set`, `animate`), `image`, event handlers or external references, and `href` only to a `#id` in the same diagram. A diagram that fails is a load error, and what is inlined is the parser's own output, not the file's text.

Video, captions and poster are served under the lecture's slug (`/media/<course>/<slug>.mp4`, `.vtt`, `.poster.png`), never under the file's `NN-` number: after a `local` lecture is left out the page says "Lecture 4" while the file says 05, and the number in a URL would show that one is missing. The numbered names are a 404. `next` on sign-in and sign-out is resolved against a fixed dummy origin and only the normalised path comes back; dot segments, encoded dot segments, backslashes and control characters cannot produce another host.

Every response on the lecture host carries a Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, `Vary: Cookie` and `Cache-Control: private, no-store` (public media says its own), including 404s, 403s, 400s, redirects and 500s; one function in `src/middleware.ts` sets them. What the framework answers before the middleware (a trailing-slash redirect, a static file under `/_astro`, a `TRACE`) gets a floor of the same headers (`nosniff`, `X-Frame-Options`, a `default-src 'none'` policy, `private, no-store`, `Vary: Cookie`) from a wrapper around the server's request listener in `bin/serve.mjs`, for the lecture host only; static files keep their own caching. Not covered: a request Node's HTTP parser refuses (an unknown method such as `FOO`, a malformed request line) is answered before any code of ours runs and before the Host is known; it carries no content. The policy is `default-src 'self'`; `script-src 'self'` (no inline script: the theme script is `src/scripts/learn-init.js`); `style-src 'self'`; `style-src-attr 'unsafe-inline'`; `img-src 'self' data:`; `media-src 'self'`; `font-src 'self' data:`; `frame-ancestors 'none'`; `base-uri 'none'`; `object-src 'none'`; `form-action 'self'`. The one relaxation is `style` attributes, which KaTeX output, the diagrams and the course cards need; an attribute cannot run code, and nothing an author writes keeps a `style`.

One broken lecture or course file does not take the lecture host down: the server loads what is valid, logs each file it left out, and tells an admin (only) how many files were left out, as a number at the top of each page. The detail (file names, a quote of what is wrong, server paths) goes to the server log and nowhere else, because it can quote a `local` file; only the dev server on your own machine, with the local switch on, shows it on the page. A file over its size limit (lecture 1 MiB, diagram 512 KiB, course file 256 KiB; the largest real ones are 40 KB, 43 KB and 3 KB) is not read, and the log says so. A change to the content is built in the background while the previous catalog is served, and swapped in when done; only the first request after a start waits. `pnpm check` and the checker are strict and fail on the first problem as before.

## Running it on Windows (no `just`, no bash)

To see the whole local library, in PowerShell:

```powershell
cd C:\Users\kwinch\Projects\portfolio
$env:PORTFOLIO_LEARN_CONTENT_DIRS = "C:\Users\kwinch\Projects\Resume\study\learn-content"
pnpm learn:dev
```

Then open `http://learn.localhost:4321`. Add `$env:PORTFOLIO_LEARN_ALLOW_LOCAL = "1"` before the last line to also see `local` lectures (your own machine only: the dev server and a `localhost` address, nothing else). The first run makes a throwaway admin, `admin` / `dev`, in `.data/`, which also signs in on the lecture host. `pnpm learn:check <dir>` checks a folder against the contract, and `pnpm test` runs the tests (the end-to-end one builds the site, so it takes a while).

## Development

```sh
nix develop     # node 24, pnpm 10, just, sqlite
just dev        # http://localhost:4321
```

The blog is at `http://blog.localhost:4321` and the lectures at
`http://learn.localhost:4321`. Browsers resolve `*.localhost` to loopback, so
no DNS or `/etc/hosts` is needed. With `curl`, send the header instead:
`curl -H 'Host: learn.localhost:4321' http://127.0.0.1:4321/`.

`just --list` for the rest. `just check` runs the lecture check, the type
check, the unit tests and the formatter.

The dev server needs the same configuration the deployed one does; `just dev`
writes a throwaway admin hash to `.data/` on first run.

## Configuration

Every variable also accepts a `_FILE` suffix pointing at a file containing
the value, which is how secrets arrive from sops or systemd's
`LoadCredential`.

| variable                        | default              |                       |
| ------------------------------- | -------------------- | --------------------- |
| `PORTFOLIO_SITE_URL`            | —                    | required; apex origin |
| `PORTFOLIO_BLOG_URL`            | —                    | required; blog origin |
| `PORTFOLIO_LEARN_URL`           | —                    | required; lectures    |
| `PORTFOLIO_LEARN_CONTENT_DIR`   | `content/learn`      | the lecture folder    |
| `PORTFOLIO_ADMIN_PASSWORD_HASH` | —                    | required; see below   |
| `PORTFOLIO_ADMIN_USERNAME`      | `admin`              |                       |
| `PORTFOLIO_HOST`                | `127.0.0.1`          |                       |
| `PORTFOLIO_PORT`                | `4321`               |                       |
| `PORTFOLIO_STATE_DIR`           | `/var/lib/portfolio` | database and uploads  |
| `PORTFOLIO_TRUSTED_PROXIES`     | —                    | see below             |
| `PORTFOLIO_TRUSTED_PROXY_HOPS`  | `1`                  | see below             |

Missing required values are reported by name and the process exits 78 before
opening a socket.

Login throttling keys on the client address, and an IPv6 client on its /64
(one person usually holds a whole /64). Which address that is depends on the
proxies in front of the process, so it is a setting, not a guess:

| `PORTFOLIO_TRUSTED_PROXY_HOPS` | meaning |
| ------------------------------- | ------- |
| `1` (default)                   | one proxy appends the address it saw to `X-Forwarded-For`; the last entry is the client |
| `2`, `3`…                       | that many proxies in a chain, each appending; the entry that many places from the right is the client, and entries to its left (the client's own forgeries) are ignored |
| `0`                             | forwarded headers are ignored; the socket peer is the client |

Forwarded headers are believed only when the peer is loopback or one of the
comma-separated addresses in `PORTFOLIO_TRUSTED_PROXIES`; a header with fewer
entries than hops is ignored. **The owner must confirm the production
chain.** With Caddy alone in front of the process, `1` is right. The example in this README, Caddy on the same machine, is one hop.
If a bot check or CDN sits in front of Caddy, count it too: with one hop too
few, every visitor shares one address and five failures lock sign-in for all;
with one too many, the rightmost entry the client could forge is trusted and
the per-address limit can be bypassed. Check what the app really receives
before relying on it, for example with `curl -H 'X-Forwarded-For: 6.6.6.6'`
through the whole chain and a log of the header at the app.

Measured against a built server, these settings are **unsafe**, by what the real chain is:

| real chain | setting | what happens |
| ---------- | ------- | ------------ |
| any proxy in front | `0` | every client is keyed as the proxy (`127.0.0.1`): five failures from one person lock **everyone** out of sign-in |
| fewer proxies than the setting (one real proxy, `2`) | too high | the header has too few entries, so the peer is used and everyone shares one address and one lockout; or, if the client adds an entry of its own, a forged entry is trusted and the per-address limit is bypassed by rotating it |
| more proxies than the setting (a CDN or bot check in front of Caddy, `1`) | too low | every visitor shares the CDN's address: five failures lock everyone out |
| a proxy that passes the client's `X-Forwarded-For` through unchanged, neither appending nor replacing | any | the client chooses its own address and is never locked: the limit is defeated |
| Caddy alone (it replaces the header of untrusted clients) | `1` | correct |
| two proxies that both append | `2` | correct |

There is one admin account and no user table. Generate its password hash
with:

```sh
just hash-password
```

## Deploying

```nix
{
  inputs.portfolio.url = "github:joshua-noel/portfolio";

  # in your NixOS configuration
  imports = [ inputs.portfolio.nixosModules.default ];

  services.portfolio = {
    enable = true;
    siteUrl = "https://noelejoshua.com";
    blogUrl = "https://blog.noelejoshua.com";
    learnUrl = "https://learn.noelejoshua.com";
    adminPasswordHashFile = config.sops.secrets.blog-admin.path;
  };
}
```

The module runs the service and owns its state directory. It does not manage
a reverse proxy — point your own at it:

```caddy
noelejoshua.com, blog.noelejoshua.com, learn.noelejoshua.com {
    reverse_proxy 127.0.0.1:4321
}
```

Back up `services.portfolio.stateDir`; it holds the database and every
uploaded image. Stop the unit around the snapshot, or copy the database with
`sqlite3 .backup` — a live SQLite file is not safe to copy byte-for-byte.

`packages.container` builds an `x86_64-linux` OCI image, published to
`ghcr.io/joshua-noel/portfolio`, for the day this leaves NixOS.
