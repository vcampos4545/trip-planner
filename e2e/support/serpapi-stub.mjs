/**
 * A tiny local stand-in for SerpApi's Google Flights and Google Hotels APIs, used only by the
 * Playwright suite.
 *
 * The app under test uses its real SerpApi provider; the suite points SERPAPI_API_URL here so the
 * request, response mapping, labelling, caching, and error handling run end to end without
 * spending real searches. An arrival of "ERR" simulates an outage and "QQQ" an exhausted quota; a
 * hotel search for "Outage Town" or "Quota Town" does the same for stays.
 * GET /stats reports how many searches reached the stub, so tests can prove the cache works.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.SERPAPI_STUB_PORT ?? 3317);
const KEY = "serpapi_e2e_stub_key";
const GOOGLE_URL =
  "https://www.google.com/travel/flights?hl=en&gl=us&curr=USD&tfs=e2e-stub";

const NEW_YORK = {
  name: "New York",
  type: "city",
  id: "/m/02_286",
  airports: [
    {
      name: "John F. Kennedy International Airport",
      id: "JFK",
      city: "New York",
    },
    { name: "LaGuardia Airport", id: "LGA", city: "New York" },
  ],
};

/** Autocomplete suggestions by query, best first, as Google Flights orders them. */
const PLACES = {
  "new york": [NEW_YORK],
  "new york city": [NEW_YORK],
  lisbon: [
    {
      name: "Lisbon",
      type: "city",
      id: "/m/04llb",
      airports: [
        { name: "Humberto Delgado Airport", id: "LIS", city: "Lisbon" },
      ],
    },
    {
      name: "Lisbon, Maine",
      type: "city",
      id: "/m/0tnkv",
      airports: [
        { name: "Portland International Jetport", id: "PWM", city: "Portland" },
      ],
    },
  ],
  // Two cities with their own airport: the app asks which one.
  portland: [
    {
      name: "Portland, Oregon",
      type: "city",
      description: "City in Oregon",
      id: "/m/02frhbc",
      airports: [
        { name: "Portland International Airport", id: "PDX", city: "Portland" },
      ],
    },
    {
      name: "Portland, Maine",
      type: "city",
      description: "City in Maine",
      id: "/m/0fvxg",
      airports: [
        { name: "Portland International Jetport", id: "PWM", city: "Portland" },
      ],
    },
  ],
};

const stats = {
  google_flights: 0,
  google_flights_autocomplete: 0,
  google_hotels: 0,
};

/** Two hotels and two rentals, shaped like SerpApi's documented Google Hotels response. */
function hotels(params) {
  const adults = Number(params.get("adults") ?? 2);
  const rentals = params.get("vacation_rentals") === "true";
  const nights = Math.round(
    (Date.parse(params.get("check_out_date")) -
      Date.parse(params.get("check_in_date"))) /
      86_400_000,
  );
  const rate = (nightly) => ({
    rate_per_night: { lowest: `$${nightly}`, extracted_lowest: nightly },
    total_rate: {
      lowest: `$${nightly * nights}`,
      extracted_lowest: nightly * nights,
    },
  });
  const image = (id) => [
    {
      thumbnail: `https://images.e2e.invalid/${id}-thumb.jpg`,
      original_image: `https://images.e2e.invalid/${id}.jpg`,
    },
  ];
  if (rentals) {
    const bedrooms = Number(params.get("bedrooms") ?? 0);
    return [
      {
        type: "vacation rental",
        name: "Stub Old Town Chalet",
        property_token: "stub_chalet",
        gps_coordinates: { latitude: 40.6461, longitude: -111.498 },
        check_in_time: "4:00 PM",
        check_out_time: "10:00 AM",
        ...rate(650 + adults * 5),
        prices: [
          {
            source: "Vrbo",
            rate_per_night: { extracted_lowest: 650 + adults * 5 },
          },
        ],
        images: image("chalet"),
        overall_rating: 4.8,
        reviews: 57,
        essential_info: ["Entire house", "Sleeps 10", "4 bedrooms"],
      },
      {
        type: "vacation rental",
        name: "Stub Two-Bedroom Condo",
        property_token: "stub_condo",
        gps_coordinates: { latitude: 40.651, longitude: -111.507 },
        ...rate(310),
        prices: [
          {
            source: "Bluepillow.com",
            rate_per_night: { extracted_lowest: 310 },
          },
        ],
        overall_rating: 4.2,
        reviews: 18,
        essential_info: ["Entire condo", "Sleeps 6", "2 bedrooms"],
      },
    ].filter((rental) =>
      bedrooms > 2 ? rental.name.includes("Chalet") : true,
    );
  }
  return [
    {
      type: "hotel",
      name: "Stub Summit Lodge",
      description: "Slopeside lodge.",
      link: "https://www.summitlodge.stub.example/",
      property_token: "stub_lodge",
      gps_coordinates: { latitude: 40.6514, longitude: -111.5079 },
      check_in_time: "4:00 PM",
      check_out_time: "11:00 AM",
      ...rate(412),
      prices: [
        { source: "Expedia", rate_per_night: { extracted_lowest: 430 } },
        { source: "Booking.com", rate_per_night: { extracted_lowest: 412 } },
      ],
      hotel_class: "4-star hotel",
      extracted_hotel_class: 4,
      images: image("lodge"),
      overall_rating: 4.6,
      reviews: 812,
      amenities: ["Pool", "Hot tub"],
    },
    {
      type: "hotel",
      name: "Stub Main Street Inn",
      property_token: "stub_inn",
      sponsored: true,
      gps_coordinates: { latitude: 40.6433, longitude: -111.4952 },
      ...rate(189),
      hotel_class: "3-star hotel",
      extracted_hotel_class: 3,
      overall_rating: 4.1,
      reviews: 230,
    },
    // Google sometimes lists a place without a rate for the dates; the app leaves it out.
    { type: "hotel", name: "Stub Sold Out Hotel", property_token: "stub_full" },
  ];
}

const CITIES = {
  JFK: "New York",
  LGA: "New York",
  EWR: "New York",
  LIS: "Lisbon",
  PDX: "Portland",
  SLC: "Salt Lake City",
};

/** A nonstop flight with exact local times, for routes the Park City test uses. */
function flight(from, to, date, departs, arrives, airline, number) {
  return {
    departure_airport: {
      name: `${from} Airport`,
      id: from,
      time: `${date} ${departs}`,
    },
    arrival_airport: {
      name: `${to} Airport`,
      id: to,
      time: `${date} ${arrives}`,
    },
    duration: 240,
    airplane: "Boeing 737",
    airline,
    airline_logo: "https://www.gstatic.com/flights/airline_logos/70px/ZZ.png",
    travel_class: "Economy",
    flight_number: number,
    legroom: "31 in",
    extensions: [],
  };
}

/** Southwest and Delta out of LaGuardia, and two American flights home from Salt Lake City. */
function namedRoute(from, to, date, adults) {
  const oneWay = (id) => ({ booking_token: `book_${id}` });
  if (from === "LGA" && to === "SLC") {
    return {
      best_flights: [
        item(
          flight(from, to, date, "06:00", "09:45", "Southwest", "WN 1234"),
          189 * adults,
          oneWay("wn"),
        ),
      ],
      other_flights: [
        item(
          flight(from, to, date, "08:15", "11:40", "Delta", "DL 455"),
          246 * adults,
          oneWay("dl"),
        ),
      ],
    };
  }
  if (from === "SLC" && to === "JFK") {
    return {
      best_flights: [
        item(
          flight(from, to, date, "07:05", "14:59", "American", "AA 2210"),
          212 * adults,
          oneWay("aa_early"),
        ),
        item(
          flight(from, to, date, "12:30", "20:31", "American", "AA 1880"),
          198 * adults,
          oneWay("aa_late"),
        ),
      ],
    };
  }
  return null;
}

function leg(from, to, date, hour, flightNumber) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    departure_airport: {
      name: `${from} Airport`,
      id: from,
      time: `${date} ${hour}:05`,
    },
    arrival_airport: {
      name: `${to} Airport`,
      id: to,
      time: `${date} ${pad(hour + 7)}:35`,
    },
    duration: 450,
    airplane: "Airbus A321neo",
    airline: "Stub Air",
    airline_logo: "https://www.gstatic.com/flights/airline_logos/70px/ZZ.png",
    travel_class: "Economy",
    flight_number: flightNumber,
    legroom: "31 in",
    extensions: ["Average legroom (31 in)"],
  };
}

function item(flight, price, extra) {
  return {
    flights: [flight],
    layovers: [],
    total_duration: 450,
    price,
    type: extra.departure_token ? "Round trip" : "One way",
    ...extra,
  };
}

function flights(params) {
  const adults = Number(params.get("adults") ?? 1);
  const from = params.get("departure_id").split(",")[0];
  const to = params.get("arrival_id").split(",")[0];
  const outbound = params.get("outbound_date");
  const back = params.get("return_date");
  const token = params.get("departure_token");
  if (token) {
    // Return options for the chosen outbound flight; prices are round-trip totals.
    return {
      best_flights: [
        item(leg(to, from, back, 11, "ZZ 201"), 640 * adults, {
          booking_token: "book_1",
        }),
        item(leg(to, from, back, 16, "ZZ 203"), 610 * adults, {
          booking_token: "book_2",
        }),
      ],
    };
  }
  const named = namedRoute(from, to, outbound, adults);
  if (named) {
    return {
      ...named,
      airports: [
        {
          departure: [
            {
              airport: { id: from, name: `${from} Airport` },
              city: CITIES[from],
            },
          ],
          arrival: [
            { airport: { id: to, name: `${to} Airport` }, city: CITIES[to] },
          ],
        },
      ],
    };
  }
  const roundTrip = params.get("type") === "1";
  const extra = (id) =>
    roundTrip
      ? { departure_token: `dep_${id}` }
      : { booking_token: `book_${id}` };
  const base = roundTrip ? 600 : 432;
  return {
    best_flights: [
      item(leg(from, to, outbound, 8, "ZZ 80"), base * adults, extra("cheap")),
    ],
    other_flights: [
      item(
        leg(from, to, outbound, 13, "ZZ 130"),
        (base + 83) * adults,
        extra("late"),
      ),
      // Google sometimes lists a flight without a price; the app leaves it out.
      item(leg(from, to, outbound, 15, "ZZ 150"), undefined, extra("unpriced")),
    ],
    price_insights: {
      lowest_price: base * adults,
      price_level: "low",
      typical_price_range: [(base + 100) * adults, (base + 300) * adults],
      price_history: [[1760000000, base * adults]],
    },
    airports: [
      {
        departure: [
          {
            airport: { id: from, name: `${from} Airport` },
            city: CITIES[from] ?? from,
          },
        ],
        arrival: [
          {
            airport: { id: to, name: `${to} Airport` },
            city: CITIES[to] ?? to,
          },
        ],
      },
    ],
  };
}

function send(response, status, body) {
  response
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/health") {
    response.writeHead(200).end("ok");
    return;
  }
  if (url.pathname === "/stats") {
    send(response, 200, stats);
    return;
  }
  if (request.method !== "GET" || url.pathname !== "/search.json") {
    send(response, 404, { error: "Not found" });
    return;
  }
  const params = url.searchParams;
  if (params.get("api_key") !== KEY) {
    send(response, 401, {
      error:
        "Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key",
    });
    return;
  }
  const engine = params.get("engine");
  if (engine in stats) stats[engine] += 1;
  if (engine === "google_flights_autocomplete") {
    const places = PLACES[(params.get("q") ?? "").toLowerCase()] ?? [];
    send(response, 200, {
      search_metadata: { status: "Success" },
      suggestions: places.map((place, index) => ({
        position: index + 1,
        ...place,
      })),
    });
    return;
  }
  if (engine === "google_hotels") {
    const q = params.get("q") ?? "";
    if (/outage town/i.test(q)) {
      send(response, 503, { error: "Internal error." });
      return;
    }
    if (/quota town/i.test(q)) {
      send(response, 429, { error: "Your account has run out of searches." });
      return;
    }
    send(response, 200, {
      search_metadata: { id: "stub", status: "Success" },
      search_parameters: Object.fromEntries(
        [...params].filter(([key]) => key !== "api_key"),
      ),
      properties: hotels(params),
    });
    return;
  }
  if (engine !== "google_flights") {
    send(response, 400, { error: "Unsupported engine." });
    return;
  }
  const arrival = params.get("arrival_id") ?? "";
  if (arrival === "ERR") {
    send(response, 503, {
      error:
        "We couldn't get valid results for this search. Please try again later.",
    });
    return;
  }
  if (arrival === "QQQ") {
    send(response, 429, { error: "Your account has run out of searches." });
    return;
  }
  send(response, 200, {
    search_metadata: {
      id: "stub",
      status: "Success",
      google_flights_url: GOOGLE_URL,
      created_at: new Date().toISOString(),
    },
    search_parameters: Object.fromEntries(
      [...params].filter(([key]) => key !== "api_key"),
    ),
    ...flights(params),
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SerpApi stub listening on ${PORT}`);
});
