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

A diagram uses colours only through `currentColor`, `var(--fg)`, `--muted`, `--border`, `--surface`, `--accent` and `--c1` to `--c6`, which `learn.css` defines in both themes (and `test/learn-contrast.test.ts` holds to WCAG AA). It may carry `data-interactive="<name>"` on its `<svg>`; the site then loads `src/scripts/learn-diagrams/<name>.js`, which builds the controls and updates the drawing. The file itself stays plain SVG.

`pnpm check` and `pnpm build` first run `bin/check-learn.mjs`, which renders every lecture of the sample folder and fails, listing every problem, when one breaks the contract: a missing section or depth, objectives, five check-yourself questions, sources, diagrams or numbering, a word count out of range, a diagram with a literal colour, or maths that does not parse. Run `node bin/check-learn.mjs <dir>` on any folder, including a private one. A lecture marked `placeholder: true` (a site extension, used for the sample stand-in) keeps every kind of block but not the counts.

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

`local` is for the owner's own machine. A server leaves `local` content out entirely and logs how much. `PORTFOLIO_LEARN_ALLOW_LOCAL=1` serves it to everyone who can connect, logs a loud warning, and is refused unless the server listens on loopback; the NixOS module has no option for it.

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

Accounts sign in on the lecture host at `/signin`. The session cookie, `learn_session`, is host-only, HttpOnly, SameSite=Lax and Secure behind TLS, and is a different cookie, in a different scope of the `sessions` table, from the blog admin's: a friend's or member's session is worthless on the admin and its API, and an admin session from the blog is not a lecture session. (Accounts with the `admin` role read everything on the lecture host but do not get the blog's admin: that stays with the environment admin.) Sign-in is throttled by address and by name, answers every failure alike, runs one key derivation whatever the name, rotates the session, checks `Origin`, and only follows a `next` that is a path on the lecture host.

### Where private lectures live

This repository is public, so `members` and `friends` content comes from outside it: `PORTFOLIO_LEARN_CONTENT_DIRS` names several folders (separated like `PATH`: `;` on Windows, `:` elsewhere), merged, read at run time, never copied into the build output (a test greps `dist` for a canary placed in a members lecture). In NixOS, `services.portfolio.learnContentDirs`. The sample folder here may hold `public` only, and the check fails if it finds anything else.

## Running it on Windows (no `just`, no bash)

To see the whole local library, in PowerShell:

```powershell
cd C:\Users\kwinch\Projects\portfolio
$env:PORTFOLIO_LEARN_CONTENT_DIRS = "C:\Users\kwinch\Projects\Resume\study\learn-content"
pnpm learn:dev
```

Then open `http://learn.localhost:4321`. Add `$env:PORTFOLIO_LEARN_ALLOW_LOCAL = "1"` before the last line to also see `local` lectures (your own machine only). The first run makes a throwaway admin, `admin` / `dev`, in `.data/`, which also signs in on the lecture host. `pnpm learn:check <dir>` checks a folder against the contract, and `pnpm test` runs the tests (the end-to-end one builds the site, so it takes a while).

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

Missing required values are reported by name and the process exits 78 before
opening a socket.

Login throttling keys on the socket peer. When the peer is loopback, or one
of the comma-separated addresses in `PORTFOLIO_TRUSTED_PROXIES`, it keys on
the last `X-Forwarded-For` entry instead. Set it when the reverse proxy runs
on another machine, or every visitor shares the proxy's lockout.

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
