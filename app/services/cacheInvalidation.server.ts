/**
 * Cross-process event bus for cache invalidation.
 *
 * The league worker emits "league-updated" after new games are saved or
 * hydrated; API-route caches subscribe and clear stale entries.
 *
 * The worker (game hydration, Discord bot) and the web server
 * (`react-router-serve`) run as **separate processes**, so an in-memory
 * listener list alone never reaches the web server's caches. We therefore
 * fan the event out over Redis Pub/Sub: every process publishes its emits and
 * subscribes to the shared channel, so an update produced in one process
 * invalidates the in-memory caches of all the others.
 *
 * Local listeners still fire synchronously inside the emitting process; the
 * Redis round-trip only carries the event to *other* processes. Each published
 * message is tagged with this process's origin id so a process ignores the
 * echo of its own emit (its local listeners already ran).
 */
import type Redis from "ioredis";

import { createRedisClient } from "./redisConnection.server";

type Listener = (leagueId: string) => void;
const listeners: Listener[] = [];

/** Redis Pub/Sub channel carrying league-updated events between processes. */
const CHANNEL = "kandora:cache:league-updated";

/**
 * Identifies this process so it can skip the Redis echo of its own published
 * emit (local listeners already ran synchronously in {@link emitLeagueUpdated}).
 */
const ORIGIN = `${process.pid}-${Math.random().toString(36).slice(2)}`;

let publisher: Redis | null = null;
let subscriber: Redis | null = null;

function fireLocal(leagueId: string): void {
  for (const listener of listeners) {
    try {
      listener(leagueId);
    } catch (err) {
      console.error("[cacheInvalidation] listener threw:", err);
    }
  }
}

/** Lazily create the dedicated publisher connection (best-effort). */
function ensurePublisher(): void {
  if (publisher) {
    return;
  }
  try {
    publisher = createRedisClient();
    publisher.on("error", (err) => {
      console.error("[cacheInvalidation] publisher error:", err);
    });
  } catch (err) {
    console.error(
      "[cacheInvalidation] failed to create publisher; staying in-process only:",
      err
    );
  }
}

/**
 * Lazily create the dedicated subscriber connection and start fanning remote
 * events into the local listeners (best-effort). A subscriber connection
 * enters Redis "subscriber mode", so it must not be shared with anything else.
 */
function ensureSubscriber(): void {
  if (subscriber) {
    return;
  }
  try {
    subscriber = createRedisClient();
    subscriber.on("error", (err) => {
      console.error("[cacheInvalidation] subscriber error:", err);
    });
    subscriber.subscribe(CHANNEL, (err) => {
      if (err) {
        console.error("[cacheInvalidation] failed to subscribe:", err);
      }
    });
    subscriber.on("message", (channel, message) => {
      if (channel !== CHANNEL) {
        return;
      }
      try {
        const payload = JSON.parse(message) as {
          leagueId?: string;
          origin?: string;
        };
        // Skip our own emit — its local listeners already ran synchronously.
        if (payload.origin === ORIGIN || !payload.leagueId) {
          return;
        }
        fireLocal(payload.leagueId);
      } catch (err) {
        console.error("[cacheInvalidation] bad message:", err);
      }
    });
  } catch (err) {
    console.error(
      "[cacheInvalidation] failed to create subscriber; staying in-process only:",
      err
    );
  }
}

export function onLeagueUpdated(listener: Listener): () => void {
  listeners.push(listener);
  // A process only needs to receive remote events once it has caches to clear.
  ensureSubscriber();
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) {
      listeners.splice(idx, 1);
    }
  };
}

export function emitLeagueUpdated(leagueId: string): void {
  // Clear caches in this process immediately…
  fireLocal(leagueId);
  // …and notify the other processes (web server, worker, bot) over Redis.
  ensurePublisher();
  publisher
    ?.publish(CHANNEL, JSON.stringify({ leagueId, origin: ORIGIN }))
    .catch((err) => {
      console.error("[cacheInvalidation] publish failed:", err);
    });
}
