import "server-only";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import {
  AuthenticationError,
  requireActionUser,
  type CurrentUser,
} from "@/server/auth/session";
import { DomainError } from "@/server/errors";

/**
 * Wraps a server action: requires a signed-in user, validates input, and converts known errors
 * into a typed result. Unexpected errors are logged without input data and reported generically.
 */
export async function runAction<T>(
  fn: (user: CurrentUser) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await requireActionUser();
    const data = await fn(user);
    return { ok: true, data };
  } catch (error) {
    return toFailure(error);
  }
}

export function toFailure(
  error: unknown,
): Extract<ActionResult<never>, { ok: false }> {
  if (error instanceof AuthenticationError) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      error: "Your session has ended. Sign in again to continue.",
    };
  }
  if (error instanceof DomainError) {
    return {
      ok: false,
      code: error.code,
      error: error.message,
      fieldErrors: error.fieldErrors,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      code: "VALIDATION",
      error: "Some fields need attention.",
      fieldErrors: fieldErrorsFrom(error),
    };
  }
  // Re-throw framework control flow (redirect, notFound).
  if (isNextControlFlow(error)) throw error;
  console.error(
    "[action] unexpected error:",
    error instanceof Error ? error.message : "unknown",
  );
  return {
    ok: false,
    code: "INTERNAL",
    error: "Something went wrong on our side. Please try again.",
  };
}

export function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

function isNextControlFlow(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  const digest = String((error as { digest: unknown }).digest);
  return (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  );
}
