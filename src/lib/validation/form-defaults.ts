import type { BookingCategory } from "@/generated/prisma/enums";
import type { TripDetails } from "@/lib/domain/trip-details";

import type { BookingFormInput } from "./booking";
import type { EventFormInput } from "./itinerary";
import type { TripDetailsFormInput } from "./trip";

/** Default and initial values for forms. Plain functions so server and client code can share them. */

export function toTripDetailsFormInput(
  details: TripDetails,
  fallbackTitle: string,
): TripDetailsFormInput {
  const text = (value: string | null) => value ?? "";
  return {
    title: details.title ?? fallbackTitle,
    summary: text(details.summary),
    destination: text(details.destination),
    destinationConfirmed: details.destinationConfirmed,
    departureLocation: text(details.departureLocation),
    flyIntoAirport: text(details.flyIntoAirport),
    flyOutOfAirport: text(details.flyOutOfAirport),
    tripStyle: text(details.tripStyle),
    theme: details.theme ?? "",
    startDate: text(details.startDate),
    endDate: text(details.endDate),
    dateFlexibility: details.dateFlexibility,
    dateNotes: text(details.dateNotes),
    durationDays: details.durationDays?.toString() ?? "",
    groupSize: details.groupSize?.toString() ?? "",
    groupNotes: text(details.groupNotes),
    budgetAmount: text(details.budgetAmount),
    budgetCurrency: text(details.budgetCurrency),
    budgetBasis: details.budgetBasis,
    budgetIncludes: details.budgetIncludes,
    budgetNotes: text(details.budgetNotes),
    flightsStatus: details.flightsStatus,
    lodgingStatus: details.lodgingStatus,
    localTransportStatus: details.localTransportStatus,
    activitiesStatus: details.activitiesStatus,
  };
}

export function emptyBooking(
  category: BookingCategory,
  currency: string,
): BookingFormInput {
  return {
    category,
    title: "",
    provider: "",
    url: "",
    reference: "",
    status: "PLANNED",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    fromLocation: "",
    toLocation: "",
    locationName: "",
    address: "",
    costAmount: "",
    currency,
    costIsEstimate: true,
    costSplit: category === "FLIGHT" ? "PER_PERSON" : "SHARED_EQUALLY",
    notes: "",
    researchOptionId: "",
    participants: [],
  };
}

export function emptyEvent(date: string): EventFormInput {
  return {
    title: "",
    kind: "ACTIVITY",
    status: "PLANNED",
    date,
    startTime: "",
    endTime: "",
    locationName: "",
    address: "",
    latitude: "",
    longitude: "",
    url: "",
    notes: "",
    researchOptionId: "",
    bookingId: "",
  };
}
