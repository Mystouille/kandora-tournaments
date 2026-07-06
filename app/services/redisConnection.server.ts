import Redis from "ioredis";

function firstDefined(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function isLocalRedisHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function shouldUseTls(
  redisUrl: string | undefined,
  redisTlsFlag: boolean
): boolean {
  if (redisTlsFlag) {
    return true;
  }

  if (!redisUrl) {
    return false;
  }

  return redisUrl.startsWith("rediss://");
}

function createRedisConnection(): Redis {
  const redisUrlCandidates = [
    ["REDIS_URL", process.env.REDIS_URL],
    ["REDIS_URI", process.env.REDIS_URI],
    ["REDIS_PRIVATE_URL", process.env.REDIS_PRIVATE_URL],
    ["REDIS_PRIVATE_URI", process.env.REDIS_PRIVATE_URI],
    ["REDIS_PUBLIC_URL", process.env.REDIS_PUBLIC_URL],
    ["REDIS_PUBLIC_URI", process.env.REDIS_PUBLIC_URI],
  ] as const;
  const redisUrlEntry = redisUrlCandidates.find(([, value]) => {
    return Boolean(value && value.trim().length > 0);
  });
  const redisUrl = redisUrlEntry?.[1]?.trim();
  const redisUrlSource = redisUrlEntry?.[0];
  const _redisUrlPresence = redisUrlCandidates
    .map(([key, value]) => {
      return `${key}=${value && value.trim().length > 0 ? "set" : "missing"}`;
    })
    .join(", ");
  const redisHost = firstDefined(process.env.REDIS_HOST, process.env.REDISHOST);
  const redisPortRaw = firstDefined(
    process.env.REDIS_PORT,
    process.env.REDISPORT
  );
  const redisTls = process.env.REDIS_TLS === "true";
  const useTls = shouldUseTls(redisUrl, redisTls);

  if (redisUrl) {
    console.log(
      `[Redis] Connection mode: ${redisUrlSource ?? "URL env"} (tls=${useTls ? "on" : "off"})`
    );

    return new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
    });
  }

  const host = redisHost || "127.0.0.1";
  const port = Number.parseInt(redisPortRaw || "6379", 10);
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && isLocalRedisHost(host)) {
    throw new Error(
      "Redis is configured with a local host in production. Set REDIS_URL, REDIS_URI, REDIS_PRIVATE_URL, or REDIS_PRIVATE_URI to your Redis service connection string."
    );
  }

  return new Redis({
    host,
    port,
    maxRetriesPerRequest: null,
    ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

/**
 * Returns true when Redis is explicitly configured via any supported env var
 * (a connection URL or a discrete host/port). Does NOT count the implicit
 * `127.0.0.1:6379` dev fallback — callers use this to decide whether to bring
 * up the Redis-backed job subsystem at all, so an unset environment means
 * "no Redis, don't start the background workers".
 */
export function isRedisConfigured(): boolean {
  return Boolean(
    firstDefined(
      process.env.REDIS_URL,
      process.env.REDIS_URI,
      process.env.REDIS_PRIVATE_URL,
      process.env.REDIS_PRIVATE_URI,
      process.env.REDIS_PUBLIC_URL,
      process.env.REDIS_PUBLIC_URI,
      process.env.REDIS_HOST,
      process.env.REDISHOST,
      process.env.REDIS_PORT,
      process.env.REDISPORT
    )
  );
}

let _connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!_connection) {
    _connection = createRedisConnection();
    _connection.on("error", (err) => {
      console.error("Redis connection error:", err);
    });
  }
  return _connection;
}

/**
 * Creates a NEW, dedicated ioredis connection using the same configuration
 * resolution as {@link getRedisConnection}. Unlike the shared pool connection,
 * each call returns its own client.
 *
 * Use this for callers that must not share the BullMQ connection — most notably
 * Pub/Sub: a subscriber connection enters "subscriber mode" and can no longer
 * issue regular commands, so it needs to be isolated.
 */
export function createRedisClient(): Redis {
  return createRedisConnection();
}
