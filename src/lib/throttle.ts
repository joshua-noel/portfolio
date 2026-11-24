/**
 * Sign-in throttling, shared by the admin login and the lecture host's. Keys
 * are whatever the caller counts (an address, a username); the admin uses the
 * bare address and the lecture host prefixes its keys, so the two do not
 * share a lockout.
 */
const MAX_FAILURES = 5;
const LOCKOUT_SECONDS = 15 * 60;
// Enough for every address that plausibly fails in one lockout window;
// beyond it the oldest entry goes, so rotating addresses cannot grow memory.
const MAX_TRACKED = 10_000;

// ponytail: in-process Map, so a restart forgives everyone. Correct for one
// process; move it beside the sessions table if this ever runs more than one
// replica.
const failures = new Map<string, { count: number; until: number }>();

const clock = (): number => Math.floor(Date.now() / 1000);

export function isLockedOut(key: string, now: number = clock()): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.until <= now) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(key: string, now: number = clock()): void {
  const entry = failures.get(key) ?? { count: 0, until: 0 };
  entry.count += 1;
  entry.until = now + LOCKOUT_SECONDS;
  // Re-insert so Map order stays oldest-failure-first for eviction.
  failures.delete(key);
  if (failures.size >= MAX_TRACKED) {
    failures.delete(failures.keys().next().value!);
  }
  failures.set(key, entry);
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
