import type { APIRoute } from "astro";
import {
  SESSION_COOKIE,
  checkCredentials,
  clearFailures,
  createSession,
  isLockedOut,
  recordFailure,
} from "../../lib/auth.ts";
import { getConfig } from "../../lib/config.ts";
import { clientIp } from "../../lib/routing.ts";

/** A username, a password and a path; anything bigger is not a login. */
const MAX_BODY_BYTES = 4096;

/**
 * Only admin paths on this origin. Resolving it the way the browser will is
 * what catches `/\evil.example` and friends, which a prefix check misses.
 */
function safeNext(value: string, base: URL): string {
  const url = URL.parse(value, base);
  if (!url || url.origin !== base.origin) return "/admin";
  if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return "/admin";
  return url.pathname + url.search;
}

export const POST: APIRoute = async (context) => {
  // Both checks run before formData(), which buffers the whole body.
  // A missing Content-Length counts as too large: browsers always send one.
  const length = Number(context.request.headers.get("content-length") ?? Infinity);
  if (!(length <= MAX_BODY_BYTES)) return new Response("Too large", { status: 413 });

  const ip = clientIp(
    context.clientAddress,
    context.request.headers.get("x-forwarded-for"),
    getConfig().trustedProxies,
    getConfig().trustedProxyHops,
  );
  if (isLockedOut(ip)) return context.redirect("/admin/login?locked", 303);

  const form = await context.request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""), context.url);

  if (!(await checkCredentials(username, password))) {
    recordFailure(ip);
    return context.redirect(`/admin/login?failed&next=${encodeURIComponent(next)}`, 303);
  }

  clearFailures(ip);
  const { token, expiresAt } = createSession();

  context.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Behind a TLS-terminating proxy in production; plain http locally.
    secure: context.url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt * 1000),
  });

  return context.redirect(next, 303);
};
