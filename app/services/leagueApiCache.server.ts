import { onLeagueUpdated } from "./cacheInvalidation.server";

/**
 * Per-route in-memory response caches, keyed by a cache name.
 *
 * These live in a `.server` module on purpose: the invalidation bus they
 * subscribe to ({@link onLeagueUpdated}) is backed by Redis, which must never
 * be pulled into the client bundle. API route loaders previously declared the
 * cache `Map` and the `onLeagueUpdated` subscription at their own module top
 * level; that ran at import time and dragged the server-only bus into the
 * client graph. Routes now obtain a cache lazily from {@link getLeagueApiCache}
 * inside their loader instead, so the server-only code is stripped from the
 * client build.
 *
 * Entries are cleared — locally and across processes via Redis — whenever the
 * relevant league is updated. Cache keys embed the league id(s), so a substring
 * match mirrors the original per-route invalidation behaviour.
 */
const namedCaches = new Map<string, Map<string, unknown>>();

function cacheFor(name: string): Map<string, unknown> {
  let cache = namedCaches.get(name);
  if (!cache) {
    cache = new Map<string, unknown>();
    namedCaches.set(name, cache);
  }
  return cache;
}

// A single subscription clears matching keys across every named cache.
onLeagueUpdated((leagueId) => {
  for (const cache of namedCaches.values()) {
    for (const key of cache.keys()) {
      if (key.includes(leagueId)) {
        cache.delete(key);
      }
    }
  }
});

export interface LeagueApiCache<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
}

/**
 * Returns the named in-memory cache, creating it on first use. Call this inside
 * a route loader (never at module top level) so the server-only invalidation
 * bus is not referenced from client-retained code.
 */
export function getLeagueApiCache<T>(name: string): LeagueApiCache<T> {
  const cache = cacheFor(name);
  return {
    get(key: string): T | null {
      return (cache.get(key) as T | undefined) ?? null;
    },
    set(key: string, value: T): void {
      cache.set(key, value as unknown);
    },
  };
}
