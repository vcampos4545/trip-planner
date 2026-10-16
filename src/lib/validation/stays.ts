import { z } from "zod";

import { toDateOnly } from "@/lib/dates";
import {
  MAX_STAY_BEDROOMS,
  MAX_STAY_GUESTS,
  MAX_STAY_NIGHTS,
  STAY_KINDS,
  STAY_SORTS,
  nightsBetween,
} from "@/lib/stays";

import {
  entityId,
  isHttpUrl,
  optionalCurrency,
  optionalDate,
  optionalInt,
  optionalMoney,
  optionalText,
  requiredDate,
  requiredText,
} from "./fields";

const MAX_NIGHTLY_PRICE = 100_000;

/** Raw form values from the stay search panel. Atlas builds the same input from its tool call. */
export const staySearchFormSchema = z
  .object({
    location: requiredText(120, "Where"),
    checkIn: requiredDate,
    checkOut: requiredDate,
    guests: z
      .string()
      .trim()
      .refine(
        (value) =>
          /^\d+$/.test(value) &&
          Number(value) >= 1 &&
          Number(value) <= MAX_STAY_GUESTS,
        `Enter 1 to ${MAX_STAY_GUESTS} guests`,
      )
      .transform(Number),
    kind: z.enum(STAY_KINDS),
    bedrooms: optionalInt(0, MAX_STAY_BEDROOMS),
    minPrice: optionalInt(0, MAX_NIGHTLY_PRICE),
    maxPrice: optionalInt(1, MAX_NIGHTLY_PRICE),
    sort: z.enum(STAY_SORTS),
  })
  .transform((value) => ({
    ...value,
    // Only vacation rentals can be filtered on bedrooms, and 0 means any.
    bedrooms:
      value.kind === "vacation_rental" && value.bedrooms
        ? value.bedrooms
        : null,
  }))
  .superRefine((value, ctx) => {
    if (value.checkOut <= value.checkIn) {
      ctx.addIssue({
        code: "custom",
        path: ["checkOut"],
        message: "Check-out must be after check-in",
      });
    } else if (nightsBetween(value.checkIn, value.checkOut) > MAX_STAY_NIGHTS) {
      ctx.addIssue({
        code: "custom",
        path: ["checkOut"],
        message: `Search up to ${MAX_STAY_NIGHTS} nights at a time`,
      });
    }
    if (
      value.minPrice !== null &&
      value.maxPrice !== null &&
      value.minPrice > value.maxPrice
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["maxPrice"],
        message: "Max must be at least the min",
      });
    }
  });

export type StaySearchFormInput = z.input<typeof staySearchFormSchema>;
export type StaySearchInput = z.output<typeof staySearchFormSchema>;

type StopDates = {
  name: string;
  startDate: string | null;
  endDate: string | null;
};

/** A place to search from the trip: each stop with its dates, or the destination. */
export type StaySearchPlace = {
  label: string;
  location: string;
  checkIn: string;
  checkOut: string;
};

function upcoming(start: string, end: string, today: string) {
  const checkIn = start && start >= today ? start : "";
  return {
    checkIn,
    checkOut: checkIn && end > checkIn ? end : "",
  };
}

/** The trip's stops with their dates, so the search can be filled in from one of them. */
export function staySearchPlaces(
  trip: {
    destination: string | null;
    startDate: Date | string | null;
    endDate: Date | string | null;
  },
  stops: StopDates[],
  today: string,
): StaySearchPlace[] {
  const tripStart = trip.startDate ? toDateOnly(trip.startDate) : "";
  const tripEnd = trip.endDate ? toDateOnly(trip.endDate) : "";
  const places = stops.map((stop) => ({
    label: stop.name,
    location: stop.name.slice(0, 120),
    ...upcoming(stop.startDate ?? "", stop.endDate ?? "", today),
  }));
  if (places.length === 0 && trip.destination) {
    places.push({
      label: trip.destination,
      location: trip.destination.slice(0, 120),
      ...upcoming(tripStart, tripEnd, today),
    });
  }
  // A single place without its own dates uses the trip's dates.
  if (places.length === 1 && !places[0]!.checkIn) {
    places[0] = { ...places[0]!, ...upcoming(tripStart, tripEnd, today) };
  }
  return places;
}

/** Prefills the search from the first upcoming stop, the trip's dates, and the group size. */
export function staySearchDefaults(
  places: StaySearchPlace[],
  groupSize: number | null,
): StaySearchFormInput {
  const place = places.find((candidate) => candidate.checkIn) ?? places[0];
  return {
    location: place?.location ?? "",
    checkIn: place?.checkIn ?? "",
    checkOut: place?.checkOut ?? "",
    guests: String(Math.min(Math.max(groupSize ?? 2, 1), MAX_STAY_GUESTS)),
    kind: "hotel",
    bedrooms: "",
    minPrice: "",
    maxPrice: "",
    sort: "relevance",
  };
}

export const saveStaySchema = z.object({
  token: z.string().min(1).max(20_000),
  asBooking: z.boolean(),
});

export const STAY_PRICE_BASES = ["total", "night"] as const;

/** A place the traveler found on Airbnb, Vrbo, or any other site, entered by hand. */
export const stayLinkFormSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, "Paste the listing link")
      .max(2000, "That link is too long")
      .refine(isHttpUrl, "Paste a full link starting with https://"),
    title: requiredText(200, "Name"),
    checkIn: optionalDate,
    checkOut: optionalDate,
    priceAmount: optionalMoney,
    priceBasis: z.enum(STAY_PRICE_BASES),
    currency: optionalCurrency,
    travelers: z.array(entityId).max(100),
    booked: z.boolean(),
    notes: optionalText(1000),
  })
  .superRefine((value, ctx) => {
    if (value.checkIn && value.checkOut && value.checkOut <= value.checkIn) {
      ctx.addIssue({
        code: "custom",
        path: ["checkOut"],
        message: "Check-out must be after check-in",
      });
    }
    if (value.priceAmount && !value.currency) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Add a currency for the price",
      });
    }
    if (
      value.priceAmount &&
      value.priceBasis === "night" &&
      (!value.checkIn || !value.checkOut)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["checkOut"],
        message: "Add both dates to price it by the night",
      });
    }
    if (new Set(value.travelers).size !== value.travelers.length) {
      ctx.addIssue({
        code: "custom",
        path: ["travelers"],
        message: "Each traveler can only be added once",
      });
    }
  });

export type StayLinkFormInput = z.input<typeof stayLinkFormSchema>;
export type StayLinkInput = z.output<typeof stayLinkFormSchema>;
