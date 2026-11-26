/**
 * Host-based routing, kept as a pure function so it can be tested without
 * booting Astro. src/middleware.ts is the thin adapter over it.
 *
 * Two hosts, blog and learn, each own a route subtree (`/blog`, `/learn`)
 * that their root is mapped onto. The apex serves everything else.
 */

import { isIPv6 } from "node:net";

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
  "_server-islands",
  "_actions",
]);

// `_image` is not listed: the site has no image endpoint (src/image-endpoint.ts
// refuses everything), so on a mapped host `/_image` is a slug like any other and
// gets that host's own 404.

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

/** The eight 16-bit groups of an IPv6 address, or undefined if it is not one. */
function ipv6Groups(address: string): number[] | undefined {
  let text = address.split("%")[0]!;
  if (!isIPv6(text)) return undefined;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, -v4[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const first = head === "" ? [] : head.split(":");
  const last = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeros = tail === undefined ? 0 : 8 - first.length - last.length;
  return [...first, ...Array<string>(zeros).fill("0"), ...last].map((g) =>
    Number.parseInt(g, 16),
  );
}

/**
 * What to throttle a client by. An IPv4 address stands for itself. A person
 * with IPv6 usually holds a whole /64, so keying on the full address would
 * hand them 2^64 fresh keys and no limit at all: key on the /64.
 */
function throttleKey(address: string): string {
  if (isLoopback(address)) return address;
  const groups = ipv6Groups(address);
  if (!groups) return address;
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/**
 * The address to throttle a login by. Normally the socket peer: headers are
 * the client's to choose, and the container image publishes the port with
 * no proxy in front. A loopback peer, or one listed in `trustedProxies`, is
 * a reverse proxy, and then X-Forwarded-For is read, but only as far in as
 * `trustedHops` proxies reach: each proxy appends the address it saw, so
 * the entry `trustedHops` places from the right is what the outermost
 * trusted proxy saw, and everything left of it is the client's to forge.
 * With zero hops the header is ignored. If the header has fewer entries
 * than hops, the chain is not what was configured, and the peer stands.
 */
export function clientIp(
  peer: string,
  forwardedFor: string | null,
  trustedProxies: readonly string[] = [],
  trustedHops = 1,
): string {
  const address = unmapped(peer);
  const believed =
    trustedHops > 0 && (isLoopback(address) || trustedProxies.includes(address));
  if (!believed) return throttleKey(address);
  const hops = (forwardedFor ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const seen = hops.length >= trustedHops ? hops.at(-trustedHops) : undefined;
  return throttleKey(seen === undefined ? address : unmapped(seen));
}

// A proxy in front of this process shows itself by one of these. Any
// `X-Forwarded-*` counts too.
const PROXY_HEADERS = [
  "forwarded",
  "via",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
];

/**
 * Whether a request is the owner's own, on this machine, and may read `local`
 * lectures: the socket peer is loopback and nothing marks the request as
 * having come through a proxy. A proxy on the same host connects from
 * loopback too, which is why the start-up check on the learn URL
 * (`loadConfig`) is the guard and this is a second layer.
 */
export function mayServeLocal(peer: string | undefined, headers: Headers): boolean {
  if (!peer || !isLoopback(unmapped(peer))) return false;
  for (const [name] of headers) {
    if (name.startsWith("x-forwarded-") || PROXY_HEADERS.includes(name)) return false;
  }
  return true;
}

const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];

/**
 * Astro's own cross-site form check (`security.checkOrigin`), done here so the
 * refusal leaves through the middleware like every other response and carries
 * its headers; Astro runs its check before any middleware, where nothing can
 * be added to its 403. Same rule: a method that changes things, with an
 * Origin other than this site's, and a body a form can send (or none).
 */
export function isForbiddenCrossOriginRequest(request: {
  method: string;
  origin: string | null;
  contentType: string | null;
  urlOrigin: string;
}): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const sameOrigin = request.origin === request.urlOrigin;
  if (request.contentType === null) return !sameOrigin;
  const type = request.contentType.toLowerCase();
  return FORM_CONTENT_TYPES.some((form) => type.includes(form)) && !sameOrigin;
}

/** A `Host` value: a name or a bracketed IPv6 address, then an optional port. Nothing else may reach a URL. */
const HOST_HEADER =
  /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/**
 * Sets on `url` the host the client asked for and, if the proxy says so, https.
 *
 * Astro builds the request URL from the `Host` header only for a host listed in
 * `security.allowedDomains`, and honours `X-Forwarded-Proto` only for such a
 * host. The hostnames here are runtime configuration, so none can be listed
 * at build time. Listing a wildcard instead is no way out: Astro then also
 * takes the client address from the first `X-Forwarded-For` entry, which the
 * client writes, and the login throttle and `mayServeLocal` rely on the socket
 * peer. So Astro is told to trust no forwarded header (an empty list), and the
 * two things the site does read are applied here, as they always were: the
 * `Host` header, and `X-Forwarded-Proto` for https alone. `X-Forwarded-Host`
 * and `X-Forwarded-Port` are never read.
 *
 * `url` is the object behind `context.url` and `Astro.url`, so every user of
 * them (cookie names and flags, the origin check, the HSTS header) sees it. It
 * is not `request.url`, which Astro resolves a rewrite path against: rewrite
 * with a URL built from `url` (see the middleware), not with a path.
 */
export function applyRequestOrigin(
  url: URL,
  host: string | null,
  forwardedProto: string | null,
): void {
  if (host !== null && HOST_HEADER.test(host)) {
    // Setting `host` without a port keeps the old port.
    url.port = "";
    url.host = host;
  }
  if (forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https")
    url.protocol = "https:";
}
