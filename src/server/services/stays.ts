import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { parseDateOnly, todayDateOnly } from "@/lib/dates";
import { parseListingLink } from "@/lib/domain/listing-link";
import { centsToDecimal, toCents } from "@/lib/money";
import {
  clockToMinutes,
  describeStay,
  guestsLabel,
  nightsBetween,
  nightsLabel,
  type StayOffer,
} from "@/lib/stays";
import type { StayLinkInput } from "@/lib/validation/stays";
import { requireMembersOfTrip, type TripAccess } from "@/server/access";
import { logActivity } from "@/server/activity";
import { db } from "@/server/db";
import { DomainError, invalid } from "@/server/errors";
import {
  StayProviderError,
  getStaySearchStatus,
  type StaySearchProvider,
  type StaySearchQuery,
  type StaySearchResult,
} from "@/server/stays";

function notConfigured() {
  const status = getStaySearchStatus();
  return new DomainError(
    "UNAVAILABLE",
    `Stay search is not configured. ${status.configured ? "" : status.reason}`.trim(),
  );
}

/** Turns a provider failure into a message that is safe to show. Nothing is ever written. */
function providerFailure(provider: StaySearchProvider, error: unknown) {
  if (error instanceof StayProviderError) {
    const userError = error.kind === "invalid_request";
    if (!userError) {
      console.error(`[stays] ${provider.id} search failed: ${error.kind}`);
    }
    return new DomainError(
      userError ? "VALIDATION" : "UNAVAILABLE",
      userError
        ? error.message
        : `${error.message} Nothing in the trip was changed.`,
    );
  }
  console.error(
    `[stays] ${provider.id} search failed:`,
    error instanceof Error ? error.message : "unknown",
  );
  return new DomainError(
    "UNAVAILABLE",
    "Stay search failed. Nothing in the trip was changed. Try again in a moment.",
  );
}

/**
 * Runs a stay search. The caller has already checked trip membership. Nothing is written: a
 * failed or successful search leaves trip data unchanged.
 */
export async function searchStays(
  provider: StaySearchProvider | null,
  query: StaySearchQuery,
  options: { signal?: AbortSignal; now?: Date } = {},
): Promise<StaySearchResult> {
  if (!provider) throw notConfigured();
  if (query.checkIn < todayDateOnly(options.now)) {
    throw invalid("Pick a check-in date from today onward.", {
      checkIn: ["Pick a date from today onward"],
    });
  }
  if (query.kind === "vacation_rental" && !provider.supportsVacationRentals) {
    throw invalid(
      `${provider.label} can only search hotels. Add a vacation rental from its link instead.`,
      { kind: ["Only hotels can be searched here"] },
    );
  }
  try {
    return await provider.search(query, options.signal);
  } catch (error) {
    throw providerFailure(provider, error);
  }
}

function retrievedLabel(offer: StayOffer) {
  return `${offer.retrievedAt.slice(0, 16).replace("T", " ")} UTC`;
}

/** What the saved price means, in words that never make it look more certain than it is. */
function priceNote(offer: StayOffer) {
  const basis = offer.totalAmount
    ? `Total for ${nightsLabel(offer.nights)}, ${guestsLabel(offer.guests)}`
    : `Nightly rate for ${guestsLabel(offer.guests)}; ${offer.sourceName} gave no total`;
  return `${basis}, including taxes and fees as Google Hotels showed them at retrieval. Prices can change before booking`;
}

export type SavedStay = {
  optionId: string;
  bookingId: string | null;
  alreadySaved: boolean;
};

/**
 * Saves a search result to the trip as a lodging option with its provenance and coordinates, and
 * optionally as an accommodation booking with the current traveler "considering" it. This never
 * marks anything booked: the app does not book stays.
 */
export async function saveStayOffer(
  access: TripAccess,
  offer: StayOffer,
  options: { asBooking: boolean },
): Promise<SavedStay> {
  const title = offer.name.slice(0, 160);
  const url = offer.propertyUrl ?? offer.bookingUrl;
  const sources = offer.priceSources.map((price) => price.source);

  return db.$transaction(async (tx) => {
    let option = await tx.researchOption.findFirst({
      where: {
        tripId: access.tripId,
        category: "LODGING",
        providerPayload: { path: ["offerId"], equals: offer.offerId },
      },
      select: { id: true, title: true },
    });
    const alreadySaved = Boolean(option);
    if (!option) {
      option = await tx.researchOption.create({
        data: {
          tripId: access.tripId,
          category: "LODGING",
          title,
          description: [describeStay(offer), offer.description]
            .filter(Boolean)
            .join("\n")
            .slice(0, 2000),
          url,
          sourceName: offer.sourceName,
          origin: "RESEARCH_PROVIDER",
          status: "SUGGESTED",
          priceAmount: offer.totalAmount ?? offer.nightlyAmount,
          priceCurrency: offer.currency,
          priceUnit: offer.totalAmount
            ? `total for ${nightsLabel(offer.nights)}`
            : "night",
          priceNote: priceNote(offer).slice(0, 500),
          locationName: offer.location.slice(0, 200),
          latitude: offer.latitude,
          longitude: offer.longitude,
          retrievedAt: new Date(offer.retrievedAt),
          providerPayload: {
            provider: offer.providerId,
            offerId: offer.offerId,
            propertyToken: offer.propertyToken,
            kind: offer.kind,
            checkIn: offer.checkIn,
            checkOut: offer.checkOut,
            nights: offer.nights,
            guests: offer.guests,
            nightlyAmount: offer.nightlyAmount,
            totalAmount: offer.totalAmount,
            currency: offer.currency,
            priceSources: offer.priceSources,
            rating: offer.rating,
            reviews: offer.reviews,
            hotelClass: offer.hotelClass,
            sponsored: offer.sponsored,
            imageUrl: offer.imageUrl,
            bookingUrl: offer.bookingUrl,
            checkInTime: offer.checkInTime,
            checkOutTime: offer.checkOutTime,
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
        summary: `saved the stay "${option.title}"`,
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
      `${offer.totalAmount ? `Price is the total for ${nightsLabel(offer.nights)}` : `No total was shown; the price is one night`} for ${guestsLabel(offer.guests)}, the lowest ${offer.sourceName} showed on ${retrievedLabel(offer)}${sources.length ? ` (from ${sources.join(", ")})` : ""}. Add the other travelers to split it, and their rooms once you know them.`,
      "Google Hotels has no room-count filter: check how many rooms or beds this covers before booking.",
      "Not booked. Book with the property or a listing site, then update this record.",
    ].join("\n");
    const booking = await tx.booking.create({
      data: {
        tripId: access.tripId,
        category: "ACCOMMODATION",
        title,
        provider: null,
        url,
        status: "PLANNED",
        startDate: parseDateOnly(offer.checkIn),
        startMinute: clockToMinutes(offer.checkInTime),
        endDate: parseDateOnly(offer.checkOut),
        endMinute: clockToMinutes(offer.checkOutTime),
        locationName: offer.location.slice(0, 200),
        costAmount: offer.totalAmount ?? offer.nightlyAmount,
        currency: offer.currency,
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
      summary: `is considering the stay "${booking.title}"`,
      entityType: "booking",
      entityId: booking.id,
    });
    return { optionId: option.id, bookingId: booking.id, alreadySaved };
  });
}

export type StayFromLink = { optionId: string; bookingId: string };

/**
 * Adds a place the traveler found on Airbnb, Vrbo, or any other site. The link is kept with the
 * site it points to, and the page is never opened: the name, dates, and price are what the
 * traveler typed. It is saved as considering unless they say they already booked it.
 */
export async function addStayFromLink(
  access: TripAccess,
  input: StayLinkInput,
  options: { now?: Date; userName?: string | null } = {},
): Promise<StayFromLink> {
  const link = parseListingLink(input.url);
  if (!link) throw invalid("Paste a full link starting with https://");
  const travelers =
    input.travelers.length > 0 ? input.travelers : [access.memberId];
  const nights =
    input.checkIn && input.checkOut
      ? nightsBetween(input.checkIn, input.checkOut)
      : null;
  const cents = input.priceAmount ? toCents(input.priceAmount) : null;
  const total =
    cents === null
      ? null
      : input.priceBasis === "night" && nights
        ? centsToDecimal(cents * nights)
        : centsToDecimal(cents);
  const addedOn = (options.now ?? new Date()).toISOString().slice(0, 10);
  const who = options.userName?.split(/\s+/)[0] ?? "A member";
  const provenance = `Added from a ${link.site.name} link by ${who} on ${addedOn}. The name, dates, and price were entered by hand; the app did not open or check the listing.`;
  const priceLine =
    total && input.priceBasis === "night" && nights
      ? `Price entered as ${input.priceAmount} ${input.currency} a night; the cost is that times ${nightsLabel(nights)}, before any fees the site adds.`
      : null;
  const status = input.booked ? "BOOKED" : "CONSIDERING";

  return db.$transaction(async (tx) => {
    await requireMembersOfTrip(access.tripId, travelers, tx);
    const option = await tx.researchOption.create({
      data: {
        tripId: access.tripId,
        category: "LODGING",
        title: input.title,
        description: input.notes,
        url: link.url,
        sourceName: link.site.name,
        origin: "USER",
        status: input.booked ? "BOOKED" : "SUGGESTED",
        priceAmount: input.priceAmount,
        priceCurrency: input.priceAmount ? input.currency : null,
        priceUnit: input.priceAmount
          ? input.priceBasis === "night"
            ? "night"
            : "total"
          : null,
        priceNote: input.priceAmount
          ? "Entered by hand from the listing"
          : null,
        retrievedAt: null,
        providerPayload: {
          provider: "link",
          site: link.site.name,
          host: link.site.host,
          knownSite: link.site.known,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
        } as unknown as Prisma.InputJsonValue,
        createdById: access.userId,
        updatedById: access.userId,
      },
      select: { id: true },
    });
    const booking = await tx.booking.create({
      data: {
        tripId: access.tripId,
        category: "ACCOMMODATION",
        title: input.title,
        provider: link.site.name,
        url: link.url,
        status: input.booked ? "BOOKED" : "PLANNED",
        startDate: input.checkIn ? parseDateOnly(input.checkIn) : null,
        endDate: input.checkOut ? parseDateOnly(input.checkOut) : null,
        costAmount: total,
        currency: total ? input.currency : null,
        costIsEstimate: !input.booked || input.priceBasis === "night",
        costSplit: "SHARED_EQUALLY",
        notes: [provenance, priceLine, input.notes].filter(Boolean).join("\n"),
        researchOptionId: option.id,
        createdById: access.userId,
        updatedById: access.userId,
        participants: {
          create: travelers.map((memberId) => ({ memberId, status })),
        },
      },
      select: { id: true, title: true },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "BOOKING_ADDED",
      summary: input.booked
        ? `recorded the stay "${booking.title}" from ${link.site.name} as booked`
        : `added the stay "${booking.title}" from ${link.site.name}`,
      entityType: "booking",
      entityId: booking.id,
    });
    return { optionId: option.id, bookingId: booking.id };
  });
}
