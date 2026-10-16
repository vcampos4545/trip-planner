import { describe, expect, it } from "vitest";

import { parseListingLink } from "@/lib/domain/listing-link";
import {
  isShownStay,
  matchShownStays,
  nextStayResultId,
} from "@/lib/domain/stay-match";
import {
  clockToMinutes,
  describeStay,
  describeStayPrice,
  googleHotelsUrl,
  nightsBetween,
} from "@/lib/stays";
import {
  stayLinkFormSchema,
  staySearchDefaults,
  staySearchFormSchema,
  staySearchPlaces,
} from "@/lib/validation/stays";

import { sampleStay } from "../support/stays";

describe("parseListingLink", () => {
  it.each([
    ["https://www.airbnb.com/rooms/53917725?adults=4", "Airbnb", null],
    ["https://www.vrbo.com/2345678ha", "Vrbo", null],
    [
      "https://www.booking.com/hotel/us/the-lodge-at-mountain-village.en-gb.html?checkin=2027-03-05",
      "Booking.com",
      "The Lodge at Mountain Village",
    ],
    [
      "https://www.expedia.com/Park-City-Hotels-Grand-Summit-Lodge.h12345.Hotel-Information",
      "Expedia",
      "Grand Summit Lodge",
    ],
    [
      "https://www.hotels.com/ho123456/grand-summit-lodge-park-city/",
      "Hotels.com",
      "Grand Summit Lodge Park City",
    ],
  ])("recognises %s as %s", (url, site, name) => {
    const link = parseListingLink(url);
    expect(link?.site).toMatchObject({ name: site, known: true });
    expect(link?.suggestedName).toBe(name);
  });

  it("names an unknown site from its host and keeps the link as pasted", () => {
    const link = parseListingLink("https://stays.mountaincabins.co.uk/cabin/7");
    expect(link).toEqual({
      url: "https://stays.mountaincabins.co.uk/cabin/7",
      site: {
        name: "Mountaincabins",
        host: "stays.mountaincabins.co.uk",
        known: false,
      },
      suggestedName: null,
    });
  });

  it("matches only the real domain, not a look-alike", () => {
    expect(
      parseListingLink("https://airbnb.com.evil.example/rooms/1")?.site,
    ).toMatchObject({ known: false });
    expect(
      parseListingLink("https://notairbnb.com/rooms/1")?.site,
    ).toMatchObject({
      known: false,
    });
  });

  it.each([
    "airbnb.com/rooms/1",
    "ftp://airbnb.com/rooms/1",
    "javascript:alert(1)",
    "https://localhost/x",
  ])("rejects %s", (value) => {
    expect(parseListingLink(value)).toBeNull();
  });
});

describe("stay helpers", () => {
  it("counts nights and reads check-in times", () => {
    expect(nightsBetween("2027-03-05", "2027-03-07")).toBe(2);
    expect(nightsBetween("2027-03-30", "2027-04-02")).toBe(3);
    expect(clockToMinutes("3:00 PM")).toBe(900);
    expect(clockToMinutes("12:00 PM")).toBe(720);
    expect(clockToMinutes("12:00 AM")).toBe(0);
    expect(clockToMinutes("11 AM")).toBe(660);
    expect(clockToMinutes("15:30")).toBe(930);
    expect(clockToMinutes("noon")).toBeNull();
    expect(clockToMinutes("13:00 PM")).toBeNull();
    expect(clockToMinutes(null)).toBeNull();
  });

  it("describes a stay and its price only from what the source returned", () => {
    expect(describeStay(sampleStay())).toBe(
      "Hotel, 4-star, rated 4.6/5 from 812 reviews",
    );
    expect(describeStayPrice(sampleStay())).toBe(
      "412.00 USD a night, 824.00 USD total for 2 nights",
    );
    expect(describeStayPrice(sampleStay({ totalAmount: null }))).toBe(
      "412.00 USD a night, total not shown",
    );
    expect(googleHotelsUrl("Old Town Chalet", "Park City")).toBe(
      "https://www.google.com/travel/search?q=Old%20Town%20Chalet%2C%20Park%20City",
    );
  });
});

describe("staySearchFormSchema", () => {
  const valid = {
    location: "Park City",
    checkIn: "2027-03-05",
    checkOut: "2027-03-07",
    guests: "4",
    kind: "vacation_rental",
    bedrooms: "4",
    minPrice: "",
    maxPrice: "800",
    sort: "relevance",
  };

  it("parses form strings into a query", () => {
    expect(staySearchFormSchema.parse(valid)).toEqual({
      location: "Park City",
      checkIn: "2027-03-05",
      checkOut: "2027-03-07",
      guests: 4,
      kind: "vacation_rental",
      bedrooms: 4,
      minPrice: null,
      maxPrice: 800,
      sort: "relevance",
    });
  });

  it("drops bedrooms for hotels, which can't filter on them", () => {
    expect(
      staySearchFormSchema.parse({ ...valid, kind: "hotel" }).bedrooms,
    ).toBeNull();
  });

  it.each([
    [
      { checkOut: "2027-03-05" },
      "checkOut",
      "Check-out must be after check-in",
    ],
    [
      { checkOut: "2027-04-30" },
      "checkOut",
      "Search up to 30 nights at a time",
    ],
    [{ guests: "0" }, "guests", "Enter 1 to 20 guests"],
    [
      { minPrice: "900", maxPrice: "100" },
      "maxPrice",
      "Max must be at least the min",
    ],
    [{ location: " " }, "location", "Where is required"],
  ])("rejects %o", (change, path, message) => {
    const result = staySearchFormSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: [path], message }),
    );
  });
});

describe("staySearchPlaces and defaults", () => {
  const trip = {
    destination: "Park City",
    startDate: "2027-02-27",
    endDate: "2027-03-07",
  };

  it("offers each stop with its dates and prefills the first upcoming one", () => {
    const places = staySearchPlaces(
      trip,
      [
        {
          name: "Jackson Hole",
          startDate: "2027-02-27",
          endDate: "2027-03-02",
        },
        { name: "Park City", startDate: "2027-03-02", endDate: "2027-03-07" },
      ],
      "2027-02-28",
    );
    expect(places).toEqual([
      {
        label: "Jackson Hole",
        location: "Jackson Hole",
        checkIn: "",
        checkOut: "",
      },
      {
        label: "Park City",
        location: "Park City",
        checkIn: "2027-03-02",
        checkOut: "2027-03-07",
      },
    ]);
    expect(staySearchDefaults(places, 4)).toMatchObject({
      location: "Park City",
      checkIn: "2027-03-02",
      checkOut: "2027-03-07",
      guests: "4",
      kind: "hotel",
    });
  });

  it("uses the trip's dates for a single stop without its own", () => {
    const places = staySearchPlaces(
      trip,
      [{ name: "Park City", startDate: null, endDate: null }],
      "2026-10-15",
    );
    expect(places[0]).toMatchObject({
      checkIn: "2027-02-27",
      checkOut: "2027-03-07",
    });
  });

  it("falls back to the destination, and to blanks when nothing is known", () => {
    expect(staySearchPlaces(trip, [], "2026-10-15")).toHaveLength(1);
    const empty = staySearchPlaces(
      { destination: null, startDate: null, endDate: null },
      [],
      "2026-10-15",
    );
    expect(empty).toEqual([]);
    expect(staySearchDefaults(empty, null)).toMatchObject({
      location: "",
      checkIn: "",
      guests: "2",
    });
  });
});

describe("stayLinkFormSchema", () => {
  const valid = {
    url: "https://www.airbnb.com/rooms/1",
    title: "Cabin near Main Street",
    checkIn: "2027-03-05",
    checkOut: "2027-03-07",
    priceAmount: "350",
    priceBasis: "night",
    currency: "usd",
    travelers: ["m1"],
    booked: false,
    notes: "",
  };

  it("accepts a hand-entered listing", () => {
    expect(stayLinkFormSchema.parse(valid)).toMatchObject({
      priceAmount: "350.00",
      currency: "USD",
      notes: null,
    });
  });

  it.each([
    [{ url: "airbnb.com/rooms/1" }, "url"],
    [{ title: "" }, "title"],
    [{ currency: "" }, "currency"],
    [{ checkOut: "" }, "checkOut"],
    [{ checkOut: "2027-03-04" }, "checkOut"],
    [{ travelers: ["m1", "m1"] }, "travelers"],
  ])("rejects %o", (change, path) => {
    const result = stayLinkFormSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(path);
  });
});

describe("shown stays", () => {
  const shown = [
    { resultId: "s1", offer: sampleStay({ name: "Grand Summit Lodge" }) },
    {
      resultId: "s2",
      offer: sampleStay({ name: "Old Town Ski Chalet", offerId: "gh_2" }),
    },
    {
      resultId: "s3",
      offer: sampleStay({ name: "Grand Summit Lodge", offerId: "gh_3" }),
    },
    {
      resultId: "s4",
      offer: sampleStay({ name: "Summit Watch Resort", offerId: "gh_4" }),
    },
  ];

  it("finds a stay by result ID or name, keeping the latest showing of each place", () => {
    expect(
      matchShownStays(shown, { resultId: "s2", name: null }).map(
        (m) => m.resultId,
      ),
    ).toEqual(["s2"]);
    expect(
      matchShownStays(shown, {
        resultId: null,
        name: "we booked the Grand Summit Lodge",
      }).map((m) => m.resultId),
    ).toEqual(["s3"]);
    expect(
      matchShownStays(shown, { resultId: null, name: "Grand Summit" }).map(
        (m) => m.resultId,
      ),
    ).toEqual(["s3"]);
  });

  it("reports more than one when a name fits several places", () => {
    expect(
      matchShownStays(shown, { resultId: null, name: "summit" }).map(
        (m) => m.resultId,
      ),
    ).toEqual(["s4", "s3"]);
    expect(matchShownStays(shown, { resultId: null, name: null })).toEqual([]);
  });

  it("checks stored results and numbers new ones after the old", () => {
    expect(isShownStay(shown[0])).toBe(true);
    expect(isShownStay({ resultId: "f1", offer: sampleStay() })).toBe(false);
    expect(isShownStay({ resultId: "s1", offer: { name: "x" } })).toBe(false);
    expect(nextStayResultId(["s1", "s9", "f12"])).toBe("s10");
  });
});
