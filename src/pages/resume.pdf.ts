import type { APIRoute } from "astro";
// `?inline` makes the bundler embed the file as a base64 data URL, so the
// resume ships inside the server bundle like everything else (the package
// has no public/ directory). Replace src/assets/resume.pdf to update it.
import dataUrl from "../assets/resume.pdf?inline";

const pdf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

export const GET: APIRoute = () =>
  new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="Joshua-Noel-Resume.pdf"',
      "cache-control": "public, max-age=3600",
    },
  });
