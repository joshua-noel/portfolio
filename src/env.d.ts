/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Who is signed in on the lecture host; set by the middleware, undefined for a visitor. */
    viewer?: import("./lib/sessions.ts").Principal;
    /** Whether this request may read `local` lectures: the owner's own, from this machine, and the dev server. */
    allowLocal?: boolean;
    /** The path and query the reader asked for, before the host rewrote them onto /learn/…. */
    here?: { pathname: string; search: string };
  }
}
