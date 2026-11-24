import { parseRole } from "../access.ts";
import { getConfig } from "../config.ts";
import { forViewer, loadCatalog, type Catalog } from "./catalog.ts";
import { contentSignature, readContentDirs } from "./disk.ts";

/** How often a request may stat the content folders to see whether they changed. */
const RECHECK_MS = 1000;

export interface StoreOptions {
  dirs: readonly string[];
  /** Whether `local` content is loaded at all (the configuration's switch). */
  allowLocal: boolean;
  signature?: (dirs: readonly string[]) => string;
  load?: (dirs: readonly string[], allowLocal: boolean) => Promise<Catalog>;
  recheckMs?: number;
  log?: (message: string) => void;
}

interface Loaded {
  signature: string;
  /** Everything, rendered once. It never leaves this module: see `get`. */
  full: Catalog;
  /** The catalog as each kind of reader sees it, built on first need. */
  views: Map<string, Catalog>;
}

export interface CatalogStore {
  get(role: unknown, allowLocal?: boolean): Promise<Catalog>;
}

/**
 * The catalog of the content folders, read at run time and kept current, one
 * per process (`getCatalogFor`), or one per test.
 *
 * Reloading never holds a request: when a file has changed, the new catalog is
 * built in the background (which gives the event loop back between lectures)
 * and the previous one is served until it is done, then swapped in at once. Only
 * the very first request has nothing to serve and waits for the first build.
 * A build that fails keeps the previous catalog and is tried again on the
 * next change.
 */
export function createCatalogStore(options: StoreOptions): CatalogStore {
  const {
    dirs,
    allowLocal: loadLocal,
    signature = contentSignature,
    load = (folders, local) =>
      loadCatalog(readContentDirs(folders), { allowLocal: local, lenient: true }),
    recheckMs = RECHECK_MS,
    log = (message) => console.error(message),
  } = options;

  let current: Loaded | undefined;
  let building: Promise<void> | undefined;
  let checkedAt = 0;

  function build(sig: string): Promise<void> {
    const started = (async () => {
      try {
        const full = await load(dirs, loadLocal);
        for (const problem of full.problems) {
          log(`learn: LEFT OUT, cannot be loaded: ${problem}`);
        }
        if (full.localIgnored > 0) {
          log(
            `learn: ${full.localIgnored} local lecture(s) or course(s) left out: a server does not serve them`,
          );
        }
        // The swap: one assignment, so a request sees the old catalog or the new, never half.
        current = { signature: sig, full, views: new Map() };
      } catch (error) {
        // Keep what is being served. A signature that cannot match makes the
        // next check try again instead of waiting for another edit.
        log(`learn: reloading the content failed, still serving the previous: ${error}`);
        current = {
          views: new Map(),
          ...current,
          signature: `failed:${sig}`,
          full: current?.full ?? {
            shelves: [],
            courses: [],
            lectures: [],
            warnings: [],
            localIgnored: 0,
            problems: [String(error)],
            problemCount: 1,
          },
        };
      } finally {
        building = undefined;
      }
    })();
    building = started;
    return started;
  }

  return {
    /**
     * The catalog as `role` sees it (undefined for a visitor): the only way a
     * page, an endpoint or a media route gets lecture content, so that what a
     * reader may not open is a stub by the time any of them sees it.
     * `allowLocal` is the request's own say (the owner's machine), and cannot
     * widen what the configuration did not load.
     */
    async get(role: unknown, allowLocal = false): Promise<Catalog> {
      const now = Date.now();
      if (!current) {
        // Nothing to serve yet: wait for the first build, and only for it.
        await (building ?? build(signature(dirs)));
      } else if (!building && now - checkedAt >= recheckMs) {
        checkedAt = now;
        const sig = signature(dirs);
        if (sig !== current.signature) void build(sig);
      }
      const loaded = current!;
      const key = parseRole(role) ?? "visitor";
      const local = loadLocal && allowLocal;
      const viewKey = `${key}:${local}`;
      let view = loaded.views.get(viewKey);
      if (!view) {
        view = forViewer(loaded.full, key === "visitor" ? undefined : key, local);
        loaded.views.set(viewKey, view);
      }
      return view;
    },
  };
}

let store: CatalogStore | undefined;

/**
 * The catalog as `role` sees it (undefined for a visitor); see
 * `createCatalogStore`. `allowLocal` is the request's: true only on the
 * owner's own machine.
 */
export function getCatalogFor(role: unknown, allowLocal = false): Promise<Catalog> {
  if (!store) {
    const { learnContentDirs, learnAllowLocal } = getConfig();
    store = createCatalogStore({ dirs: learnContentDirs, allowLocal: learnAllowLocal });
  }
  return store.get(role, allowLocal);
}
