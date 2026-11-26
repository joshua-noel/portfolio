// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Astro gives a config file no `command`, so read it from the command line:
// `astro build` is the one that produces the shipped server bundle.
const building = process.argv.slice(2).includes("build");

// The design page for the books (src/lab/books.astro) is a route of the dev
// server only: it is injected here when the command is `dev` and never in a
// build, so the production bundle has no trace of it.
const learnLab = {
  name: "learn-lab",
  hooks: {
    "astro:config:setup": ({ command, injectRoute }) => {
      if (command === "dev")
        injectRoute({ pattern: "/learn/lab/books", entrypoint: "./src/lab/books.astro" });
    },
  },
};

export default defineConfig({
  integrations: [learnLab],
  // Blog routes read SQLite, and canonical URLs use runtime configuration.
  // Nothing is prerendered, so the build never touches a database.
  output: "server",
  // The adapter's default is 1 GiB, buffered before any route sees it. The
  // largest legitimate body is an 8 MiB upload (src/lib/uploads.ts).
  adapter: node({ mode: "standalone", bodySizeLimit: 9 * 1024 * 1024 }),
  // Behind a TLS-terminating proxy the socket is plain http, so without the
  // proxy's X-Forwarded-Proto the request URL is http:// and the origin check
  // rejects every form POST from the https page (the admin login among them).
  //
  // allowedDomains is empty on purpose, so Astro trusts no forwarded header and
  // builds the URL from the socket. Since @astrojs/node 11.1.7 / astro 7.4.11 a
  // host must be listed to be believed, and the hostnames here are runtime
  // configuration, unknown at build time. A wildcard entry would also make
  // Astro take clientAddress from the client-written X-Forwarded-For, which the
  // login throttle and mayServeLocal must not (they want the socket peer).
  // src/middleware.ts applies the Host header and X-Forwarded-Proto: https
  // itself (applyRequestOrigin in src/lib/routing.ts). Remove that, and set
  // real entries here, only if the hostnames ever become build-time.
  //
  // checkOrigin is off because src/middleware.ts does the same check itself:
  // Astro's runs before any middleware, so its 403 could not carry the
  // lecture host's security headers.
  security: {
    allowedDomains: [],
    checkOrigin: false,
  },
  // Both hostnames are served by this one process; canonical URLs are built
  // from PORTFOLIO_SITE_URL / PORTFOLIO_BLOG_URL at runtime instead.
  trailingSlash: "never",
  // No sharp (see pnpm.ignoredOptionalDependencies in package.json).
  // Nothing here uses astro:assets: uploads are resized in the browser. Astro's
  // /_image endpoint would still answer on every host and serve files from the
  // build output, so it is replaced by one that answers 404 to everything.
  image: {
    service: { entrypoint: "astro/assets/services/noop" },
    endpoint: { entrypoint: "./src/image-endpoint.ts" },
  },
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
