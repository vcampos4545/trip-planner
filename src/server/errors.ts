import type { FieldChoice } from "@/lib/action-result";

/**
 * Domain errors thrown by services. Server actions turn them into user-facing results.
 * Messages are safe to show to the user.
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INTERNAL";

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly fieldChoices?: Record<string, FieldChoice[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (
  message = "We couldn't find that, or you don't have access to it.",
) => new DomainError("NOT_FOUND", message);

export const forbidden = (message = "You don't have permission to do that.") =>
  new DomainError("FORBIDDEN", message);

export const conflict = (
  message = "Someone else changed this while you were editing. Reload to see the latest version, then try again.",
) => new DomainError("CONFLICT", message);

export const invalid = (
  message: string,
  fieldErrors?: Record<string, string[]>,
) => new DomainError("VALIDATION", message, fieldErrors);

export const rateLimited = (
  message = "Too many requests. Please wait a moment and try again.",
) => new DomainError("RATE_LIMITED", message);
