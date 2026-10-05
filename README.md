# Joshua Noel — Personal Site

Personal site and blog. One Astro server on Node 24 with SQLite, serving two
hostnames: the site at `noelejoshua.com` and the blog at
`blog.noelejoshua.com`.

The homepage shows only the contact section. The blog and admin remain on the blog hostname.

## How it fits together

Posts live in SQLite, not in git, so publishing is instant and needs no
rebuild. Markdown is rendered to HTML **when a post is saved**, so serving a
page is one `SELECT`. The editor is [Milkdown Crepe](https://milkdown.dev)
with a raw-markdown toggle; both sides parse with remark, so the WYSIWYG and
the published page cannot disagree.

Both hostnames are served by the same process. Routes live under
`src/pages/blog/`, and `src/middleware.ts` maps the blog host's root onto
that subtree — `blog.noelejoshua.com/a-post` renders `/blog/a-post` without
the prefix ever appearing in a URL. Every other spelling redirects to the
canonical one.

The server bundle is self-contained (`ssr.noExternal`), so the package ships
no `node_modules` and has **no native dependencies** — no `sharp`, no
`better-sqlite3`, nothing compiled. Images are downscaled and re-encoded to
WebP in the browser before upload; SQLite comes from `node:sqlite`, built
into Node 24.

## Development

```sh
nix develop     # node 24, pnpm 10, just, sqlite
just dev        # http://localhost:4321
```

`just --list` for the rest. `just check` runs the type check, the unit tests
and the formatter.

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
    adminPasswordHashFile = config.sops.secrets.blog-admin.path;
  };
}
```

The module runs the service and owns its state directory. It does not manage
a reverse proxy — point your own at it:

```caddy
noelejoshua.com, blog.noelejoshua.com {
    reverse_proxy 127.0.0.1:4321
}
```

Back up `services.portfolio.stateDir`; it holds the database and every
uploaded image. Stop the unit around the snapshot, or copy the database with
`sqlite3 .backup` — a live SQLite file is not safe to copy byte-for-byte.

`packages.container` builds an `x86_64-linux` OCI image, published to
`ghcr.io/joshua-noel/portfolio`, for the day this leaves NixOS.
