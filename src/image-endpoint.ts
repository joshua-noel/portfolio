import type { APIRoute } from "astro";

// Astro's image endpoint, replaced (image.endpoint in astro.config.mjs). The site
// does not use astro:assets: uploads are resized in the browser. The stock endpoint
// reads files from the build output and runs the image service on them; there is
// nothing here for it to do, so no image code ships and every method answers 404.
// The middleware sends a request that reaches this route to the 404 page.
export const ALL: APIRoute = () => new Response(null, { status: 404 });
