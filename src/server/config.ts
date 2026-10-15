import "server-only";

/** Server configuration read at request time. Nothing here is exposed to the browser. */

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export function inviteDefaultTtlDays() {
  return intFromEnv("INVITE_TTL_DAYS", 7, 1, 30);
}
