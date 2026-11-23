import type { APIRoute } from "astro";
import { getCatalog } from "../../lib/learn/content.ts";
import { search } from "../../lib/learn/search.ts";

// The top-bar search box asks this per keystroke instead of shipping an
// index to the browser: the server already holds the text.
export const GET: APIRoute = async ({ url }) => {
  const query = (url.searchParams.get("q") ?? "").slice(0, 200);
  const { lectures } = await getCatalog();
  return Response.json(search(lectures, query, 8), {
    headers: { "cache-control": "no-store" },
  });
};
