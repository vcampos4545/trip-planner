/**
 * A tiny local stand-in for the OpenAI Responses API, used only by the Playwright suite.
 *
 * The app under test uses its real OpenAI provider; the suite points OPENAI_BASE_URL here so tool
 * calling, validation, persistence, and error handling run end to end without a real key. Replies
 * are chosen from the latest user message, so tests are deterministic. Requests that carry the
 * hosted `web_search` tool get canned search results with sources and citations.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.OPENAI_STUB_PORT ?? 3319);
let counter = 0;
const nextId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${(counter += 1)}`;

const DETAIL_KEYS = [
  "title",
  "summary",
  "destination",
  "destinationConfirmed",
  "departureLocation",
  "flyIntoAirport",
  "flyOutOfAirport",
  "tripStyle",
  "theme",
  "startDate",
  "endDate",
  "dateFlexibility",
  "dateNotes",
  "durationDays",
  "groupSize",
  "groupNotes",
  "budgetAmount",
  "budgetCurrency",
  "budgetBasis",
  "budgetIncludes",
  "budgetNotes",
  "flightsStatus",
  "lodgingStatus",
  "localTransportStatus",
  "activitiesStatus",
];

function changes(values) {
  return Object.fromEntries(
    DETAIL_KEYS.map((key) => [key, key in values ? values[key] : null]),
  );
}

function knownDetails(instructions) {
  const match = /Known so far \(JSON\): (\{.*\})/.exec(instructions ?? "");
  try {
    return match ? JSON.parse(match[1]) : {};
  } catch {
    return {};
  }
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function functionCall(name, args) {
  return {
    type: "function_call",
    id: nextId("fc"),
    call_id: nextId("call"),
    name,
    arguments: JSON.stringify(args),
    status: "completed",
  };
}

function message(text) {
  return {
    type: "message",
    id: nextId("msg"),
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function response(model, output) {
  return {
    id: nextId("resp"),
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    error: null,
    incomplete_details: null,
    model,
    output,
    parallel_tool_calls: true,
    tool_choice: "auto",
    tools: [],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}

function lastUserText(input) {
  if (typeof input === "string") return input;
  const users = (input ?? []).filter((item) => item.role === "user");
  const last = users[users.length - 1];
  if (!last) return "";
  return typeof last.content === "string"
    ? last.content
    : JSON.stringify(last.content);
}

/**
 * Canned results for the hosted web_search tool. The third result is not among the consulted
 * sources or citations, so the app must drop it rather than present it as live.
 */
const WEB_RESULTS = [
  {
    title: "Stub Hotel Pantheon",
    url: "https://stays.stub.example/pantheon?utm_source=openai",
    sourceName: "Stub Stays",
    description: "Small hotel a short walk from the Pantheon.",
    locationName: "Rome",
    price: { amount: "210", currency: "EUR", unit: "night" },
    availability: "Rooms available on the requested dates",
  },
  {
    title: "Stub Trastevere Apartment",
    url: "https://rentals.stub.example/trastevere",
    sourceName: "Stub Rentals",
    description: "Two-bedroom apartment in Trastevere.",
    locationName: "Rome",
    price: null,
    availability: null,
  },
  {
    title: "Invented Palace Hotel",
    url: "https://invented.stub.example/palace",
    sourceName: "Nowhere",
    description: "Not a page the search consulted.",
    locationName: "Rome",
    price: { amount: "99", currency: "EUR", unit: "night" },
    availability: "Always available",
  },
];

/** Answers a research request that uses the hosted web_search tool. */
function webSearch(body) {
  const query = typeof body.input === "string" ? body.input : "";
  const text = JSON.stringify({ results: WEB_RESULTS });
  return response(body.model, [
    {
      type: "web_search_call",
      id: nextId("ws"),
      status: "completed",
      action: {
        type: "search",
        query,
        sources: [{ type: "url", url: "https://stays.stub.example/pantheon" }],
      },
    },
    {
      type: "message",
      id: nextId("msg"),
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text,
          annotations: [
            {
              type: "url_citation",
              start_index: 0,
              end_index: text.length,
              url: "https://rentals.stub.example/trastevere?utm_source=openai",
              title: "Trastevere apartment",
            },
          ],
        },
      ],
    },
  ]);
}

function isWebSearchRequestValid(body) {
  return (
    body.store === false &&
    body.tool_choice === "required" &&
    Array.isArray(body.include) &&
    body.include.includes("web_search_call.action.sources") &&
    body.text?.format?.type === "json_schema" &&
    body.text.format.strict === true
  );
}

/** Full record_booking arguments, as a strict-mode model sends them. */
function booking(values) {
  return {
    category: "FLIGHT",
    travelers: [],
    fromShownFlight: null,
    title: null,
    provider: null,
    reference: null,
    fromLocation: null,
    toLocation: null,
    startDate: null,
    startTime: null,
    endDate: null,
    endTime: null,
    costAmount: null,
    currency: null,
    costPerPerson: null,
    notes: null,
    ...values,
  };
}

function shownFlight(values) {
  return {
    resultId: null,
    airline: null,
    flightNumber: null,
    date: null,
    departureTime: null,
    arrivalTime: null,
    origin: null,
    destination: null,
    leg: null,
    ...values,
  };
}

function stop(values) {
  return {
    action: "add",
    newName: null,
    startDate: null,
    endDate: null,
    position: null,
    ...values,
  };
}

/** "2:59pm" -> "14:59" */
function clock(hour, minute, meridiem) {
  let h = Number(hour) % 12;
  if (meridiem === "pm") h += 12;
  return `${String(h).padStart(2, "0")}:${minute ?? "00"}`;
}

/** The Park City trip: a multi-stop ski trip, a friend's rides, and flights bought after searches. */
function parkCity(lower) {
  if (lower.includes("jackson hole and then park city")) {
    return [
      functionCall("update_trip_details", {
        changes: changes({
          destination: "Park City",
          departureLocation: "NYC",
          flyIntoAirport: "SLC",
          flyOutOfAirport: "SLC",
          startDate: "2027-02-27",
          endDate: "2027-03-07",
          dateFlexibility: "FIXED",
          groupSize: 1,
        }),
        preferences: [],
        candidateDestinations: [],
      }),
      functionCall("update_trip_stops", {
        changes: [
          stop({
            name: "Jackson Hole",
            startDate: "2027-02-27",
            endDate: "2027-03-02",
          }),
          stop({
            name: "Park City",
            startDate: "2027-03-02",
            endDate: "2027-03-07",
          }),
        ],
      }),
    ];
  }
  if (lower.includes("we're skiing")) {
    return [
      functionCall("update_trip_details", {
        changes: changes({ theme: "SKI", title: "Out West ski trip" }),
        preferences: [],
        candidateDestinations: [],
      }),
      functionCall("suggest_theme_tasks", { theme: "SKI" }),
    ];
  }
  if (lower.includes("friend is driving me")) {
    return [
      functionCall(
        "record_booking",
        booking({
          category: "GROUND_TRANSPORT",
          provider: "Friend driving",
          fromLocation: "Salt Lake City",
          toLocation: "Jackson Hole",
          startDate: "2027-02-27",
        }),
      ),
      functionCall(
        "record_booking",
        booking({
          category: "GROUND_TRANSPORT",
          provider: "Friend driving",
          fromLocation: "Jackson Hole",
          toLocation: "Park City",
          startDate: "2027-03-02",
        }),
      ),
    ];
  }
  const route =
    /flights (?:home )?from (\w{3}) to (\w{3}) on (feb 27|mar 7)/.exec(lower);
  if (route) {
    return [
      functionCall("search_flights", {
        origin: route[1].toUpperCase(),
        destination: route[2].toUpperCase(),
        departureDate: route[3] === "feb 27" ? "2027-02-27" : "2027-03-07",
        returnDate: null,
        passengers: null,
        cabin: null,
        maxStops: null,
      }),
    ];
  }
  const bought = /i bought the (\w+) flight/.exec(lower);
  if (bought) {
    const lands = /lands at (\d{1,2})(?::(\d{2}))?\s*(am|pm)/.exec(lower);
    return [
      functionCall(
        "record_booking",
        booking({
          fromShownFlight: shownFlight({
            airline: bought[1].charAt(0).toUpperCase() + bought[1].slice(1),
            arrivalTime: lands ? clock(lands[1], lands[2], lands[3]) : null,
          }),
        }),
      ),
    ];
  }
  return null;
}

/** Replies for the Park City conversation, written only from tool results. */
function parkCityReply(lower, outputs) {
  const results = outputs
    .filter((output) => output.ok)
    .map((output) => output.result);
  if (lower.includes("jackson hole and then park city")) {
    const asks = results.some((result) =>
      String(result?.theme ?? "").includes("Is this a ski trip?"),
    );
    return `Got it: Jackson Hole, then Park City, flying in and out of Salt Lake City.${asks ? " Is this a ski trip?" : ""}`;
  }
  if (lower.includes("we're skiing")) {
    const tasks = results.find((result) => Array.isArray(result?.suggested));
    return `A ski trip it is. I suggested calling it Out West ski trip; accept it below if you like it.${tasks?.suggested?.length ? ` I also suggested ${tasks.suggested.length} ski tasks for you to review.` : ""}`;
  }
  if (lower.includes("friend is driving me")) {
    const recorded = results.filter((result) => result?.recorded).length;
    return `I added ${recorded} rides with your friend to Bookings. You can edit or undo them below.`;
  }
  const search = results.find((result) => Array.isArray(result?.results));
  if (search) {
    return `On ${search.source} I found ${search.results.map((result) => `${result.airline} at ${result.totalPrice}`).join(" and ")}.`;
  }
  const recorded = results.find((result) => result?.recorded !== undefined);
  if (recorded?.recorded) {
    return `Recorded ${recorded.bookings.map((item) => item.title).join(" and ")} in Bookings as booked for ${recorded.travelers}. It isn't confirmed with the airline; edit or undo it below.`;
  }
  if (recorded?.ambiguous) {
    return `I showed more than one: ${recorded.candidates.map((item) => item.flight).join("; ")}. Which one did you buy?`;
  }
  if (recorded?.notFound) {
    return "I couldn't find that flight in the results I showed. Which airline, date, and times was it?";
  }
  return null;
}

/** Picks tool calls for a fresh user message. */
function plan(text, instructions) {
  const lower = text.toLowerCase();
  const known = knownDetails(instructions);
  const trip = parkCity(lower);
  if (trip) return trip;
  if (lower.includes("live search")) {
    return [
      functionCall("search_options", {
        category: "LODGING",
        query: lower.includes("searchfail")
          ? "searchfail hotels"
          : "hotels near the Pantheon",
        location: "Rome",
      }),
    ];
  }
  if (lower.includes("lisbon")) {
    return [
      functionCall("update_trip_details", {
        changes: changes({
          destination: "Lisbon",
          groupSize: 4,
          dateNotes: "late May",
          dateFlexibility: "FLEXIBLE",
        }),
        preferences: [
          {
            kind: "INTEREST",
            strength: "PREFERENCE",
            description: "Food markets",
          },
        ],
        candidateDestinations: [],
      }),
    ];
  }
  if (lower.includes("activity") && known.startDate) {
    return [
      functionCall("propose_itinerary_event", {
        title: "Atlas pick: Tile museum visit",
        kind: "ACTIVITY",
        date: addDays(known.startDate, 1),
        startTime: "14:00",
        endTime: "16:00",
        locationName: "Museu Nacional do Azulejo",
        notes: null,
        rationale:
          "A relaxed afternoon that fits the group's interest in local culture.",
        caveats: "Opening hours and travel time are not verified.",
        relatedOptionId: null,
      }),
      functionCall("propose_itinerary_event", {
        title: "Atlas pick: Sunset viewpoint",
        kind: "ACTIVITY",
        date: addDays(known.startDate, 1),
        startTime: "19:00",
        endTime: "20:00",
        locationName: "Miradouro da Senhora do Monte",
        notes: null,
        rationale: "Free and close to dinner spots.",
        caveats: "Sunset time not verified.",
        relatedOptionId: null,
      }),
    ];
  }
  if (lower.includes("flights")) {
    return [
      functionCall("search_flights", {
        origin: "JFK",
        destination: "LIS",
        departureDate: known.startDate,
        returnDate: null,
        passengers: null,
        cabin: null,
        maxStops: null,
      }),
    ];
  }
  if (lower.includes("suggest tasks")) {
    return [
      functionCall("suggest_task", {
        title: "Atlas pick: Compare airport transfers",
        description: null,
        priority: "MEDIUM",
        relatedOptionId: null,
      }),
    ];
  }
  if (lower.includes("invalid")) {
    return [
      functionCall("update_trip_details", {
        changes: changes({ startDate: "2027-02-30" }),
        preferences: [],
        candidateDestinations: [],
      }),
    ];
  }
  return [];
}

/** After a live search, saves the first result when the user asked for that. */
function followUp(text, outputs) {
  const search = outputs.find((output) => output.result?.results);
  const saved = outputs.some((output) => output.result?.saved !== undefined);
  const first = search?.result.results[0];
  if (!first || saved || !text.toLowerCase().includes("save the first"))
    return [];
  return [
    functionCall("save_research_option", {
      category: "LODGING",
      title: first.title,
      description: null,
      rationale: "Close to the sights the group wants to see.",
      sourceResultId: first.resultId,
      locationName: null,
    }),
  ];
}

/** Writes the reply after tool results came back. */
function reply(text, outputs) {
  const lower = text.toLowerCase();
  const failed = outputs.filter((output) => output.ok === false);
  const trip = parkCity(lower) ? parkCityReply(lower, outputs) : null;
  if (trip) return trip;
  if (lower.includes("live search")) {
    const search = outputs.find((output) => output.result?.results);
    if (!search) {
      return "Live research failed, so I can't show live results right now. Try again later or add options by hand.";
    }
    const links = search.result.results
      .map((result) => `[${result.title}](${result.url})`)
      .join(" and ");
    const saved = outputs.some((output) => output.result?.saved === true);
    return `Live search found ${links}.${saved ? " I saved the first one to your options for the group to review." : ""}`;
  }
  if (lower.includes("lisbon")) {
    return "Lisbon in late May with four of you sounds great. I saved that to the trip. Where will everyone be flying from?";
  }
  if (lower.includes("activity")) {
    return "I added two ideas for your second day as suggestions. Accept the ones you like on the Itinerary tab.";
  }
  if (lower.includes("flights")) {
    // Answers only from the tool result and leaves the test-data label to the app.
    const found = outputs.find((output) => output.ok && output.result?.results);
    if (!found) return "I couldn't search flights right now.";
    const [cheapest] = found.result.results;
    return cheapest
      ? `The cheapest flight I found is ${cheapest.airline} at ${cheapest.totalPrice}.`
      : "No flights matched.";
  }
  if (lower.includes("suggest tasks")) {
    return "I suggested a task for comparing airport transfers. It waits for your review.";
  }
  if (failed.length > 0) {
    return `I couldn't save that: ${failed.map((output) => output.error).join(" ")}`;
  }
  return "Got it.";
}

const server = createServer(async (request, response_) => {
  if (request.method === "GET" && request.url === "/health") {
    response_.writeHead(200).end("ok");
    return;
  }
  if (request.method !== "POST" || !request.url?.endsWith("/responses")) {
    response_
      .writeHead(404, { "content-type": "application/json" })
      .end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const input = body.input ?? [];
  const text = lastUserText(input);

  if (text.toLowerCase().includes("simulate outage")) {
    response_.writeHead(503, { "content-type": "application/json" }).end(
      JSON.stringify({
        error: { message: "Service unavailable", type: "server_error" },
      }),
    );
    return;
  }
  if (body.tools?.some((tool) => tool.type === "web_search")) {
    if (String(body.input).includes("searchfail")) {
      response_.writeHead(500, { "content-type": "application/json" }).end(
        JSON.stringify({
          error: { message: "Search backend error", type: "server_error" },
        }),
      );
      return;
    }
    if (!isWebSearchRequestValid(body)) {
      response_.writeHead(400, { "content-type": "application/json" }).end(
        JSON.stringify({
          error: {
            message:
              "The stub expects store=false, a required web_search call, sources, and a strict JSON schema",
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }
    response_
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(webSearch(body)));
    return;
  }
  if (
    body.store !== false ||
    !Array.isArray(body.tools) ||
    body.tools.some((tool) => tool.strict !== true)
  ) {
    response_.writeHead(400, { "content-type": "application/json" }).end(
      JSON.stringify({
        error: {
          message: "The stub expects store=false and strict tools",
          type: "invalid_request_error",
        },
      }),
    );
    return;
  }

  const outputs = input
    .filter((item) => item.type === "function_call_output")
    .map((item) => {
      try {
        return JSON.parse(item.output);
      } catch {
        return { ok: false, error: "unparseable" };
      }
    });
  const lastItem = input[input.length - 1];
  const followUps =
    lastItem?.type === "function_call_output" && body.tool_choice !== "none"
      ? followUp(text, outputs)
      : [];
  const output =
    followUps.length > 0
      ? followUps
      : lastItem?.type === "function_call_output" || body.tool_choice === "none"
        ? [message(reply(text, outputs))]
        : (() => {
            const calls = plan(text, body.instructions);
            return calls.length > 0 ? calls : [message(reply(text, outputs))];
          })();

  response_
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify(response(body.model, output)));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`OpenAI stub listening on http://127.0.0.1:${PORT}`);
});
