import { createTripManually, expect, prisma, test } from "./support/fixtures";

const STUB_STATS = "http://127.0.0.1:3317/stats";

function daysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function hotelSearches(): Promise<number> {
  const response = await fetch(STUB_STATS);
  return ((await response.json()) as { google_hotels: number }).google_hotels;
}

test("Flow K: stays from Google Hotels via SerpApi are labelled, cached, saved as considering, and never booked", async ({
  signIn,
}) => {
  const { page } = await signIn("Stella Stays");
  const checkIn = daysFromNow(90);
  const checkOut = daysFromNow(92);
  const tripId = await createTripManually(page, {
    title: "Park City weekend",
    destination: "Park City",
    startDate: checkIn,
    endDate: checkOut,
  });
  const start = await hotelSearches();
  const counts = () =>
    Promise.all([
      prisma.researchOption.count({ where: { tripId } }),
      prisma.booking.count({ where: { tripId } }),
      prisma.activityLog.count({ where: { tripId } }),
    ]);

  // 1. The panel sits in Bookings > Accommodations, names its source, and is prefilled.
  await page.goto(`/trips/${tripId}/options`);
  await page.getByRole("link", { name: "search stays" }).click();
  await page.waitForURL(/\/bookings#stays$/);
  const panel = page.getByTestId("stay-search-panel");
  await expect(panel).toContainText("Results from Google Hotels via SerpApi");
  await expect(panel.getByLabel("Where")).toHaveValue("Park City");
  await expect(panel.getByLabel("Check-in")).toHaveValue(checkIn);
  await expect(panel.getByLabel("Check-out")).toHaveValue(checkOut);
  await expect(panel.getByLabel("Bedrooms")).toBeDisabled();

  // 2. A hotel search: Google's nightly and total prices, sources, and retrieval time.
  await panel.getByLabel("Guests").fill("4");
  await panel.getByRole("button", { name: "Search stays" }).click();
  const results = panel.getByTestId("stay-results");
  await expect(results).toContainText(
    "2 results from Google Hotels via SerpApi",
  );
  await expect(results).toContainText("include taxes and fees");
  await expect(results).toContainText("has no room filter");
  await expect(panel.getByTestId("stay-cached-notice")).toHaveCount(0);
  const cards = panel.getByTestId("stay-result");
  await expect(cards).toHaveCount(2);
  const lodge = cards.filter({ hasText: "Stub Summit Lodge" });
  await expect(lodge.getByTestId("stay-nightly")).toContainText("$412");
  await expect(lodge.getByTestId("stay-total")).toHaveText(
    "$824 USD total, 2 nights",
  );
  await expect(lodge).toContainText("4-star");
  await expect(lodge).toContainText("Prices from Booking.com, Expedia");
  await expect(lodge).toContainText("Google Hotels via SerpApi, retrieved");
  await expect(
    lodge.getByRole("link", { name: /Find on Google Hotels to book/ }),
  ).toHaveAttribute("href", /^https:\/\/www\.google\.com\/travel\/search\?q=/);
  await expect(
    lodge.getByRole("link", { name: /Property website/ }),
  ).toHaveAttribute("href", "https://www.summitlodge.stub.example/");
  await expect(cards.filter({ hasText: "Stub Main Street Inn" })).toContainText(
    "Sponsored",
  );
  await expect(panel).not.toContainText("Stub Sold Out Hotel");
  expect((await hotelSearches()) - start).toBe(1);

  // 3. The same search again reuses the saved results instead of spending another search.
  await panel.getByRole("button", { name: "Search stays" }).click();
  await expect(panel.getByTestId("stay-cached-notice")).toContainText(
    "Prices were not refreshed",
  );
  expect((await hotelSearches()) - start).toBe(1);

  // 4. Saving as considering adds an Accommodations record with the traveler considering it.
  await lodge.getByRole("button", { name: "Save as considering" }).click();
  await expect(
    lodge.getByRole("button", { name: "Saved as considering" }),
  ).toBeDisabled();
  const section = page.getByTestId("bookings-section-accommodation");
  const card = section
    .getByTestId("booking-card")
    .filter({ hasText: "Stub Summit Lodge" });
  await expect(card).toContainText("Not booked yet");
  await expect(card.getByTestId("booking-travelers")).toContainText(
    /Stella Stays\s*\(considering\)/,
  );
  await expect(card.getByTestId("booking-cost")).toHaveText("$824");
  const saved = await prisma.booking.findFirstOrThrow({
    where: { tripId, title: "Stub Summit Lodge" },
    include: { researchOption: true },
  });
  expect(saved.status).toBe("PLANNED");
  expect(saved.researchOption).toMatchObject({
    sourceName: "Google Hotels via SerpApi",
    latitude: 40.6514,
    longitude: -111.5079,
  });
  expect(saved.researchOption?.retrievedAt).not.toBeNull();

  // 5. Vacation rentals can be filtered on bedrooms.
  await panel.getByLabel("Type").selectOption("vacation_rental");
  await panel.getByLabel("Bedrooms").fill("4");
  await panel.getByRole("button", { name: "Search stays" }).click();
  await expect(results).toContainText("Vacation rentals in Park City");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Stub Old Town Chalet");
  await expect(cards.first()).toContainText("4 bedrooms");
  expect((await hotelSearches()) - start).toBe(2);

  // 6. An exhausted quota is explained and changes nothing.
  const before = await counts();
  await panel.getByLabel("Where").fill("Quota Town");
  await panel.getByRole("button", { name: "Search stays" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "used all of its searches",
  );
  await expect(panel.getByRole("alert")).toContainText(
    "Nothing in the trip was changed.",
  );
  await expect(cards).toHaveCount(0);
  await panel.getByLabel("Where").fill("Outage Town");
  await panel.getByRole("button", { name: "Search stays" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "SerpApi is having trouble",
  );
  expect(await counts()).toEqual(before);

  // 7. A place from Airbnb is added from its link: the site is named, the page never opened.
  await panel.getByRole("button", { name: "Add from link" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a stay from a link" });
  await dialog
    .getByLabel("Listing link")
    .fill("https://www.airbnb.com/rooms/53917725");
  await dialog.getByLabel("Name").click();
  await expect(dialog.getByTestId("stay-link-site")).toContainText(
    "Recognized airbnb.com.",
  );
  await dialog.getByLabel("Name").fill("Cabin near Main Street");
  await dialog.getByPlaceholder("1450").fill("350");
  await dialog.getByLabel("Price is").selectOption("night");
  await dialog.getByRole("button", { name: "Add stay" }).click();
  await expect(dialog).toBeHidden();
  const cabin = section
    .getByTestId("booking-card")
    .filter({ hasText: "Cabin near Main Street" });
  await expect(cabin).toContainText("Airbnb");
  await expect(cabin).toContainText("Not booked yet");
  await expect(cabin.getByTestId("booking-cost")).toHaveText("$700");
  await expect(cabin).toContainText(
    "the app did not open or check the listing",
  );
});

test("Flow K2: Atlas finds a 4-bedroom place near Park City from the search results only and saves one", async ({
  signIn,
}) => {
  const { page } = await signIn("Atlas Stays");
  const tripId = await createTripManually(page, {
    title: "Ski house",
    destination: "Park City",
  });
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: "Ask Atlas", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Atlas" });
  await panel.getByRole("button", { name: "Where Atlas works from" }).click();
  await expect(page.getByTestId("stay-search-status")).toContainText(
    "Stay search: Google Hotels via SerpApi",
  );
  await page.keyboard.press("Escape");

  const say = async (text: string, reply: string | RegExp) => {
    await panel.getByRole("textbox", { name: "Message" }).fill(text);
    await panel.getByRole("button", { name: "Send message" }).click();
    await expect(panel.getByText(reply)).toBeVisible();
  };
  await say(
    "find a 4-bedroom place near Park City for March 5-7",
    /On Google Hotels via SerpApi \(retrieved .+\) I found Stub Old Town Chalet at .+ a night, .+ total for 2 nights\. Prices can change before booking\./,
  );
  expect(await prisma.booking.count({ where: { tripId } })).toBe(0);

  await say(
    "save the first stay",
    "Saved it to Accommodations with you as considering (CONSIDERING (not booked)). Nothing is booked.",
  );
  const booking = await prisma.booking.findFirstOrThrow({
    where: { tripId },
    include: { participants: true, researchOption: true },
  });
  expect(booking).toMatchObject({
    category: "ACCOMMODATION",
    title: "Stub Old Town Chalet",
    status: "PLANNED",
  });
  expect(booking.participants.map((p) => p.status)).toEqual(["CONSIDERING"]);
  expect(booking.researchOption?.latitude).toBe(40.6461);
});
