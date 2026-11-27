import { getConfig } from "./config.ts";

/**
 * The `Domain` of the `theme` preference cookie, so the dark or light choice made
 * on one of the site's hostnames carries to the others: the longest run of
 * dot-separated labels that the three configured hostnames end with, if it has
 * at least two labels. `example.com` for `example.com`, `blog.example.com` and
 * `learn.example.com`. None (so no cookie, and the choice stays per host as
 * before) when there is no such run, on a single-label host such as
 * `localhost`, and for an IP address.
 *
 * It does not know the public suffix list and does not pretend to: for
 * `a.co.uk` and `b.co.uk` it answers `co.uk`, which a browser refuses as a
 * cookie domain, and the per-host choice (localStorage) still works.
 *
 * The cookie is a preference for the page script and nothing else. THE SERVER
 * NEVER READS IT: no route, middleware or API looks at a cookie called `theme`
 * (the only cookies read are the admin and lecture sessions), so it cannot
 * change what is served or cached.
 */
export function themeCookieDomain(urls: string[]): string | undefined {
  const hosts = urls.map((url) => new URL(url).hostname.toLowerCase());
  if (hosts.some((host) => host.includes(":") || /^[\d.]+$/.test(host))) return undefined;
  const reversed = hosts.map((host) => host.split(".").reverse());
  const shared: string[] = [];
  for (let i = 0; reversed.every((labels) => labels[i] !== undefined); i++) {
    const label = reversed[0]![i]!;
    if (!reversed.every((labels) => labels[i] === label)) break;
    shared.push(label);
  }
  return shared.length >= 2 ? shared.reverse().join(".") : undefined;
}

/** The domain for the configured site, blog and lecture hostnames. */
export function configuredThemeCookieDomain(): string | undefined {
  const { siteUrl, blogUrl, learnUrl } = getConfig();
  return themeCookieDomain([siteUrl, blogUrl, learnUrl]);
}
