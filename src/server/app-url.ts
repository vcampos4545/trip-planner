import "server-only";

import { headers } from "next/headers";

/**
 * The public origin used in links the app hands out, such as invite links. AUTH_URL wins when set;
 * otherwise the request's host is used, which suits local development.
 */
export async function appOrigin() {
  const configured = process.env.AUTH_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const list = await headers();
  const host =
    list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto =
    list.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function inviteUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}/invite/${token}`;
}
