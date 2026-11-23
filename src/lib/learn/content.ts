import { loadCatalog, type Catalog } from "./catalog.ts";
import { getConfig } from "../config.ts";
import { contentSignature, readContentDir } from "./disk.ts";
import type { Visibility } from "./lecture.ts";

/**
 * What this process may show. Everything else is listed, locked, with its
 * body neither rendered nor kept. Opening more of it to a signed-in reader
 * means deciding the audience per request, from the session, and keeping one
 * catalog per audience: see "Private lectures" in the README.
 */
const AUDIENCE: readonly Visibility[] = ["public"];

/** How often a request may stat the content folder to see whether it changed. */
const RECHECK_MS = 1000;

interface Loaded {
  signature: string;
  catalog: Promise<Catalog>;
  checkedAt: number;
}

let loaded: Loaded | undefined;

/**
 * The catalog, built from the content folder on first use and rebuilt when a
 * file in it changes, so a lecture can be edited without restarting the
 * server. Rendering is the slow part, so an unchanged folder costs one stat
 * walk a second, not a rebuild.
 */
export async function getCatalog(): Promise<Catalog> {
  const { learnContentDir } = getConfig();
  const now = Date.now();
  if (loaded && now - loaded.checkedAt < RECHECK_MS) return loaded.catalog;

  const signature = contentSignature(learnContentDir);
  if (loaded && loaded.signature === signature) {
    loaded.checkedAt = now;
    return loaded.catalog;
  }

  const catalog = loadCatalog(readContentDir(learnContentDir), AUDIENCE);
  const entry: Loaded = { signature, catalog, checkedAt: now };
  loaded = entry;
  // A broken edit must not stick: the next request tries again.
  catalog.catch(() => {
    if (loaded === entry) loaded = undefined;
  });
  return catalog;
}
