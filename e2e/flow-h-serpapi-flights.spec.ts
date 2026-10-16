import { createTripManually, expect, prisma, test } from "./support/fixtures";

const STUB_STATS = "http://127.0.0.1:3317/stats";

function daysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function stubSearches(): Promise<{
  google_flights: number;
  google_flights_autocomplete: number;
}> {
  const response = await fetch(STUB_STATS);
  return response.json();
}

test("Flow H: Google Flights via SerpApi is labelled, cached, loads returns on request, and never books", async ({
  signIn,
}) => {
  const { page } = await signIn("Gina Google");
  const startDate = daysFromNow(60);
  const endDate = daysFromNow(67);
  const tripId = await createTripManually(page, {
    title: "Google flight hunt",
    destination: "Lisbon",
    startDate,
    endDate,
  });
  const start = await stubSearches();

  // 1. The panel names the real source and is not labelled as test data.
  await page.goto(`/trips/${tripId}/options`);
  const panel = page.getByTestId("flight-search-panel");
  await expect(panel).toContainText("Results from Google Flights via SerpApi");
  await expect(panel).not.toContainText("Test data");

  // 2. A round-trip search: city names resolve to their airports, prices are Google's totals.
  await panel.getByLabel("From", { exact: true }).fill("New York");
  await panel.getByLabel("Travelers").fill("2");
  await panel.getByRole("button", { name: "Search flights" }).click();
  const results = panel.getByTestId("flight-results");
  await expect(results).toContainText(
    'Searched "New York" as JFK, LGA and "Lisbon" as LIS',
  );
  await expect(results).toContainText("from Google Flights via SerpApi");
  await expect(panel.getByTestId("flight-test-notice")).toHaveCount(0);
  await expect(panel.getByTestId("flight-cached-notice")).toHaveCount(0);
  await expect(panel.getByTestId("flight-price-insights")).toContainText(
    "Price insight from Google Flights: prices are low right now, usually $1,400 to $1,800, lowest here $1,200.",
  );
  const outbound = results.locator(":scope > ul > li");
  await expect(outbound).toHaveCount(2);
  for (const result of await outbound.all()) {
    await expect(result).toContainText("Google Flights via SerpApi, retrieved");
    await expect(result).not.toContainText("Test data");
    await expect(result.getByTestId("flight-pending-return")).toContainText(
      "Return flight not chosen yet. The price is the round-trip total.",
    );
    await expect(
      result.getByRole("link", { name: /View on Google Flights to book/ }),
    ).toHaveAttribute("href", /^https:\/\/www\.google\.com\/travel\/flights/);
  }
  const cheapest = outbound.first();
  await expect(cheapest.getByTestId("flight-price").first()).toHaveText(
    "$1,200",
  );
  await expect(cheapest).toContainText("USD round-trip total, 2 travelers");
  await expect(cheapest).toContainText("Stub Air");
  await expect(cheapest).toContainText("ZZ80");
  await expect(
    panel.getByRole("link", {
      name: /Open this search on Google Flights to book/,
    }),
  ).toHaveAttribute("href", /^https:\/\/www\.google\.com\/travel\/flights/);
  // Two place lookups and one flight search; return legs were not fetched.
  let now = await stubSearches();
  expect(now.google_flights - start.google_flights).toBe(1);
  expect(
    now.google_flights_autocomplete - start.google_flights_autocomplete,
  ).toBe(2);

  // 3. The same search again is answered from the cache and says so.
  await panel.getByRole("button", { name: "Search flights" }).click();
  await expect(panel.getByTestId("flight-cached-notice")).toContainText(
    "Reused the same search from",
  );
  now = await stubSearches();
  expect(now.google_flights - start.google_flights).toBe(1);
  expect(
    now.google_flights_autocomplete - start.google_flights_autocomplete,
  ).toBe(2);

  // 4. Return options load only when asked, for that outbound flight.
  await cheapest.getByRole("button", { name: "Show return flights" }).click();
  const returns = cheapest.getByTestId("return-flights");
  await expect(returns).toContainText(
    "2 return options with this outbound flight from Google Flights via SerpApi",
  );
  now = await stubSearches();
  expect(now.google_flights - start.google_flights).toBe(2);
  const roundTrip = returns.getByTestId("flight-result").first();
  await expect(roundTrip.getByTestId("flight-price")).toHaveText("$1,220");
  await expect(roundTrip).toContainText("Outbound");
  await expect(roundTrip).toContainText("Return");
  await expect(roundTrip).toContainText("ZZ203");
  await expect(roundTrip.getByTestId("flight-pending-return")).toHaveCount(0);

  // 5. Saving keeps the source, price, link, and retrieval time; nothing is booked.
  await roundTrip.getByRole("button", { name: "Save to options" }).click();
  await expect(
    page.getByText("Saved to options for the group to review."),
  ).toBeVisible();
  const card = page.getByTestId("option-card").filter({ hasText: "Stub Air" });
  await expect(card).toContainText("Suggested");
  await expect(card).toContainText("$1,220");
  await expect(card).toContainText("retrieved");
  await expect(card).not.toContainText("test data");
  await expect(
    card.getByRole("link", { name: /Google Flights via SerpApi/ }),
  ).toHaveAttribute("href", /^https:\/\/www\.google\.com\/travel\/flights/);
  const option = await prisma.researchOption.findFirstOrThrow({
    where: { tripId, category: "FLIGHT" },
  });
  expect(option.providerPayload).toMatchObject({
    provider: "serpapi",
    testMode: false,
    returnChosen: true,
  });
  expect(await prisma.booking.count({ where: { tripId } })).toBe(0);

  // 6. An exhausted quota or an outage shows a clear message and changes nothing.
  const counts = () =>
    Promise.all([
      prisma.researchOption.count({ where: { tripId } }),
      prisma.booking.count({ where: { tripId } }),
      prisma.activityLog.count({ where: { tripId } }),
    ]);
  const before = await counts();
  await page.goto(`/trips/${tripId}/options`);
  await panel.getByLabel("From", { exact: true }).fill("JFK");
  await panel.getByLabel("To", { exact: true }).fill("QQQ");
  await panel.getByRole("button", { name: "Search flights" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "used all of its flight searches",
  );
  await expect(panel.getByRole("alert")).toContainText(
    "Nothing in the trip was changed.",
  );
  await expect(panel.getByTestId("flight-result")).toHaveCount(0);
  await panel.getByLabel("To", { exact: true }).fill("ERR");
  await panel.getByRole("button", { name: "Search flights" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "SerpApi is having trouble right now",
  );
  expect(await counts()).toEqual(before);

  // 7. Atlas uses the same provider and names it, with no test-data label.
  await page.goto(`/trips/${tripId}/plan`);
  await expect(page.getByTestId("flight-search-status")).toContainText(
    "Flight search: Google Flights via SerpApi",
  );
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Can you find flights from JFK for the start of the trip?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText(
      "The cheapest flight I found is Stub Air at 432.00 USD total for 1.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Searched Google Flights via SerpApi for flights JFK to LIS/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/Duffel test data/)).toHaveCount(0);
});
