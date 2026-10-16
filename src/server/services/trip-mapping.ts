import "server-only";

import type { Prisma, Trip } from "@/generated/prisma/client";
import { parseDateOnly, toDateOnly } from "@/lib/dates";
import { describeStops, type TripStopInput } from "@/lib/domain/stops";
import type { FieldChange, TripDetails } from "@/lib/domain/trip-details";

export function tripToDetails(trip: Trip): TripDetails {
  return {
    title: trip.title,
    summary: trip.summary,
    destination: trip.destination,
    destinationConfirmed: trip.destinationConfirmed,
    departureLocation: trip.departureLocation,
    flyIntoAirport: trip.flyIntoAirport,
    flyOutOfAirport: trip.flyOutOfAirport,
    tripStyle: trip.tripStyle,
    theme: trip.theme,
    startDate: trip.startDate ? toDateOnly(trip.startDate) : null,
    endDate: trip.endDate ? toDateOnly(trip.endDate) : null,
    dateFlexibility: trip.dateFlexibility,
    dateNotes: trip.dateNotes,
    durationDays: trip.durationDays,
    groupSize: trip.groupSize,
    groupNotes: trip.groupNotes,
    budgetAmount: trip.budgetAmount ? trip.budgetAmount.toFixed(2) : null,
    budgetCurrency: trip.budgetCurrency,
    budgetBasis: trip.budgetBasis,
    budgetIncludes: trip.budgetIncludes,
    budgetNotes: trip.budgetNotes,
    flightsStatus: trip.flightsStatus,
    lodgingStatus: trip.lodgingStatus,
    localTransportStatus: trip.localTransportStatus,
    activitiesStatus: trip.activitiesStatus,
  };
}

/** Converts (part of) a TripDetails object into Prisma update data. */
export function detailsToTripData(
  details: Partial<TripDetails>,
): Prisma.TripUncheckedUpdateInput {
  const data: Prisma.TripUncheckedUpdateInput = {};
  for (const [key, value] of Object.entries(details) as [
    keyof TripDetails,
    unknown,
  ][]) {
    switch (key) {
      case "startDate":
      case "endDate":
        data[key] = value ? parseDateOnly(value as string) : null;
        break;
      case "title":
        if (typeof value === "string" && value.trim()) data.title = value;
        break;
      default:
        (data as Record<string, unknown>)[key] = value;
    }
  }
  return data;
}

export const FIELD_LABELS: Record<keyof TripDetails, string> = {
  title: "trip name",
  summary: "summary",
  destination: "destination",
  destinationConfirmed: "destination status",
  departureLocation: "departure city",
  flyIntoAirport: "arrival airport",
  flyOutOfAirport: "airport home",
  tripStyle: "trip style",
  theme: "trip theme",
  startDate: "start date",
  endDate: "end date",
  dateFlexibility: "date flexibility",
  dateNotes: "timing notes",
  durationDays: "trip length",
  groupSize: "group size",
  groupNotes: "group notes",
  budgetAmount: "budget",
  budgetCurrency: "budget currency",
  budgetBasis: "budget basis",
  budgetIncludes: "what the budget covers",
  budgetNotes: "budget notes",
  flightsStatus: "flights status",
  lodgingStatus: "lodging status",
  localTransportStatus: "local transport status",
  activitiesStatus: "activities status",
};

export function describeFields(fields: (keyof TripDetails)[]) {
  const labels = [...new Set(fields.map((field) => FIELD_LABELS[field]))];
  if (labels.length <= 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/** A proposed replacement of the trip's stops, kept next to detail changes in a proposal. */
export type StopsChange = {
  field: "stops";
  from: TripStopInput[];
  to: TripStopInput[];
};

export type ProposalChange = FieldChange | StopsChange;

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "not set";
  if (Array.isArray(value))
    return value.length ? value.join(", ").toLowerCase() : "not set";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" && value.length > 3 && /^[A-Z_]+$/.test(value))
    return value.replaceAll("_", " ").toLowerCase();
  return String(value);
}

export function describeChange(change: ProposalChange) {
  if (change.field === "stops")
    return `Stops: ${describeStops(change.from)} → ${describeStops(change.to)}`;
  return `${FIELD_LABELS[change.field]}: ${formatValue(change.from)} → ${formatValue(change.to)}`;
}
