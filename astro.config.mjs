// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Astro gives a config file no `command`, so read it from the command line:
// `astro build` is the one that produces the shipped server bundle.
const building = process.argv.slice(2).includes("build");

export default defineConfig({
  // Blog routes read SQLite, and canonical URLs use runtime configuration.
  // Nothing is prerendered, so the build never touches a database.
  output: "server",
  // The adapter's default is 1 GiB, buffered before any route sees it. The
  // largest legitimate body is an 8 MiB upload (src/lib/uploads.ts).
  adapter: node({ mode: "standalone", bodySizeLimit: 9 * 1024 * 1024 }),
  // Behind a TLS-terminating proxy the socket is plain http, so without
  // this the request URL is http:// and Astro's origin check rejects every
  // form POST from the https page (the admin login among them). Only the
  // protocol is trusted: Astro checks X-Forwarded-Proto against a pattern's
  // protocol alone, but a forwarded host must also match its hostname. A
  // hostless pattern accepts any X-Forwarded-Host, and with it Astro takes
  // clientAddress from the client-chosen X-Forwarded-For. The reserved
  // .invalid name matches nothing, so the Host header and the socket peer
  // stand; the hostnames are runtime configuration the middleware checks.
  security: {
    allowedDomains: [{ protocol: "https", hostname: "forwarded-host.invalid" }],
  },
  // Both hostnames are served by this one process; canonical URLs are built
  // from PORTFOLIO_SITE_URL / PORTFOLIO_BLOG_URL at runtime instead.
  trailingSlash: "never",
  // No sharp (see pnpm.ignoredOptionalDependencies in package.json).
  // Nothing here uses astro:assets: uploads are resized in the browser.
  image: { service: { entrypoint: "astro/assets/services/noop" } },
  devToolbar: { enabled: false },
  vite: {
    // Inline every dependency into dist/server. Without this the runtime
    // closure keeps all of astro's build-time machinery -- rolldown alone
    // ships a ~18 MB binary per platform, and a deps FOD fetches every
    // platform. Bundling drops the shipped node_modules entirely.
    //
    // Only for the build. In `astro dev` the same setting makes Vite's module
    // runner load CommonJS packages (picomatch) as ES modules, where `require`
    // does not exist, and the server dies before it listens -- on Windows,
    // where the dev server is what the owner runs. Dev has no bundle to keep
    // small, so it resolves dependencies from node_modules as usual.
    ssr: { noExternal: building ? true : undefined },
    build: {
      // Never inline a script into the page: the admin CSP (src/middleware.ts)
      // allows only script-src 'self'. Other assets keep Vite's default.
      assetsInlineLimit: (file) => (/\.[cm]?js$/.test(file) ? false : undefined),
    },
  },
});
