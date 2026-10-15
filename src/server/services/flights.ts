import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  isDateOnly,
  isTimeOfDay,
  parseDateOnly,
  timeToMinutes,
  todayDateOnly,
} from "@/lib/dates";
import {
  TEST_DATA_NOTICE,
  bookElsewhereUrl,
  describeSlice,
  flightTitle,
  localClock,
  localDate,
  travelersLabel,
  type FlightAirport,
  type FlightOffer,
} from "@/lib/flights";
import type { TripAccess } from "@/server/access";
import { logActivity } from "@/server/activity";
import { db } from "@/server/db";
import { DomainError, invalid } from "@/server/errors";
import {
  FlightProviderError,
  getFlightSearchStatus,
  type FlightSearchProvider,
  type FlightSearchQuery,
  type FlightSearchResult,
} from "@/server/flights";

/**
 * Runs a flight search. The caller has already checked trip membership. Nothing is written:
 * a failed or successful search leaves trip data unchanged.
 */
export async function searchFlights(
  provider: FlightSearchProvider | null,
  query: FlightSearchQuery,
  options: { signal?: AbortSignal; now?: Date } = {},
): Promise<FlightSearchResult> {
  if (!provider) {
    const status = getFlightSearchStatus();
    throw new DomainError(
      "UNAVAILABLE",
      `Flight search is not configured. ${status.configured ? "" : status.reason}`.trim(),
    );
  }
  if (query.departureDate < todayDateOnly(options.now)) {
    throw invalid("Pick a departure date from today onward.", {
      departureDate: ["Pick a date from today onward"],
    });
  }
  try {
    return await provider.search(query, options.signal);
  } catch (error) {
    if (error instanceof FlightProviderError) {
      if (error.kind !== "invalid_request" && error.kind !== "unknown_place") {
        console.error(`[flights] ${provider.id} search failed: ${error.kind}`);
      }
      throw new DomainError(
        error.kind === "invalid_request" || error.kind === "unknown_place"
          ? "VALIDATION"
          : "UNAVAILABLE",
        error.message,
      );
    }
    console.error(
      `[flights] ${provider.id} search failed:`,
      error instanceof Error ? error.message : "unknown",
    );
    throw new DomainError(
      "UNAVAILABLE",
      "Flight search failed. Nothing in the trip was changed. Try again in a moment.",
    );
  }
}

function placeLabel(airport: FlightAirport) {
  return airport.cityName
    ? `${airport.cityName} (${airport.iataCode})`
    : airport.iataCode;
}

function minutesOf(value: string) {
  const clock = localClock(value);
  return isTimeOfDay(clock) ? timeToMinutes(clock) : null;
}

function dateOf(value: string) {
  const date = localDate(value);
  return isDateOnly(date) ? parseDateOnly(date) : null;
}

function linkFor(offer: FlightOffer) {
  const [outbound, inbound] = offer.slices;
  return bookElsewhereUrl({
    origin: outbound!.origin.iataCode,
    destination: outbound!.destination.iataCode,
    departureDate: localDate(outbound!.departingAt),
    returnDate: inbound ? localDate(inbound.departingAt) : null,
  });
}

export type SavedFlight = {
  optionId: string;
  bookingId: string | null;
  alreadySaved: boolean;
};

/**
 * Saves a search result to the trip as a flight option with its provenance, and optionally as a
 * flight booking record with the current traveler "considering" it. This never marks anything
 * booked: the app does not book flights.
 */
export async function saveFlightOffer(
  access: TripAccess,
  offer: FlightOffer,
  options: { asBooking: boolean },
): Promise<SavedFlight> {
  const outbound = offer.slices[0];
  if (!outbound) throw invalid("That flight has no itinerary to save.");
  const last = offer.slices[offer.slices.length - 1]!;
  const title = flightTitle(offer).slice(0, 160);
  const url = linkFor(offer);
  const testLabel = offer.testMode ? ` (${TEST_DATA_NOTICE})` : "";

  return db.$transaction(async (tx) => {
    let option = await tx.researchOption.findFirst({
      where: {
        tripId: access.tripId,
        category: "FLIGHT",
        providerPayload: { path: ["offerId"], equals: offer.offerId },
      },
      select: { id: true, title: true },
    });
    const alreadySaved = Boolean(option);
    if (!option) {
      option = await tx.researchOption.create({
        data: {
          tripId: access.tripId,
          category: "FLIGHT",
          title,
          description: offer.slices
            .map(describeSlice)
            .join("\n")
            .slice(0, 2000),
          url,
          sourceName: offer.sourceName,
          origin: "RESEARCH_PROVIDER",
          status: "SUGGESTED",
          priceAmount: offer.totalAmount,
          priceCurrency: offer.totalCurrency,
          priceUnit: null,
          priceNote: `Total for ${travelersLabel(offer.passengers)}. ${
            offer.testMode
              ? TEST_DATA_NOTICE
              : "Fare as quoted at retrieval; it can change before booking"
          }`,
          locationName:
            outbound.destination.cityName ?? outbound.destination.iataCode,
          retrievedAt: new Date(offer.retrievedAt),
          providerPayload: {
            provider: "duffel",
            offerId: offer.offerId,
            testMode: offer.testMode,
            expiresAt: offer.expiresAt,
            cabin: offer.cabin,
            passengers: offer.passengers,
            airline: offer.airline,
            slices: offer.slices,
          } as unknown as Prisma.InputJsonValue,
          createdById: access.userId,
          updatedById: access.userId,
        },
        select: { id: true, title: true },
      });
      await logActivity(tx, {
        tripId: access.tripId,
        actorId: access.userId,
        type: "OPTION_ADDED",
        summary: `saved the flight "${option.title}"${testLabel}`,
        entityType: "option",
        entityId: option.id,
      });
    }

    if (!options.asBooking) {
      return { optionId: option.id, bookingId: null, alreadySaved };
    }

    const existing = await tx.booking.findFirst({
      where: { tripId: access.tripId, researchOptionId: option.id },
      select: { id: true },
    });
    if (existing) {
      // Add the caller as considering if they aren't on the record yet. Never change a status.
      await tx.bookingParticipant.createMany({
        data: [
          {
            bookingId: existing.id,
            memberId: access.memberId,
            status: "CONSIDERING",
          },
        ],
        skipDuplicates: true,
      });
      return { optionId: option.id, bookingId: existing.id, alreadySaved };
    }

    const notes = [
      offer.testMode ? `${TEST_DATA_NOTICE}.` : null,
      `Price is the total for ${travelersLabel(offer.passengers)} as quoted by ${offer.sourceName} on ${offer.retrievedAt.slice(0, 16).replace("T", " ")} UTC. Add the other travelers to split it.`,
      "Not booked. Book with the airline or a travel site, then update this record.",
    ]
      .filter(Boolean)
      .join("\n");
    const booking = await tx.booking.create({
      data: {
        tripId: access.tripId,
        category: "FLIGHT",
        title: title.slice(0, 200),
        provider: offer.airline.name.slice(0, 120),
        url,
        status: "PLANNED",
        startDate: dateOf(outbound.departingAt),
        startMinute: minutesOf(outbound.departingAt),
        endDate: dateOf(last.arrivingAt),
        endMinute: minutesOf(last.arrivingAt),
        fromLocation: placeLabel(outbound.origin).slice(0, 160),
        toLocation: placeLabel(outbound.destination).slice(0, 160),
        costAmount: offer.totalAmount,
        currency: offer.totalCurrency,
        costIsEstimate: true,
        costSplit: "SHARED_EQUALLY",
        notes,
        researchOptionId: option.id,
        createdById: access.userId,
        updatedById: access.userId,
        participants: {
          create: [{ memberId: access.memberId, status: "CONSIDERING" }],
        },
      },
      select: { id: true, title: true },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "BOOKING_ADDED",
      summary: `is considering the flight "${booking.title}"${testLabel}`,
      entityType: "booking",
      entityId: booking.id,
    });
    return { optionId: option.id, bookingId: booking.id, alreadySaved };
  });
}
