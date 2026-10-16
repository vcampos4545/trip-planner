import { createTripManually, expect, prisma, test } from "./support/fixtures";

const STUB_STATS = "http://127.0.0.1:3317/stats";

function daysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function flightSearches(): Promise<number> {
  const response = await fetch(STUB_STATS);
  return ((await response.json()) as { google_flights: number }).google_flights;
}

test("Flow J: From and To take what the placeholders advertise, a trip's own wording, and ask about ambiguous cities", async ({
  signIn,
}) => {
  const { page } = await signIn("Pat Places");
  const tripId = await createTripManually(page, {
    title: "Place names",
    destination: "Lisbon",
    startDate: daysFromNow(50),
  });
  // The trip says where people leave from in its own words.
  await prisma.trip.update({
    where: { id: tripId },
    data: { departureLocation: "New York City (Vaughn)" },
  });

  await page.goto(`/trips/${tripId}/bookings`);
  const panel = page.getByTestId("flight-search-panel");
  const from = panel.getByLabel("From", { exact: true });
  const to = panel.getByLabel("To", { exact: true });
  const search = panel.getByRole("button", { name: "Search flights" });
  const results = panel.getByTestId("flight-results");
  await expect(from).toHaveAttribute("placeholder", "New York or JFK");
  await expect(to).toHaveAttribute("placeholder", "Lisbon or LIS");

  // 1. The prefilled values search as they are.
  await expect(from).toHaveValue("New York City (Vaughn)");
  await expect(to).toHaveValue("Lisbon");
  await search.click();
  await expect(results).toContainText(
    'Searched "New York City (Vaughn)" as JFK, LGA and "Lisbon" as LIS.',
  );

  // 2. Every form the placeholders advertise: city names and airport codes, in any case.
  // Each expected line differs from the one before, so a stale result never passes.
  const forms: [string, string, string | null][] = [
    [
      "New York",
      "Lisbon",
      'Searched "New York" as JFK, LGA and "Lisbon" as LIS.',
    ],
    // Codes need no lookup, so there is nothing to explain.
    ["JFK", "LIS", null],
    ["New York", "LIS", 'Searched "New York" as JFK, LGA.'],
    ["jfk", "Lisbon", 'Searched "Lisbon" as LIS.'],
    ["New York or JFK", "Lisbon or LIS", '"Lisbon or LIS" as LIS.'],
  ];
  for (const [origin, destination, text] of forms) {
    await from.fill(origin);
    await to.fill(destination);
    await search.click();
    if (text) await expect(results).toContainText(text);
    else await expect(results).not.toContainText("Searched");
    await expect(results.getByTestId("flight-result").first()).toBeVisible();
  }

  // 3. A city that could be two places asks which one, under the field, without searching.
  const before = await flightSearches();
  await from.fill("JFK");
  await to.fill("Portland");
  await search.click();
  await expect(
    panel.getByText(
      '"Portland" could be Portland, Oregon (PDX) or Portland, Maine (PWM). Pick one.',
    ),
  ).toBeVisible();
  await expect(results).toHaveCount(0);
  expect(await flightSearches()).toBe(before);
  const choices = panel.getByRole("group", { name: "Places that match To" });
  await expect(choices.getByRole("button")).toHaveText([
    "Portland, Oregon (PDX)",
    "Portland, Maine (PWM)",
  ]);

  // Picking one fills it in and searches.
  await choices.getByRole("button", { name: "Portland, Oregon (PDX)" }).click();
  await expect(to).toHaveValue("Portland, Oregon");
  await expect(results).toContainText('"Portland, Oregon" as PDX.');
  await expect(choices).toHaveCount(0);
  expect(await flightSearches()).toBe(before + 1);

  // 4. A place nothing matches is named under its field.
  await to.fill("Atlantis");
  await search.click();
  await expect(
    panel.getByText(
      'No airport or city matches "Atlantis". Try a city name or a 3-letter airport code.',
    ),
  ).toBeVisible();
  await expect(to).toHaveAttribute("aria-invalid", "true");
  await expect(results).toHaveCount(0);
});
