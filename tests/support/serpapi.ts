import type { FlightCacheStore } from "@/server/flights/cache";

/**
 * SerpApi Google Flights responses shaped like the documented examples
 * (https://serpapi.com/google-flights-api), trimmed to the fields the app reads plus a few extras.
 */

type Leg = {
  from: string;
  to: string;
  depart: string;
  arrive: string;
  airline?: string;
  flightNumber?: string;
  extensions?: string[];
};

export function serpItem(options: {
  price?: number | null;
  legs: Leg[];
  departureToken?: string;
  bookingToken?: string;
}) {
  const flights = options.legs.map((leg) => ({
    departure_airport: {
      name: `${leg.from} Airport`,
      id: leg.from,
      time: leg.depart,
    },
    arrival_airport: {
      name: `${leg.to} Airport`,
      id: leg.to,
      time: leg.arrive,
    },
    duration: 300,
    airplane: "Airbus A321neo",
    airline: leg.airline ?? "TAP Air Portugal",
    airline_logo: "https://www.gstatic.com/flights/airline_logos/70px/TP.png",
    travel_class: "Economy",
    flight_number: leg.flightNumber ?? "TP 202",
    legroom: "31 in",
    extensions: leg.extensions ?? [
      "Average legroom (31 in)",
      "Wi-Fi for a fee",
    ],
  }));
  return {
    flights,
    layovers: options.legs.slice(1).map((leg) => ({
      duration: 90,
      name: `${leg.from} Airport`,
      id: leg.from,
    })),
    total_duration: 420 + (options.legs.length - 1) * 120,
    carbon_emissions: {
      this_flight: 350000,
      typical_for_this_route: 380000,
      difference_percent: -8,
    },
    ...(options.price === null ? {} : { price: options.price ?? 520 }),
    type: options.departureToken ? "Round trip" : "One way",
    airline_logo: "https://www.gstatic.com/flights/airline_logos/70px/TP.png",
    ...(options.departureToken
      ? { departure_token: options.departureToken }
      : {}),
    ...(options.bookingToken ? { booking_token: options.bookingToken } : {}),
  };
}

export const GOOGLE_FLIGHTS_URL =
  "https://www.google.com/travel/flights?hl=en&gl=us&curr=USD&tfs=CBwQAhoeEgoyMDI2LTExLTIwagcIARIDSkZLcgcIARIDTElTQAFIAXABggELCP___________wGYAQI";

export function serpSearch(
  overrides: {
    best?: unknown[];
    other?: unknown[];
    insights?: unknown;
    url?: string | null;
    error?: string;
    status?: string;
  } = {},
) {
  return {
    search_metadata: {
      id: "6720f0b1c0ffee",
      status: overrides.status ?? "Success",
      json_endpoint: "https://serpapi.com/searches/6720f0b1c0ffee.json",
      created_at: "2026-10-15 12:00:00 UTC",
      processed_at: "2026-10-15 12:00:00 UTC",
      ...(overrides.url === null
        ? {}
        : { google_flights_url: overrides.url ?? GOOGLE_FLIGHTS_URL }),
      total_time_taken: 2.1,
    },
    search_parameters: { engine: "google_flights", currency: "USD" },
    ...(overrides.best ? { best_flights: overrides.best } : {}),
    ...(overrides.other ? { other_flights: overrides.other } : {}),
    ...(overrides.insights === undefined
      ? {
          price_insights: {
            lowest_price: 480,
            price_level: "typical",
            typical_price_range: [450, 700],
            price_history: [[1728000000, 520]],
          },
        }
      : overrides.insights === null
        ? {}
        : { price_insights: overrides.insights }),
    airports: [
      {
        departure: [
          {
            airport: { id: "JFK", name: "John F. Kennedy International" },
            city: "New York",
            country: "United States",
          },
        ],
        arrival: [
          {
            airport: { id: "LIS", name: "Humberto Delgado Airport" },
            city: "Lisbon",
            country: "Portugal",
          },
        ],
      },
    ],
    ...(overrides.error ? { error: overrides.error } : {}),
  };
}

export const NEW_YORK_SUGGESTIONS = {
  suggestions: [
    {
      position: 1,
      name: "New York",
      type: "city",
      description: "City in New York State",
      id: "/m/02_286",
      airports: [
        {
          name: "John F. Kennedy International Airport",
          id: "JFK",
          city: "New York",
          city_id: "/m/02_286",
          distance: "12 mi",
        },
        {
          name: "LaGuardia Airport",
          id: "LGA",
          city: "New York",
          city_id: "/m/02_286",
          distance: "7 mi",
        },
        {
          name: "Newark Liberty International Airport",
          id: "EWR",
          city: "Newark",
          city_id: "/m/0hptm",
          distance: "14 mi",
        },
      ],
    },
  ],
};

function airport(id: string, name: string, city: string, distance: string) {
  return { name, id, city, city_id: `/m/${id.toLowerCase()}`, distance };
}

/** Google's answer for "Lisbon", trimmed from a live response: the capital first, then towns. */
export const LISBON_SUGGESTIONS = {
  suggestions: [
    {
      position: 1,
      name: "Lisbon, Portugal",
      type: "city",
      description: "Capital of Portugal",
      id: "/m/04llb",
      airports: [airport("LIS", "Humberto Delgado Airport", "Lisbon", "3 mi")],
    },
    {
      position: 2,
      name: "Lisbon, Maine",
      type: "city",
      description: "Town in Maine",
      id: "/m/0tnkv",
      airports: [
        airport("PWM", "Portland International Jetport", "Portland", "28 mi"),
        airport("AUG", "Augusta State Airport", "Augusta", "25 mi"),
      ],
    },
    {
      position: 3,
      name: "Lisbon, Ohio",
      type: "city",
      description: "Village in Ohio",
      id: "/m/0yv19",
      airports: [
        airport(
          "PIT",
          "Pittsburgh International Airport",
          "Pittsburgh",
          "34 mi",
        ),
      ],
    },
  ],
};

/** Two cities named Portland, each with its own airport, so the name alone is ambiguous. */
export const PORTLAND_SUGGESTIONS = {
  suggestions: [
    {
      position: 1,
      name: "Portland, Oregon",
      type: "city",
      description: "City in Oregon",
      id: "/m/02frhbc",
      airports: [
        airport("PDX", "Portland International Airport", "Portland", "9 mi"),
      ],
    },
    {
      position: 2,
      name: "Portland, Maine",
      type: "city",
      description: "City in Maine",
      id: "/m/0fvxg",
      airports: [
        airport("PWM", "Portland International Jetport", "Portland", "3 mi"),
      ],
    },
  ],
};

/** Autocomplete answers by query, as the unit tests' mocked SerpApi returns them. */
export const SUGGESTIONS_BY_QUERY: Record<string, unknown> = {
  "new york": NEW_YORK_SUGGESTIONS,
  "new york city": NEW_YORK_SUGGESTIONS,
  lisbon: LISBON_SUGGESTIONS,
  portland: PORTLAND_SUGGESTIONS,
};

/** An in-memory cache store with the same contract as the Postgres one. */
export class MemoryFlightCache implements FlightCacheStore {
  readonly entries = new Map<string, { value: unknown; expiresAt: Date }>();

  async get(key: string, now: Date) {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= now) return null;
    return structuredClone(entry.value);
  }

  async set(key: string, value: unknown, expiresAt: Date) {
    this.entries.set(key, { value: structuredClone(value), expiresAt });
  }
}
