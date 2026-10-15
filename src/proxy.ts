import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAMES } from "@/server/auth/cookies";

/**
 * Optimistic redirect for signed-out visitors. This only checks that a session cookie exists.
 * Real authentication and trip authorization happen on the server for every page and action.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) =>
    request.cookies.has(name),
  );
  if (hasSessionCookie) return NextResponse.next();

  const url = request.nextUrl.clone();
  const callbackUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/signin";
  url.search = "";
  url.searchParams.set("callbackUrl", callbackUrl);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/trips/:path*", "/invite/:path*"],
};
