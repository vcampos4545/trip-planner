import "server-only";

import { rateLimited } from "@/server/errors";

/**
 * Small in-memory sliding-window limiter for sensitive endpoints (Atlas messages, invitation
 * joins, invite creation, invitation emails). It is per process, which suits a single-instance deployment. A
 * multi-instance deployment should swap in a shared store such as Redis.
 */
const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
  /** How many requests this call counts as, such as one per email address in a batch. */
  cost = 1,
) {
  const recent = (buckets.get(key) ?? []).filter(
    (timestamp) => now - timestamp < windowMs,
  );
  if (recent.length + cost > limit) {
    buckets.set(key, recent);
    throw rateLimited();
  }
  for (let i = 0; i < cost; i += 1) recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
}

export function resetRateLimits() {
  buckets.clear();
}
