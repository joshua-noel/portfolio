/**
 * Host-based routing, kept as a pure function so it can be tested without
 * booting Astro. src/middleware.ts is the thin adapter over it.
 *
 * Two hosts, blog and learn, each own a route subtree (`/blog`, `/learn`)
 * that their root is mapped onto. The apex serves everything else.
 */

/** First path segments a mapped host serves itself instead of treating as a slug. */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "uploads",
  "healthz",
  "blog",
  "learn",
  "rss.xml",
  "sitemap.xml",
  "robots.txt",
  "favicon.ico",
  "_astro",
  "_image",
  "_server-islands",
  "_actions",
]);

export type RouteAction =
  | { kind: "pass" }
  | { kind: "rewrite"; path: string }
  | { kind: "redirect"; location: string };

export interface RouteInput {
  host: string;
  pathname: string;
  search: string;
  blogHost: string;
  blogUrl: string;
  learnHost: string;
  learnUrl: string;
}

/** `/blog/x` -> `/x`: the path with its subtree prefix removed. */
const unprefixed = (pathname: string, prefix: string): string =>
  pathname.slice(prefix.length) || "/";

const isUnder = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function resolveRoute({
  host,
  pathname,
  search,
  blogHost,
  blogUrl,
  learnHost,
  learnUrl,
}: RouteInput): RouteAction {
  // The /blog and /learn prefixes are implementation details of the route
  // tree. They are never reachable URLs on any host, so a page has exactly
  // one address.
  if (isUnder(pathname, "/blog")) {
    return {
      kind: "redirect",
      location: `${blogUrl}${unprefixed(pathname, "/blog")}${search}`,
    };
  }
  if (isUnder(pathname, "/learn")) {
    return {
      kind: "redirect",
      location: `${learnUrl}${unprefixed(pathname, "/learn")}${search}`,
    };
  }

  // The admin lives on the blog host alone.
  if (host !== blogHost && isUnder(pathname, "/admin")) {
    return { kind: "redirect", location: `${blogUrl}${pathname}${search}` };
  }

  const subtree = host === blogHost ? "/blog" : host === learnHost ? "/learn" : undefined;
  if (subtree === undefined) return { kind: "pass" };

  const [, firstSegment = ""] = pathname.split("/");
  if (RESERVED_SEGMENTS.has(firstSegment)) return { kind: "pass" };

  return {
    kind: "rewrite",
    path: `${subtree}${pathname === "/" ? "" : pathname}${search}`,
  };
}

const unmapped = (address: string): string => address.replace(/^::ffff:(?=\d+\.)/, "");

const isLoopback = (address: string): boolean =>
  address === "::1" || address.startsWith("127.");

/**
 * The address to throttle a login by. Normally the socket peer: headers are
 * the client's to choose, and the container image publishes the port with
 * no proxy in front. A loopback peer, or one listed in `trustedProxies`, is
 * a reverse proxy, and then the last X-Forwarded-For entry is the address it
 * saw — each proxy appends its peer, so the leftmost values are whatever the
 * client sent.
 */
export function clientIp(
  peer: string,
  forwardedFor: string | null,
  trustedProxies: readonly string[] = [],
): string {
  const address = unmapped(peer);
  if (!isLoopback(address) && !trustedProxies.includes(address)) return address;
  const hops = (forwardedFor ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1) ?? address;
}
