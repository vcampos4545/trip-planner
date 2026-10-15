import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";

import { SESSION_COOKIE_NAMES } from "./cookies";

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

export class AuthenticationError extends Error {
  constructor() {
    super("You need to sign in to do that.");
    this.name = "AuthenticationError";
  }
}

/** The signed-in user for this request, or null. Memoized per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
  };
});

async function hadSessionCookie() {
  const jar = await cookies();
  return SESSION_COOKIE_NAMES.some((name) => jar.has(name));
}

/**
 * For pages and layouts: returns the user or redirects to sign-in. A stale cookie with no
 * matching session means the session expired, so the sign-in page can say so.
 */
export async function requireUser(callbackPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;
  const params = new URLSearchParams();
  if (callbackPath) params.set("callbackUrl", callbackPath);
  if (await hadSessionCookie()) params.set("reason", "expired");
  const query = params.toString();
  redirect(query ? `/signin?${query}` : "/signin");
}

/** For server actions and route handlers: returns the user or throws AuthenticationError. */
export async function requireActionUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  return user;
}
