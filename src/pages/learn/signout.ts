import type { APIRoute } from "astro";
import {
  LEARN_COOKIE,
  LEARN_COOKIE_HOST,
  destroySession,
  learnCookieName,
} from "../../lib/auth.ts";
import { safeNext } from "../../lib/users.ts";

/**
 * Ends the lecture-host session: the row is deleted, so the token is dead
 * even if a copy of the cookie survives, and the cookie is cleared. POST only
 * (the middleware has checked the Origin): a link or an image cannot sign
 * anyone out. The admin's logout is separate and does not touch this one.
 */
export const POST: APIRoute = async (context) => {
  // The session this request is signed in with, and the cookie under either
  // name, so nothing is left behind if the site moved between http and https.
  destroySession(context.cookies.get(learnCookieName(context.url))?.value);
  context.cookies.delete(LEARN_COOKIE_HOST, { path: "/", secure: true });
  context.cookies.delete(LEARN_COOKIE, { path: "/" });
  const form = await context.request.formData().catch(() => undefined);
  return context.redirect(safeNext(form?.get("next"), context.url), 303);
};

export const GET: APIRoute = (context) => context.redirect("/", 303);
