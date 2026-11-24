import { defineMiddleware } from "astro:middleware";
import {
  SESSION_COOKIE,
  learnCookieName,
  learnViewer,
  validateSession,
} from "./lib/auth.ts";
import { getConfig } from "./lib/config.ts";
import {
  isForbiddenCrossOriginRequest,
  mayServeLocal,
  resolveRoute,
} from "./lib/routing.ts";

// Post bodies may carry raw HTML (embeds), and the admin shares their origin.
// Scripts on admin pages are therefore limited to our own bundles; the editor
// needs inline styles (ProseMirror, CodeMirror) and blob: cover previews.
const ADMIN_CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

// The lecture host serves text written outside this repository, so it gets the
// tightest policy its pages can live with.
//   script-src 'self'         our bundles only. No inline script anywhere: the
//                             theme script is a file, and lecture HTML is
//                             sanitised (src/lib/learn/sanitize.ts) as well.
//   style-src 'self'          stylesheets are files.
//   style-src-attr 'unsafe-inline'
//                             the one relaxation. `style="..."` attributes are
//                             needed by KaTeX's output (every formula is
//                             positioned with them), the inline SVG diagrams'
//                             presentation attributes, and the course cards'
//                             `--cover` colours. An attribute cannot run code,
//                             and the sanitisers strip `style` from anything an
//                             author writes; only trusted generators emit it.
//   img-src 'self' data:      posters and figures from here; `data:` for the
//                             few inlined icons. No third-party image, so a
//                             lecture cannot beacon to another server.
//   media-src 'self'          the lecture video and its captions.
//   font-src 'self' data:     KaTeX's fonts are ours; the bundler inlines the
//                             smallest of them into the stylesheet as `data:`
//                             URIs (a browser reported the violation). A font
//                             cannot run code.
//   connect-src               falls back to default-src: the search index is ours.
//   frame-ancestors 'none'    nobody frames a lecture (with X-Frame-Options for
//                             browsers that read only that).
//   base-uri 'none', object-src 'none', form-action 'self'
//                             no <base> to redirect relative links, no plugins,
//                             and the only forms are this site's own sign-in.
const LEARN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

/**
 * One process serves every hostname. Routes live under src/pages/blog/ and
 * src/pages/learn/, and each host maps its root onto its subtree, so
 * `blog.example.com/a-post` renders `/blog/a-post` without the prefix ever
 * appearing in a URL.
 *
 * The admin lives on the blog host alone. Serving it from both would mean two
 * session cookies on two origins and a login that appears to do nothing.
 *
 * Every response leaves through `seal`, so the headers cannot be skipped by an
 * early return: a 404, a 403, a redirect or a crash on the lecture host carries
 * the same ones as a page.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const config = getConfig();
  const host = context.request.headers.get("host") ?? context.url.host;
  const isLearn = host === config.learnHost;

  let response: Response;
  try {
    response = await handle(context, next, host, isLearn);
  } catch (error) {
    // On the lecture host a failure must still carry its headers, and must
    // not show anything of what failed. Elsewhere Astro's own handling stays.
    if (!isLearn) throw error;
    console.error("learn: request failed:", error);
    response = new Response("Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return seal(response, {
    isLearn,
    isAdmin: isAdminPath(context.url.pathname),
    https: context.url.protocol === "https:",
  });
});

const isAdminPath = (pathname: string): boolean =>
  pathname === "/admin" || pathname.startsWith("/admin/");

type Context = Parameters<Parameters<typeof defineMiddleware>[0]>[0];
type Next = Parameters<Parameters<typeof defineMiddleware>[0]>[1];

async function handle(
  context: Context,
  next: Next,
  host: string,
  isLearn: boolean,
): Promise<Response> {
  const config = getConfig();
  const { pathname, search } = context.url;

  // Astro's own version of this check is switched off (astro.config.mjs): it
  // runs before this middleware, so its 403 could not carry our headers.
  if (
    isForbiddenCrossOriginRequest({
      method: context.request.method,
      origin: context.request.headers.get("origin"),
      contentType: context.request.headers.get("content-type"),
      urlOrigin: context.url.origin,
    })
  ) {
    return new Response(`Cross-site ${context.request.method} form submissions are forbidden`, {
      status: 403,
    });
  }

  const action = resolveRoute({
    host,
    pathname,
    search,
    blogHost: config.blogHost,
    blogUrl: config.blogUrl,
    learnHost: config.learnHost,
    learnUrl: config.learnUrl,
  });

  // Canonicalisation runs first: an unauthenticated /admin on the apex must
  // land on the blog host's login form, not the apex's, or the session
  // cookie is set on an origin the admin never uses again.
  if (action.kind === "redirect") return context.redirect(action.location, 301);

  const isApi = pathname.startsWith("/api/");
  if (isLearn) {
    context.locals.here = { pathname, search };
    // The admin and its API live on the blog host; on this one they do not exist.
    if (isApi) return new Response("Not found", { status: 404 });
    // Sign-in and sign-out change state, so they must come from this site's
    // own pages: a form on another origin is refused, which is what stops
    // someone signing a reader in to an account of their choosing.
    if (
      context.request.method === "POST" &&
      (pathname === "/signin" || pathname === "/signout") &&
      context.request.headers.get("origin") !== config.learnUrl
    ) {
      return new Response("Bad origin", { status: 403 });
    }
    context.locals.viewer = learnViewer(
      context.cookies.get(learnCookieName(context.url))?.value,
    );
    context.locals.allowLocal = config.learnAllowLocal && isOwnMachine(context);
  }

  const isAdmin = isAdminPath(pathname);
  const isPublicEndpoint = pathname === "/admin/login" || pathname === "/api/login";

  if ((isAdmin || isApi) && !isPublicEndpoint) {
    if (!validateSession(context.cookies.get(SESSION_COOKIE)?.value)) {
      if (isApi) return new Response("Unauthorized", { status: 401 });
      return context.redirect(
        `/admin/login?next=${encodeURIComponent(pathname + search)}`,
        303,
      );
    }
  }

  // SameSite=Lax already withholds the cookie from cross-site POSTs; this
  // closes the gap for anything that reaches us with one anyway. Same-origin
  // forms and fetches always carry a matching Origin.
  if (
    (isAdmin || isApi) &&
    context.request.method !== "GET" &&
    context.request.method !== "HEAD"
  ) {
    const origin = context.request.headers.get("origin");
    if (origin !== config.siteUrl && origin !== config.blogUrl) {
      return new Response("Bad origin", { status: 403 });
    }
  }

  return action.kind === "rewrite" ? next(action.path) : next();
}

/**
 * The second layer behind the start-up check on `PORTFOLIO_LEARN_ALLOW_LOCAL`
 * (see `loadConfig`): the socket peer is this machine and nothing says a proxy
 * relayed the request. Never true if the peer cannot be read.
 */
function isOwnMachine(context: Context): boolean {
  try {
    return mayServeLocal(context.clientAddress, context.request.headers);
  } catch {
    return false;
  }
}

/** Headers on every response; more on the lecture host's and the admin's. */
function seal(
  response: Response,
  { isLearn, isAdmin, https }: { isLearn: boolean; isAdmin: boolean; https: boolean },
): Response {
  let sealed = response;
  try {
    // Probe: some responses (Response.redirect, fetch results) have immutable headers.
    sealed.headers.set("X-Content-Type-Options", "nosniff");
  } catch {
    sealed = new Response(response.body, response);
    sealed.headers.set("X-Content-Type-Options", "nosniff");
  }
  const { headers } = sealed;
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // context.url is https only via the proxy's X-Forwarded-Proto; plain http
  // locally must not pin the browser to TLS.
  if (https) headers.set("Strict-Transport-Security", "max-age=31536000");
  if (isAdmin) headers.set("Content-Security-Policy", ADMIN_CSP);
  if (isLearn) {
    headers.set("Content-Security-Policy", LEARN_CSP);
    headers.set("X-Frame-Options", "DENY");
    // What a page shows depends on who is signed in, so no shared cache may
    // keep one reader's copy for another. A route that knows better (public
    // media) says so itself.
    if (!headers.has("cache-control")) headers.set("Cache-Control", "private, no-store");
    const vary = headers.get("vary") ?? "";
    if (!/(^|,)\s*(cookie|\*)\s*(,|$)/i.test(vary)) {
      headers.set("Vary", vary === "" ? "Cookie" : `${vary}, Cookie`);
    }
  }
  return sealed;
}
