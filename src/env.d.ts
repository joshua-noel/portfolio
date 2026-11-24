/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Who is signed in on the lecture host; set by the middleware, undefined for a visitor. */
    viewer?: import("./lib/sessions.ts").Principal;
    /** The path and query the reader asked for, before the host rewrote them onto /learn/…. */
    here?: { pathname: string; search: string };
  }
}
