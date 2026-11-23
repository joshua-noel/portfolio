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

`PORTFOLIO_LEARN_CONTENT_DIR` names the folder. It is read at run time and reloaded within a second of a file changing, so a lecture can be edited without a restart. When it is not set, the site serves the sample lectures in `content/learn/`, which ship in the package; `just dev` does this. In NixOS, `services.portfolio.learnContentDir`.

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

`visibility` is `public`, `members`, `friends` or `local`, on the course and on each lecture. For now the server shows `public` only: anything else is listed with a lock icon, and its body is neither rendered nor kept in memory nor searchable. Opening more to a signed-in reader means deciding the audience per request from the session and keeping a catalog per audience (`AUDIENCE` in `src/lib/learn/content.ts`, and `loadCatalog` already takes it). The Sign in link goes to the admin login until readers have accounts.

The sample folder in this repository is public, so the check refuses anything in it that is not `public`. Private content lives in another folder, on the server (for example `services.portfolio.learnContentDir = "/var/lib/portfolio/learn"`, filled by `rsync` or a private repository pulled there) and on the author's machine (`local`, with `PORTFOLIO_LEARN_CONTENT_DIR` pointing at it); it never enters this repository.

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
