import { defineMiddleware } from "astro:middleware";
import {
  LEARN_COOKIE,
  SESSION_COOKIE,
  learnViewer,
  validateSession,
} from "./lib/auth.ts";
import { getConfig } from "./lib/config.ts";
import { resolveRoute } from "./lib/routing.ts";

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

/**
 * One process serves every hostname. Routes live under src/pages/blog/ and
 * src/pages/learn/, and each host maps its root onto its subtree, so
 * `blog.example.com/a-post` renders `/blog/a-post` without the prefix ever
 * appearing in a URL.
 *
 * The admin lives on the blog host alone. Serving it from both would mean two
 * session cookies on two origins and a login that appears to do nothing.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const config = getConfig();
  const { pathname, search } = context.url;
  const host = context.request.headers.get("host") ?? context.url.host;

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

  const isLearn = host === config.learnHost;
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
    context.locals.viewer = learnViewer(context.cookies.get(LEARN_COOKIE)?.value);
  }

  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
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

  const response = await (action.kind === "rewrite" ? next(action.path) : next());
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // context.url is https only via the proxy's X-Forwarded-Proto; plain http
  // locally must not pin the browser to TLS.
  if (context.url.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  if (isAdmin) response.headers.set("Content-Security-Policy", ADMIN_CSP);
  if (isLearn) {
    // What a page shows depends on who is signed in, so no shared cache may
    // keep one reader's copy for another. A route that knows better (public
    // media) says so itself.
    if (!response.headers.has("cache-control")) {
      response.headers.set("Cache-Control", "private, no-store");
    }
    response.headers.append("Vary", "Cookie");
  }
  return response;
});
