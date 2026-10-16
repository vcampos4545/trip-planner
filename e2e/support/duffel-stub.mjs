/**
 * A tiny local stand-in for Duffel's API in test mode, used only by the Playwright suite.
 *
 * The app under test uses its real Duffel provider; the suite points DUFFEL_API_URL here so the
 * request, response mapping, labelling, and error handling run end to end without calling Duffel.
 * A destination of "ERR" simulates an outage.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.DUFFEL_STUB_PORT ?? 3318);

const PLACES = {
  "new york": { type: "city", iata_code: "NYC", name: "New York" },
  lisbon: { type: "city", iata_code: "LIS", name: "Lisbon" },
};

function airport(code) {
  return { iata_code: code, name: `${code} Airport`, city_name: code };
}

function slice(from, to, date, departHour, durationHours) {
  const arriveHour = departHour + durationHours;
  const pad = (value) => String(value).padStart(2, "0");
  return {
    id: `sli_${from}_${to}`,
    duration: `PT${durationHours}H`,
    segments: [
      {
        id: `seg_${from}_${to}`,
        departing_at: `${date}T${pad(departHour)}:00:00`,
        arriving_at: `${date}T${pad(arriveHour)}:30:00`,
        origin: airport(from),
        destination: airport(to),
        marketing_carrier: { name: "Duffel Airways", iata_code: "ZZ" },
        operating_carrier: { name: "Duffel Airways", iata_code: "ZZ" },
        marketing_carrier_flight_number: String(departHour * 10),
        stops: [],
      },
    ],
  };
}

function offers(request) {
  const travelers = request.passengers.length;
  return [
    { id: "off_e2e_cheap", base: 432.1, hour: 8 },
    { id: "off_e2e_late", base: 515, hour: 13 },
  ].map(({ id, base, hour }) => ({
    id,
    live_mode: false,
    total_amount: (base * travelers).toFixed(2),
    total_currency: "USD",
    expires_at: "2099-01-01T00:00:00Z",
    owner: { name: "Duffel Airways", iata_code: "ZZ" },
    slices: request.slices.map((item, index) =>
      slice(
        item.origin,
        item.destination,
        item.departure_date,
        hour + index,
        7,
      ),
    ),
  }));
}

function send(response, status, body) {
  response
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify(body));
}

function error(response, status, type, message) {
  send(response, status, {
    errors: [{ type, title: type, message, code: type }],
    meta: { status, request_id: "stub" },
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200).end("ok");
    return;
  }
  if (!request.headers.authorization?.startsWith("Bearer duffel_test_")) {
    error(response, 401, "authentication_error", "Missing test token");
    return;
  }
  if (request.headers["duffel-version"] !== "v2") {
    error(response, 400, "invalid_request_error", "Bad Duffel-Version");
    return;
  }
  if (request.method === "GET" && url.pathname === "/places/suggestions") {
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    const place = PLACES[query];
    send(response, 200, { data: place ? [place] : [] });
    return;
  }
  if (request.method === "POST" && url.pathname === "/air/offer_requests") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")).data;
    if (body.slices.some((item) => item.destination === "ERR")) {
      error(response, 500, "api_error", "Simulated outage");
      return;
    }
    send(response, 201, {
      data: {
        id: "orq_e2e",
        live_mode: false,
        slices: body.slices,
        passengers: body.passengers,
        offers: offers(body),
      },
    });
    return;
  }
  error(response, 404, "invalid_request_error", "Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Duffel stub listening on ${PORT}`);
});
