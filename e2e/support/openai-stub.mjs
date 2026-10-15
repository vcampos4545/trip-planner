/**
 * A tiny local stand-in for the OpenAI Responses API, used only by the Playwright suite.
 *
 * The app under test uses its real OpenAI provider; the suite points OPENAI_BASE_URL here so tool
 * calling, validation, persistence, and error handling run end to end without a real key. Replies
 * are chosen from the latest user message, so tests are deterministic.
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
  "tripStyle",
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
  const users = (input ?? []).filter((item) => item.role === "user");
  const last = users[users.length - 1];
  if (!last) return "";
  return typeof last.content === "string"
    ? last.content
    : JSON.stringify(last.content);
}

/** Picks tool calls for a fresh user message. */
function plan(text, instructions) {
  const lower = text.toLowerCase();
  const known = knownDetails(instructions);
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

/** Writes the reply after tool results came back. */
function reply(text, outputs) {
  const lower = text.toLowerCase();
  const failed = outputs.filter((output) => output.ok === false);
  if (lower.includes("lisbon")) {
    return "Lisbon in late May with four of you sounds great. I saved that to the trip. Where will everyone be flying from?";
  }
  if (lower.includes("activity")) {
    return "I added two ideas for your second day as suggestions. Accept the ones you like on the Itinerary tab.";
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
  const output =
    lastItem?.type === "function_call_output" || body.tool_choice === "none"
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
