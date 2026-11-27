import type { APIRoute } from "astro";
import { getConfig } from "../lib/config.ts";

export const GET: APIRoute = ({ url }) => {
  const { blogUrl, learnHost, learnStealth } = getConfig();
  // A stealth release is not announced: the lecture host asks every crawler to stay away
  // and names no sitemap. (The header and the meta tag say the same, for the ones that ask
  // too late; this is discoverability control, not access control.)
  if (learnStealth !== "off" && url.host === learnHost) {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: { "content-type": "text/plain" },
    });
  }
  return new Response(
    `User-agent: *\nDisallow: /admin\nDisallow: /api\n\nSitemap: ${blogUrl}/sitemap.xml\n`,
    { headers: { "content-type": "text/plain" } },
  );
};
