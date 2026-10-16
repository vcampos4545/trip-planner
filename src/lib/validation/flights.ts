import { z } from "zod";

import { toDateOnly } from "@/lib/dates";
import { CABIN_CLASSES, MAX_FLIGHT_PASSENGERS } from "@/lib/flights";

import { optionalDate, requiredDate, requiredText } from "./fields";

/** Raw form values from the flight search panel. Atlas builds the same input from its tool call. */
export const flightSearchFormSchema = z
  .object({
    origin: requiredText(80, "From"),
    destination: requiredText(80, "To"),
    departureDate: requiredDate,
    returnDate: optionalDate,
    passengers: z
      .string()
      .trim()
      .refine(
        (value) =>
          /^\d+$/.test(value) &&
          Number(value) >= 1 &&
          Number(value) <= MAX_FLIGHT_PASSENGERS,
        `Enter 1 to ${MAX_FLIGHT_PASSENGERS} travelers`,
      )
      .transform(Number),
    cabin: z
      .enum([...CABIN_CLASSES, "any"])
      .transform((value) => (value === "any" ? null : value)),
    maxStops: z.enum(["0", "1", "2"]).transform(Number),
  })
  .superRefine((value, ctx) => {
    if (value.returnDate && value.returnDate < value.departureDate) {
      ctx.addIssue({
        code: "custom",
        path: ["returnDate"],
        message: "Return must be on or after departure",
      });
    }
    if (
      value.origin.trim().toLowerCase() ===
      value.destination.trim().toLowerCase()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Pick a different place than where you leave from",
      });
    }
  });

export type FlightSearchFormInput = z.input<typeof flightSearchFormSchema>;
export type FlightSearchInput = z.output<typeof flightSearchFormSchema>;

/** Prefills the search from what the trip already knows. Past dates are left blank. */
export function flightSearchDefaults(
  trip: {
    departureLocation: string | null;
    destination: string | null;
    startDate: Date | string | null;
    endDate: Date | string | null;
    groupSize: number | null;
  },
  today: string,
): FlightSearchFormInput {
  const start = trip.startDate ? toDateOnly(trip.startDate) : "";
  const end = trip.endDate ? toDateOnly(trip.endDate) : "";
  const departureDate = start && start >= today ? start : "";
  return {
    origin: trip.departureLocation?.slice(0, 80) ?? "",
    destination: trip.destination?.slice(0, 80) ?? "",
    departureDate,
    returnDate: departureDate && end >= departureDate ? end : "",
    passengers: String(
      Math.min(Math.max(trip.groupSize ?? 1, 1), MAX_FLIGHT_PASSENGERS),
    ),
    cabin: "economy",
    maxStops: "1",
  };
}

export const saveFlightSchema = z.object({
  token: z.string().min(1).max(20_000),
  asBooking: z.boolean(),
});

export const returnFlightsSchema = z.object({
  token: z.string().min(1).max(20_000),
});
