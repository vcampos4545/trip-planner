import type { FlightOffer } from "@/lib/flights";
import type {
  FlightSearchProvider,
  FlightSearchQuery,
  FlightSearchResult,
} from "@/server/flights";

/** A Duffel offer as the API returns it, trimmed to the fields the app reads plus a few extras. */
export function duffelOffer(
  overrides: {
    id?: string;
    amount?: string;
    currency?: string;
    owner?: string;
    stopsOutbound?: number;
    roundTrip?: boolean;
  } = {},
) {
  const segments = (from: string, to: string, day: string, count: number) =>
    Array.from({ length: count + 1 }, (_, index) => ({
      id: `seg_${from}${index}`,
      departing_at: `${day}T${String(8 + index * 3).padStart(2, "0")}:30:00`,
      arriving_at: `${day}T${String(10 + index * 3).padStart(2, "0")}:45:00`,
      origin: {
        iata_code: index === 0 ? from : "BOS",
        name: index === 0 ? `${from} Airport` : "Logan",
        city_name: index === 0 ? "New York" : "Boston",
        time_zone: "America/New_York",
      },
      destination: {
        iata_code: index === count ? to : "BOS",
        name: index === count ? `${to} Airport` : "Logan",
        city_name: index === count ? "Lisbon" : "Boston",
      },
      marketing_carrier: {
        name: overrides.owner ?? "Duffel Airways",
        iata_code: "ZZ",
      },
      operating_carrier: {
        name: overrides.owner ?? "Duffel Airways",
        iata_code: "ZZ",
      },
      marketing_carrier_flight_number: `${100 + index}`,
      stops: [],
      passengers: [{ cabin_class: "economy" }],
    }));
  return {
    id: overrides.id ?? "off_0001",
    live_mode: false,
    total_amount: overrides.amount ?? "432.10",
    total_currency: overrides.currency ?? "USD",
    base_amount: "400.00",
    tax_amount: "32.10",
    expires_at: "2026-11-01T12:00:00Z",
    owner: {
      name: overrides.owner ?? "Duffel Airways",
      iata_code: "ZZ",
      id: "arl_1",
    },
    passengers: [{ id: "pas_1", type: "adult" }],
    conditions: {},
    slices: [
      {
        id: "sli_1",
        duration: "PT7H15M",
        origin: { iata_code: "JFK" },
        destination: { iata_code: "LIS" },
        segments: segments(
          "JFK",
          "LIS",
          "2026-11-20",
          overrides.stopsOutbound ?? 0,
        ),
      },
      ...(overrides.roundTrip === false
        ? []
        : [
            {
              id: "sli_2",
              duration: "PT8H",
              origin: { iata_code: "LIS" },
              destination: { iata_code: "JFK" },
              segments: segments("LIS", "JFK", "2026-11-27", 0),
            },
          ]),
    ],
  };
}

export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A ready-made app-side offer for tests that do not exercise the Duffel mapping. */
export function sampleOffer(overrides: Partial<FlightOffer> = {}): FlightOffer {
  return {
    offerId: "off_test_1",
    airline: { name: "Duffel Airways", iataCode: "ZZ" },
    slices: [
      {
        origin: {
          iataCode: "JFK",
          name: "John F. Kennedy",
          cityName: "New York",
        },
        destination: {
          iataCode: "LIS",
          name: "Humberto Delgado",
          cityName: "Lisbon",
        },
        departingAt: "2026-11-20T08:30:00",
        arrivingAt: "2026-11-20T20:45:00",
        durationMinutes: 435,
        stops: 0,
        segments: [
          {
            marketingCarrier: "Duffel Airways",
            flightNumber: "ZZ100",
            operatingCarrier: "Duffel Airways",
            origin: {
              iataCode: "JFK",
              name: "John F. Kennedy",
              cityName: "New York",
            },
            destination: {
              iataCode: "LIS",
              name: "Humberto Delgado",
              cityName: "Lisbon",
            },
            departingAt: "2026-11-20T08:30:00",
            arrivingAt: "2026-11-20T20:45:00",
          },
        ],
      },
    ],
    totalAmount: "864.20",
    totalCurrency: "USD",
    passengers: 2,
    cabin: "economy",
    expiresAt: "2026-11-01T12:00:00Z",
    retrievedAt: "2026-10-15T12:00:00.000Z",
    sourceName: "Duffel (test data)",
    testMode: true,
    ...overrides,
  };
}

/** An in-memory flight provider for orchestrator and service tests. */
export class FakeFlightProvider implements FlightSearchProvider {
  readonly id = "fake";
  readonly label = "Duffel (test data)";
  readonly testMode = true;
  readonly queries: FlightSearchQuery[] = [];

  constructor(
    private readonly offers: FlightOffer[] = [sampleOffer()],
    private readonly error?: Error,
  ) {}

  async search(query: FlightSearchQuery): Promise<FlightSearchResult> {
    this.queries.push(query);
    if (this.error) throw this.error;
    return {
      search: {
        origin: {
          query: query.origin,
          iataCode: query.origin.toUpperCase(),
          name: query.origin,
        },
        destination: {
          query: query.destination,
          iataCode: query.destination.toUpperCase(),
          name: query.destination,
        },
        departureDate: query.departureDate,
        returnDate: query.returnDate,
        passengers: query.passengers,
        cabin: query.cabin,
        maxStops: query.maxStops,
      },
      offers: this.offers,
      retrievedAt: "2026-10-15T12:00:00.000Z",
      sourceName: "Duffel (test data)",
      testMode: true,
    };
  }
}
