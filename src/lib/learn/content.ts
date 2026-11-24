import { parseRole } from "../access.ts";
import { getConfig } from "../config.ts";
import { forViewer, loadCatalog, type Catalog } from "./catalog.ts";
import { contentSignature, readContentDirs } from "./disk.ts";

/** How often a request may stat the content folders to see whether they changed. */
const RECHECK_MS = 1000;

interface Loaded {
  signature: string;
  /** Everything, rendered once. It never leaves this module: see `getCatalogFor`. */
  full: Promise<Catalog>;
  /** The catalog as each kind of reader sees it, built on first need. */
  views: Map<string, Promise<Catalog>>;
  checkedAt: number;
}

let loaded: Loaded | undefined;

/**
 * The catalog as `role` sees it (undefined for a visitor): the only way a page,
 * an endpoint or a media route gets lecture content, so that what a reader may
 * not open is a stub by the time any of them sees it. The folders are read at
 * run time, on first use and again when a file in them changes, so a lecture
 * can be edited without restarting the server. Rendering is the slow part, so
 * an unchanged folder costs one stat walk a second.
 */
export async function getCatalogFor(role: unknown): Promise<Catalog> {
  const { learnContentDirs, learnAllowLocal } = getConfig();
  const now = Date.now();

  if (!loaded || now - loaded.checkedAt >= RECHECK_MS) {
    const signature = contentSignature(learnContentDirs);
    if (loaded && loaded.signature === signature) {
      loaded.checkedAt = now;
    } else {
      const full = loadCatalog(readContentDirs(learnContentDirs), {
        allowLocal: learnAllowLocal,
      });
      const entry: Loaded = { signature, full, views: new Map(), checkedAt: now };
      loaded = entry;
      full.then(
        (catalog) => {
          if (catalog.localIgnored > 0) {
            console.warn(
              `learn: ${catalog.localIgnored} local lecture(s) or course(s) left out: a server does not serve them`,
            );
          }
        },
        () => {
          // A broken edit must not stick: the next request tries again.
          if (loaded === entry) loaded = undefined;
        },
      );
    }
  }

  const current = loaded!;
  const key = parseRole(role) ?? "visitor";
  let view = current.views.get(key);
  if (!view) {
    view = current.full.then((catalog) =>
      forViewer(catalog, key === "visitor" ? undefined : key, learnAllowLocal),
    );
    current.views.set(key, view);
  }
  return view;
}
