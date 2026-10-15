/**
 * Returns a same-origin relative path, or the fallback. Prevents open redirects through
 * `callbackUrl` style parameters.
 */
export function safeRedirectPath(value: unknown, fallback = "/trips"): string {
  if (typeof value !== "string") return fallback;
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  )
    return fallback;
  if (value.startsWith("/api/auth")) return fallback;
  return value;
}
