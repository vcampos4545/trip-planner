import { describe, expect, it } from "vitest";

import { checkRateLimit, resetRateLimits } from "@/server/rate-limit";
import { bookingFormSchema } from "@/lib/validation/booking";
import { emptyBooking, emptyEvent } from "@/lib/validation/form-defaults";
import { eventFormSchema } from "@/lib/validation/itinerary";
import { optionFormSchema } from "@/lib/validation/research";
import { tripDetailsFormSchema } from "@/lib/validation/trip";
import { toTripDetailsFormInput } from "@/lib/validation/form-defaults";
import { EMPTY_TRIP_DETAILS } from "@/lib/domain/trip-details";

describe("form schemas", () => {
  it("turns blank optional fields into null and parses numbers and money", () => {
    const parsed = tripDetailsFormSchema.parse({
      ...toTripDetailsFormInput(EMPTY_TRIP_DETAILS, "Trip"),
      groupSize: "4",
      budgetAmount: "$1,500",
      budgetCurrency: "usd",
    });
    expect(parsed.destination).toBeNull();
    expect(parsed.groupSize).toBe(4);
    expect(parsed.budgetAmount).toBe("1500.00");
    expect(parsed.budgetCurrency).toBe("USD");
  });

  it("requires a currency when a budget amount is given and orders dates", () => {
    const result = tripDetailsFormSchema.safeParse({
      ...toTripDetailsFormInput(EMPTY_TRIP_DETAILS, "Trip"),
      budgetAmount: "900",
      startDate: "2027-05-10",
      endDate: "2027-05-01",
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["budgetCurrency", "endDate"]),
    );
  });

  it("rejects non-http links", () => {
    const result = optionFormSchema.safeParse({
      category: "LODGING",
      title: "Place",
      description: "",
      url: "javascript:alert(1)",
      sourceName: "",
      priceAmount: "",
      priceCurrency: "",
      priceUnit: "",
      priceNote: "",
      locationName: "",
      address: "",
      latitude: "",
      longitude: "",
    });
    expect(result.success).toBe(false);
  });

  it("keeps booking travelers unique and converts times to minutes", () => {
    const base = {
      ...emptyBooking("FLIGHT", "USD"),
      title: "TP 202",
      startTime: "07:45",
    };
    expect(bookingFormSchema.parse(base).startTime).toBe(465);
    const duplicate = bookingFormSchema.safeParse({
      ...base,
      participants: [
        {
          memberId: "m1",
          status: "BOOKED",
          shareAmount: "",
          roomAssignment: "",
        },
        {
          memberId: "m1",
          status: "CONSIDERING",
          shareAmount: "",
          roomAssignment: "",
        },
      ],
    });
    expect(duplicate.success).toBe(false);
  });

  it("requires an itinerary end time after the start", () => {
    const result = eventFormSchema.safeParse({
      ...emptyEvent("2027-05-20"),
      title: "Museum",
      startTime: "14:00",
      endTime: "13:00",
    });
    expect(result.success).toBe(false);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit inside the window and recovers after it", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i += 1) checkRateLimit("k", 3, 1000, 0);
    expect(() => checkRateLimit("k", 3, 1000, 10)).toThrow(/Too many requests/);
    expect(() => checkRateLimit("k", 3, 1000, 1500)).not.toThrow();
  });
});
