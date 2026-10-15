import "server-only";

import { notFound } from "next/navigation";

import { DomainError } from "@/server/errors";

/** Converts "not found" domain errors into the Next.js not-found page. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
