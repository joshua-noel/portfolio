import type { APIRoute } from "astro";
import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { findCourse } from "../../../../lib/learn/catalog.ts";
import { getCatalogFor } from "../../../../lib/learn/content.ts";

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  vtt: "text/vtt; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
};

/**
 * `slug.mp4`, `slug.vtt` or `slug.poster.png`: the files that sit beside a
 * lecture, named by its slug. The file on disk is `NN-slug.mp4`, but that
 * number is the lecture's place among every lecture, hidden ones included, so
 * it is never in a URL; a numbered name matches no lecture and is a 404.
 */
const FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)(\.poster)?\.(mp4|vtt|png|jpg)$/;

/**
 * The video, captions and poster of a lecture, from the content folder. Only
 * names the contract allows, of a lecture this process may show, are served:
 * the folder holds locked lectures' files too, and `..` must go nowhere.
 */
export const GET: APIRoute = async ({ url, request, locals }) => {
  // From the address, not `params`: this route is reached by the learn host's
  // rewrite, which leaves `params` empty for an endpoint.
  const [, courseSlug, name = ""] =
    /^\/media\/([^/]+)\/([^/]+)$/.exec(url.pathname) ?? [];
  const match = FILE.exec(name);
  // The reader's own catalog: a lecture they may not open is a stub with no files.
  const catalog = await getCatalogFor(locals.viewer?.role, locals.allowLocal);
  const course = findCourse(catalog, courseSlug);
  const lecture = course?.lectures.find((l) => l.slug === match?.[1]);
  // The real file name, from what the loader found beside the lecture.
  const [, , isPoster, ext] = match ?? [];
  const file =
    lecture && !lecture.locked
      ? isPoster
        ? lecture.media.poster?.endsWith(`.poster.${ext}`)
          ? lecture.media.poster
          : undefined
        : ext === "mp4" || ext === "vtt"
          ? `${lecture.file}.${ext}`
          : undefined
      : undefined;
  if (!match || !course || !lecture || !file) return new Response("Not found", { status: 404 });

  const path = join(course.dir, file);
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "content-type": TYPES[ext!]!,
    "accept-ranges": "bytes",
    // Anyone may cache what anyone may read; what needs an account does not
    // leave the browser that asked.
    "cache-control":
      lecture.front.visibility === "public" && course.front.visibility === "public"
        ? "public, max-age=300"
        : "private, no-store",
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
