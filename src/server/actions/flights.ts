"use server";

import type { ActionResult } from "@/lib/action-result";
import type {
  FlightOffer,
  FlightSearchSummary,
  PriceInsights,
} from "@/lib/flights";
import {
  flightSearchFormSchema,
  returnFlightsSchema,
  saveFlightSchema,
} from "@/lib/validation/flights";
import { requireTripAccess } from "@/server/access";
import { getFlightProvider } from "@/server/flights";
import { openOffer, sealOffer } from "@/server/flights/seal";
import { checkRateLimit } from "@/server/rate-limit";
import type { FlightSearchResult } from "@/server/flights";
import {
  saveFlightOffer,
  searchFlights,
  searchReturnFlights,
} from "@/server/services/flights";

import { revalidateTrip } from "./revalidate";
import { runAction } from "./run-action";

export type FlightSearchResponse = {
  search: FlightSearchSummary;
  retrievedAt: string;
  sourceName: string;
  testMode: boolean;
  priceInsights: PriceInsights | null;
  /** True when the app reused an identical recent search instead of asking the provider again. */
  cached: boolean;
  results: { offer: FlightOffer; token: string }[];
};

function toResponse(
  result: FlightSearchResult,
  scope: { tripId: string; userId: string },
): FlightSearchResponse {
  return {
    search: result.search,
    retrievedAt: result.retrievedAt,
    sourceName: result.sourceName,
    testMode: result.testMode,
    priceInsights: result.priceInsights ?? null,
    cached: result.cached ?? false,
    results: result.offers.map((offer) => ({
      offer,
      token: sealOffer(offer, scope),
    })),
  };
}

export async function searchFlightsAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<FlightSearchResponse>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const input = flightSearchFormSchema.parse(raw);
    checkRateLimit(`flights:${user.id}`, 10, 60_000);
    const result = await searchFlights(getFlightProvider(), input);
    return toResponse(result, access);
  });
}

/** Loads return options for one round-trip result. Runs only when the traveler asks. */
export async function searchReturnFlightsAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<FlightSearchResponse>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const input = returnFlightsSchema.parse(raw);
    const offer = openOffer(input.token, access);
    checkRateLimit(`flights:${user.id}`, 10, 60_000);
    const result = await searchReturnFlights(getFlightProvider(), offer);
    return toResponse(result, access);
  });
}

export async function saveFlightAction(
  tripId: string,
  raw: unknown,
): Promise<
  ActionResult<{
    optionId: string;
    bookingId: string | null;
    alreadySaved: boolean;
  }>
> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const input = saveFlightSchema.parse(raw);
    const offer = openOffer(input.token, access);
    const saved = await saveFlightOffer(access, offer, {
      asBooking: input.asBooking,
    });
    revalidateTrip(tripId);
    return saved;
  });
}
