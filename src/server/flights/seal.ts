import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { FlightOffer } from "@/lib/flights";
import { invalid } from "@/server/errors";

/**
 * Search results go to the browser for display, and the browser sends one back to save it. The
 * result is sealed with an HMAC bound to its purpose, the trip, and the user, so the saved price,
 * source, and retrieval time are exactly what the provider returned and cannot be edited on the
 * way back. Flight offers and stay results use different purposes, so one can't pass as the other.
 */

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type SealScope = { tripId: string; userId: string };
type Envelope<T> = {
  offer: T;
  tripId: string;
  userId: string;
  iat: number;
};

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function sign(purpose: string, payload: string) {
  return createHmac("sha256", secret())
    .update(`${purpose}:${payload}`)
    .digest("base64url");
}

export function sealResult<T>(
  purpose: string,
  offer: T,
  scope: SealScope,
  now = Date.now(),
): string {
  const envelope: Envelope<T> = {
    offer,
    tripId: scope.tripId,
    userId: scope.userId,
    iat: now,
  };
  const payload = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  return `${payload}.${sign(purpose, payload)}`;
}

export function openResult<T>(
  purpose: string,
  token: string,
  scope: SealScope,
  now = Date.now(),
): T {
  const failure = invalid(
    "That search result can't be saved. Run the search again and save from the new results.",
  );
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) throw failure;
  const expected = Buffer.from(sign(purpose, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    throw failure;
  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw failure;
  }
  if (
    envelope.tripId !== scope.tripId ||
    envelope.userId !== scope.userId ||
    typeof envelope.iat !== "number" ||
    now - envelope.iat > MAX_AGE_MS
  ) {
    throw failure;
  }
  return envelope.offer;
}

const FLIGHT_PURPOSE = "flight-offer";

export function sealOffer(
  offer: FlightOffer,
  scope: SealScope,
  now = Date.now(),
): string {
  return sealResult(FLIGHT_PURPOSE, offer, scope, now);
}

export function openOffer(
  token: string,
  scope: SealScope,
  now = Date.now(),
): FlightOffer {
  return openResult<FlightOffer>(FLIGHT_PURPOSE, token, scope, now);
}
