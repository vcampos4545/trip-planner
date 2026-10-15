import "server-only";

import { rateLimited } from "@/server/errors";

/**
 * Small in-memory sliding-window limiter for sensitive endpoints (Atlas messages, invitation
 * joins, invite creation). It is per process, which suits a single-instance deployment. A
 * multi-instance deployment should swap in a shared store such as Redis.
 */
const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  const recent = (buckets.get(key) ?? []).filter(
    (timestamp) => now - timestamp < windowMs,
  );
  if (recent.length >= limit) {
    buckets.set(key, recent);
    throw rateLimited();
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
}

export function resetRateLimits() {
  buckets.clear();
}
