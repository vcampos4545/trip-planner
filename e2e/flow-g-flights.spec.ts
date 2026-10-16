import { createTripManually, expect, prisma, test } from "./support/fixtures";

function daysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("Flow G: flight search shows labelled Duffel test data, saves with provenance, and never books", async ({
  signIn,
}) => {
  const { page } = await signIn("Felix Flyer");
  const startDate = daysFromNow(60);
  const endDate = daysFromNow(67);
  const tripId = await createTripManually(page, {
    title: "Flight hunt",
    destination: "Lisbon",
    startDate,
    endDate,
  });

  // 1. The panel sits in Bookings > Flights and is prefilled from the trip. Options points to it.
  await page.goto(`/trips/${tripId}/options`);
  await expect(page.getByTestId("flight-search-panel")).toHaveCount(0);
  await page.getByRole("link", { name: "Search flights in Bookings" }).click();
  await page.waitForURL(/\/bookings#flights$/);
  const panel = page.getByTestId("flight-search-panel");
  await expect(panel).toContainText("Test data");
  await expect(panel.getByLabel("To", { exact: true })).toHaveValue("Lisbon");
  await expect(panel.getByLabel("Depart")).toHaveValue(startDate);
  await expect(panel.getByLabel("Return")).toHaveValue(endDate);
  await expect(panel.getByLabel("Travelers")).toHaveValue("1");

  // 2. Search: city names resolve to codes and every result is labelled as test data.
  await panel.getByLabel("From", { exact: true }).fill("New York");
  await panel.getByLabel("Travelers").fill("2");
  await panel.getByRole("button", { name: "Search flights" }).click();
  await expect(panel.getByTestId("flight-test-notice")).toContainText(
    "Duffel test data: not real fares or availability",
  );
  await expect(panel.getByTestId("flight-results")).toContainText(
    'Searched "New York" as NYC and "Lisbon" as LIS',
  );
  const results = panel.getByTestId("flight-result");
  await expect(results).toHaveCount(2);
  for (const result of await results.all()) {
    await expect(result).toContainText("Test data, not a real fare");
    await expect(result).toContainText("Duffel (test data), retrieved");
  }
  const cheapest = results.first();
  await expect(cheapest).toContainText("Duffel Airways");
  await expect(cheapest.getByTestId("flight-price")).toHaveText("$864.20");
  await expect(cheapest).toContainText("USD round-trip total, 2 travelers");
  await expect(cheapest).toContainText("Nonstop");
  await expect(cheapest).toContainText("Outbound");
  await expect(cheapest).toContainText("Return");
  await expect(
    panel.getByRole("link", { name: /Compare this route on Google Flights/ }),
  ).toHaveAttribute("href", /google\.com\/travel\/flights/);

  // 3. Save one to options only; it keeps its source, price, and retrieval time.
  await cheapest.getByRole("button", { name: "Save to options only" }).click();
  await expect(
    page.getByText("Saved to options for the group to review."),
  ).toBeVisible();

  // 4. Save the other as considering: a booking record, not a booking.
  await results
    .nth(1)
    .getByRole("button", { name: "Save as considering" })
    .click();
  await expect(page.getByText(/You're marked as considering it/)).toBeVisible();
  const bookings = await prisma.booking.findMany({
    where: { tripId },
    include: { participants: true },
  });
  expect(bookings).toHaveLength(1);
  expect(bookings[0]).toMatchObject({ category: "FLIGHT", status: "PLANNED" });
  expect(bookings[0]!.participants).toEqual([
    expect.objectContaining({ status: "CONSIDERING" }),
  ]);
  await page.goto(`/trips/${tripId}/bookings`);
  const booking = page.getByTestId("booking-card").first();
  await expect(booking).toContainText("Not booked yet");
  await expect(booking).toContainText("considering");

  await page.goto(`/trips/${tripId}/options`);
  const card = page
    .getByTestId("option-card")
    .filter({ hasText: "Duffel Airways" })
    .filter({ hasText: "$864.20" });
  await expect(card).toContainText("Suggested");
  await expect(card).toContainText(
    "Duffel test data: not real fares or availability",
  );
  await expect(card).toContainText("retrieved");
  await expect(
    card.getByRole("link", { name: /Duffel \(test data\)/ }),
  ).toBeVisible();

  // 5. A provider error shows a useful message and changes nothing.
  const before = await Promise.all([
    prisma.researchOption.count({ where: { tripId } }),
    prisma.booking.count({ where: { tripId } }),
    prisma.activityLog.count({ where: { tripId } }),
  ]);
  await page.goto(`/trips/${tripId}/bookings`);
  await panel.getByLabel("From", { exact: true }).fill("JFK");
  await panel.getByLabel("To", { exact: true }).fill("ERR");
  await panel.getByRole("button", { name: "Search flights" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Duffel is having trouble right now",
  );
  await expect(panel.getByTestId("flight-result")).toHaveCount(0);
  const after = await Promise.all([
    prisma.researchOption.count({ where: { tripId } }),
    prisma.booking.count({ where: { tripId } }),
    prisma.activityLog.count({ where: { tripId } }),
  ]);
  expect(after).toEqual(before);

  // 6. Atlas uses the same search, answers from its results, and labels them as test data.
  await page.getByRole("button", { name: "Ask Atlas", exact: true }).click();
  await page.getByRole("button", { name: "Where Atlas works from" }).click();
  await expect(page.getByTestId("flight-search-status")).toContainText(
    "Flight search: Duffel (test data)",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Can you find flights from JFK for the start of the trip?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText(
      "The cheapest flight I found is Duffel Airways at 432.10 USD total for 1.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Note: these flight results are Duffel test data, not real flights, fares, or availability.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/Searched Duffel \(test data\) for flights JFK to LIS/),
  ).toBeVisible();
});
