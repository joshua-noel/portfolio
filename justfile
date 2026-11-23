# Everything here assumes `nix develop` (or direnv) is active.

default:
    @just --list

# Dev server on http://localhost:4321, blog on http://blog.localhost:4321,
# lectures on http://learn.localhost:4321.
# Browsers resolve *.localhost to loopback, so the host-based routing works
# locally without touching /etc/hosts.
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    pnpm install
    mkdir -p .data
    if [ ! -f .data/dev-password-hash ]; then
        printf 'dev' | node ./bin/hash-password.mjs > .data/dev-password-hash
        echo "local admin credentials: admin / dev"
    fi
    PORTFOLIO_SITE_URL=http://localhost:4321 \
    PORTFOLIO_BLOG_URL=http://blog.localhost:4321 \
    PORTFOLIO_LEARN_URL=http://learn.localhost:4321 \
    PORTFOLIO_LEARN_CONTENT_DIR="${PORTFOLIO_LEARN_CONTENT_DIR:-$PWD/content/learn}" \
    PORTFOLIO_STATE_DIR="$PWD/.data" \
    PORTFOLIO_ADMIN_PASSWORD_HASH_FILE="$PWD/.data/dev-password-hash" \
    pnpm dev

build:
    pnpm install
    pnpm build

# Type-check, unit tests, formatting.
check:
    pnpm check
    pnpm test
    pnpm exec prettier --check .

test:
    pnpm test

fmt:
    pnpm exec prettier --write .
    nix fmt

# Generate the value for PORTFOLIO_ADMIN_PASSWORD_HASH_FILE. Paste the
# output into sops; the service reads it through LoadCredential.
hash-password:
    @node ./bin/hash-password.mjs

# Open the local development database.
db path=".data/portfolio.db":
    sqlite3 {{ path }}
