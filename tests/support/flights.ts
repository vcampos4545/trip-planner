import type { FlightOffer } from "@/lib/flights";
import type {
  FlightSearchProvider,
  FlightSearchQuery,
  FlightSearchResult,
} from "@/server/flights";

const CITIES: Record<string, string> = {
  LGA: "New York",
  JFK: "New York",
  SLC: "Salt Lake City",
};

/** A one-way, nonstop offer as a live provider would map it. Times are local (HH:MM). */
export function oneWayOffer(options: {
  id: string;
  airline: string;
  number: string;
  from: string;
  to: string;
  date: string;
  departs: string;
  arrives: string;
  amount?: string;
}): FlightOffer {
  const airport = (code: string) => ({
    iataCode: code,
    name: `${code} Airport`,
    cityName: CITIES[code] ?? null,
  });
  const departingAt = `${options.date}T${options.departs}:00`;
  const arrivingAt = `${options.date}T${options.arrives}:00`;
  return {
    offerId: options.id,
    airline: { name: options.airline, iataCode: null },
    slices: [
      {
        origin: airport(options.from),
        destination: airport(options.to),
        departingAt,
        arrivingAt,
        durationMinutes: 240,
        stops: 0,
        segments: [
          {
            marketingCarrier: options.airline,
            flightNumber: options.number,
            operatingCarrier: options.airline,
            origin: airport(options.from),
            destination: airport(options.to),
            departingAt,
            arrivingAt,
          },
        ],
      },
    ],
    totalAmount: options.amount ?? "189.00",
    totalCurrency: "USD",
    passengers: 1,
    cabin: "economy",
    expiresAt: null,
    retrievedAt: "2026-10-16T12:00:00.000Z",
    sourceName: "Google Flights via SerpApi",
    providerId: "serpapi",
    testMode: false,
    bookingUrl: "https://www.google.com/travel/flights?tfs=test",
  };
}

/** A live-looking provider that answers each route with its own offers. */
export class RouteFlightProvider implements FlightSearchProvider {
  readonly id = "routes";
  readonly label = "Google Flights via SerpApi";
  readonly testMode = false;
  readonly queries: FlightSearchQuery[] = [];

  constructor(private readonly routes: Record<string, FlightOffer[]>) {}

  async search(query: FlightSearchQuery): Promise<FlightSearchResult> {
    this.queries.push(query);
    const key = `${query.origin.toUpperCase()}-${query.destination.toUpperCase()}`;
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
      offers: this.routes[key] ?? [],
      retrievedAt: "2026-10-16T12:00:00.000Z",
      sourceName: "Google Flights via SerpApi",
      testMode: false,
    };
  }
}

/** Southwest out of LaGuardia and two American flights home, as in the Park City trip. */
export const PARK_CITY_FLIGHTS = {
  "LGA-SLC": [
    oneWayOffer({
      id: "out_wn",
      airline: "Southwest",
      number: "WN1234",
      from: "LGA",
      to: "SLC",
      date: "2027-02-27",
      departs: "06:00",
      arrives: "09:45",
      amount: "189.00",
    }),
    oneWayOffer({
      id: "out_dl",
      airline: "Delta",
      number: "DL455",
      from: "LGA",
      to: "SLC",
      date: "2027-02-27",
      departs: "08:15",
      arrives: "11:40",
      amount: "246.00",
    }),
  ],
  "SLC-JFK": [
    oneWayOffer({
      id: "back_aa_early",
      airline: "American Airlines",
      number: "AA2210",
      from: "SLC",
      to: "JFK",
      date: "2027-03-07",
      departs: "07:05",
      arrives: "14:59",
      amount: "212.00",
    }),
    oneWayOffer({
      id: "back_aa_late",
      airline: "American Airlines",
      number: "AA1880",
      from: "SLC",
      to: "JFK",
      date: "2027-03-07",
      departs: "12:30",
      arrives: "20:31",
      amount: "198.00",
    }),
  ],
};
