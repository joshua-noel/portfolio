import type { APIRoute } from "astro";
import { buildShelves } from "../../../lib/learn/bookshelf.ts";
import { coverSvgText } from "../../../lib/learn/cover-image.ts";
import { getCatalogFor } from "../../../lib/learn/content.ts";

/**
 * `slug.svg`: a course's front cover as its own image, for the shelf to draw
 * once. It is built from the reader's own catalog, so a course they may not
 * open gets the plain locked cover (its title, a padlock) and no illustration,
 * and a course they are not told of is a 404, exactly as on the landing page.
 * The image is the same for every request of that reader, so it may be cached
 * by that reader's browser (and by no shared cache: Vary: Cookie is set for the
 * whole host).
 */
const FILE = /^\/covers\/([a-z0-9]+(?:-[a-z0-9]+)*)\.svg$/;

export const GET: APIRoute = async ({ url, locals }) => {
  const slug = FILE.exec(url.pathname)?.[1];
  const catalog = await getCatalogFor(locals.viewer?.role, locals.allowLocal);
  const book = slug
    ? buildShelves(catalog)
        .flatMap((shelf) => shelf.books)
        .find((candidate) => candidate.slug === slug)
    : undefined;
  if (!book) return new Response("Not found", { status: 404 });
  return new Response(coverSvgText(book), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
};
