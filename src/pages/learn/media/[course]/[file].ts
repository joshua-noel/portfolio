import type { APIRoute } from "astro";
import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { getConfig } from "../../../../lib/config.ts";
import { findCourse } from "../../../../lib/learn/catalog.ts";
import { getCatalog } from "../../../../lib/learn/content.ts";

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  vtt: "text/vtt; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
};

/** `NN-slug.mp4`, `NN-slug.vtt` or `NN-slug.poster.png`: the files that sit beside a lecture. */
const FILE = /^(\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)(?:\.poster)?\.(mp4|vtt|png|jpg)$/;

/**
 * The video, captions and poster of a lecture, from the content folder. Only
 * names the contract allows, of a lecture this process may show, are served:
 * the folder holds locked lectures' files too, and `..` must go nowhere.
 */
export const GET: APIRoute = async ({ url, request }) => {
  // From the address, not `params`: this route is reached by the learn host's
  // rewrite, which leaves `params` empty for an endpoint.
  const [, courseSlug, name = ""] =
    /^\/media\/([^/]+)\/([^/]+)$/.exec(url.pathname) ?? [];
  const match = FILE.exec(name);
  const catalog = await getCatalog();
  const course = findCourse(catalog, courseSlug);
  const lecture = course?.lectures.find((l) => l.file === match?.[1]);
  const available =
    lecture &&
    !lecture.locked &&
    (name === `${lecture.file}.mp4` ||
      name === `${lecture.file}.vtt` ||
      name === lecture.media.poster);
  if (!match || !course || !available) return new Response("Not found", { status: 404 });

  const path = join(getConfig().learnContentDir, course.front.slug, name);
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "content-type": TYPES[match[2]!]!,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=300",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!range) {
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { ...headers, "content-length": String(size) },
    });
  }

  // A suffix range ("-500") is the last 500 bytes.
  const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  const end =
    range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (!(start <= end) || start >= size) {
    return new Response("Range not satisfiable", {
      status: 416,
      headers: { "content-range": `bytes */${size}` },
    });
  }
  return new Response(
    Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream,
    {
      status: 206,
      headers: {
        ...headers,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
      },
    },
  );
};
