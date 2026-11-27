import type { APIRoute } from "astro";
import { getConfig } from "../lib/config.ts";
import { isoDate } from "../lib/format.ts";
import { getCatalogFor } from "../lib/learn/content.ts";
import { listPublished } from "../lib/posts.ts";

const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const xml = (text: string): string => text.replace(/[&<>"']/g, (c) => XML_ENTITIES[c]!);

// Hand-rolled rather than @astrojs/sitemap: the URL set lives in SQLite and
// is only known at request time, which a build-time integration cannot see.
export const GET: APIRoute = async () => {
  const { blogUrl, siteUrl, learnUrl, learnStealth } = getConfig();
  // A stealth release leaves the lecture host out of every sitemap.
  const showLearn = learnStealth === "off";
  // Crawlers are visitors: only what anyone may read goes in.
  const entries = [
    `<url><loc>${xml(siteUrl)}/</loc></url>`,
    `<url><loc>${xml(blogUrl)}/</loc></url>`,
    ...(showLearn ? [`<url><loc>${xml(learnUrl)}/</loc></url>`] : []),
    ...(showLearn ? (await getCatalogFor(undefined)).lectures : [])
      .filter((lecture) => !lecture.locked && !lecture.front.placeholder)
      .map(
        (lecture) =>
          `<url><loc>${xml(`${learnUrl}/${lecture.course}/${lecture.slug}`)}</loc></url>`,
      ),
    ...listPublished().map(
      (post) =>
        `<url><loc>${xml(`${blogUrl}/${post.slug}`)}</loc><lastmod>${isoDate(post.updated_at)}</lastmod></url>`,
    ),
  ];

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`,
    { headers: { "content-type": "application/xml" } },
  );
};
