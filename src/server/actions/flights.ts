"use server";

import type { ActionResult } from "@/lib/action-result";
import type { FlightOffer, FlightSearchSummary } from "@/lib/flights";
import {
  flightSearchFormSchema,
  saveFlightSchema,
} from "@/lib/validation/flights";
import { requireTripAccess } from "@/server/access";
import { getFlightProvider } from "@/server/flights";
import { openOffer, sealOffer } from "@/server/flights/seal";
import { checkRateLimit } from "@/server/rate-limit";
import { saveFlightOffer, searchFlights } from "@/server/services/flights";

import { revalidateTrip } from "./revalidate";
import { runAction } from "./run-action";

export type FlightSearchResponse = {
  search: FlightSearchSummary;
  retrievedAt: string;
  sourceName: string;
  testMode: boolean;
  results: { offer: FlightOffer; token: string }[];
};

export async function searchFlightsAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<FlightSearchResponse>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const input = flightSearchFormSchema.parse(raw);
    checkRateLimit(`flights:${user.id}`, 10, 60_000);
    const result = await searchFlights(getFlightProvider(), input);
    return {
      search: result.search,
      retrievedAt: result.retrievedAt,
      sourceName: result.sourceName,
      testMode: result.testMode,
      results: result.offers.map((offer) => ({
        offer,
        token: sealOffer(offer, access),
      })),
    };
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
