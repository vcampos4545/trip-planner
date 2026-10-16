import { createTripManually, expect, test } from "./support/fixtures";

test("without an AI key the app still works and says Atlas needs configuration", async ({
  signIn,
}) => {
  const { page } = await signIn("Noa Nokey");
  await page.goto("/trips/new");
  await expect(page.getByTestId("ai-not-configured")).toContainText(
    "Atlas needs configuration",
  );

  await page.getByRole("button", { name: /I have a vibe in mind/ }).click();
  await expect(page).toHaveURL(/\/trips\/new\/[^/]+$/);
  await expect(page.getByTestId("ai-not-configured")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();

  const tripId = await createTripManually(page, {
    title: "Offline-friendly trip",
    destination: "Kyoto",
  });
  await page.getByRole("button", { name: "Ask Atlas", exact: true }).click();
  await expect(page.getByTestId("ai-not-configured")).toBeVisible();
  await page.getByRole("button", { name: "Where Atlas works from" }).click();
  await expect(page.getByText("Live search off")).toBeVisible();
  await expect(page.getByTestId("flight-search-status")).toContainText(
    "Flight search not configured",
  );

  // Without a SerpApi key the flight panel says so instead of showing a search.
  await page.goto(`/trips/${tripId}/bookings`);
  await expect(page.getByTestId("flights-not-configured")).toContainText(
    "Flight search is not configured",
  );
  await expect(page.getByTestId("flights-not-configured")).toContainText(
    "SERPAPI_API_KEY is not set on the server.",
  );
  await expect(
    page.getByRole("button", { name: "Search flights" }),
  ).toHaveCount(0);
});
