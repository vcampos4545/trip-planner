import { expect, prisma, test } from "./support/fixtures";

/**
 * Replays the "Park City trip" feedback through the Atlas stub: a ski trip to Jackson Hole and
 * Park City, flying in and out of Salt Lake City, with a friend driving between stops and two
 * flights bought after searches. Runs against the SerpApi stub, which returns Southwest and Delta
 * out of LaGuardia and two American flights home.
 */
test("Flow I: the Park City trip puts bought flights in Bookings and on the week view", async ({
  signIn,
}) => {
  const { page } = await signIn("Vaughn Park");

  // 1. Describe a multi-stop trip. Atlas records the stops and airports, and asks about skiing
  //    because the dates and places only imply it.
  await page.goto("/trips/new");
  await page.getByRole("button", { name: /I know where I want to go/ }).click();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill(
      "We're going to Jackson Hole and then Park City from Feb 27 to Mar 7, 2027, flying from NYC into and out of Salt Lake City.",
    );
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(/\/trips\/(?!new)[^/?]+\?atlas=open$/);
  const tripId = new URL(page.url()).pathname.split("/")[2]!;
  const panel = page.getByRole("dialog", { name: "Atlas" });
  await expect(
    panel.getByText(
      "Got it: Jackson Hole, then Park City, flying in and out of Salt Lake City. Is this a ski trip?",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("trip-title")).toHaveText("Park City trip");
  await expect(page.getByTestId("trip-route")).toHaveText(
    "Jackson Hole → Park City",
  );
  await expect(page.getByTestId("trip-airports")).toHaveText(
    "In and out of SLC",
  );

  // The panel keeps the "Try asking" suggestions and hides the sources behind an info button.
  await expect(panel.getByTestId("atlas-try-asking")).toBeVisible();
  await panel.getByRole("button", { name: "Where Atlas works from" }).click();
  await expect(page.getByTestId("atlas-sources-info")).toContainText(
    "Jackson Hole, then Park City",
  );
  await expect(page.getByTestId("flight-search-status")).toContainText(
    "Flight search: Google Flights via SerpApi",
  );
  await page.keyboard.press("Escape");

  const say = async (text: string, reply: string | RegExp) => {
    await panel.getByRole("textbox", { name: "Message" }).fill(text);
    await panel.getByRole("button", { name: "Send message" }).click();
    await expect(panel.getByText(reply)).toBeVisible();
  };

  // 2. Yes, it's a ski trip: Atlas proposes a better title, which this only member accepts in
  //    the chat, and suggests ski tasks.
  await say("Yes, we're skiing!", /A ski trip it is/);
  const rename = panel
    .getByRole("listitem")
    .filter({ hasText: "Needs your OK: trip name: Park City trip" });
  await expect(rename).toContainText("Out West ski trip");
  await expect(
    panel.getByText("Suggested task: Reserve ski or snowboard rentals"),
  ).toBeVisible();
  await expect(
    panel.getByText("Suggested task: Buy lift passes"),
  ).toBeVisible();
  await rename.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByTestId("trip-title")).toHaveText("Out West ski trip");

  // 3. A friend drives between stops: ground transport with the traveler on it.
  await say(
    "My friend is driving me from Salt Lake City to Jackson Hole on Feb 27 and from Jackson Hole to Park City on Mar 2.",
    "I added 2 rides with your friend to Bookings. You can edit or undo them below.",
  );
  await expect(panel.getByTestId("atlas-recorded-booking")).toHaveCount(2);

  // 4. Search, then say which flight was bought in a later message.
  await say(
    "Find flights from LGA to SLC on Feb 27",
    /On Google Flights via SerpApi I found Southwest at 189.00 USD/,
  );
  await say(
    "I bought the Southwest flight",
    /Recorded Southwest WN1234: LGA to SLC in Bookings as booked for Vaughn/,
  );
  const southwest = panel
    .getByTestId("atlas-recorded-booking")
    .filter({ hasText: "Southwest WN1234" });
  await expect(southwest.getByRole("link", { name: "Edit" })).toBeVisible();
  await expect(southwest.getByRole("button", { name: "Undo" })).toBeVisible();

  // 5. Two American flights were shown, so Atlas asks which one.
  await say(
    "Find flights home from SLC to JFK on Mar 7",
    /I found American at 198.00 USD/,
  );
  await say("I bought the American flight", /Which one did you buy\?/);
  await say(
    "I bought the American flight that lands at 2:59pm",
    /Recorded American AA2210: SLC to JFK in Bookings/,
  );

  // Nothing on this one-member trip waits for a group.
  await expect(
    page.getByText(/group confirmation|waiting for the group/i),
  ).toHaveCount(0);

  // The Edit link opens the booking for editing.
  await southwest.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/bookings\?edit=/);
  const editDialog = page.getByRole("dialog", { name: "Edit booking" });
  await expect(editDialog.getByLabel("Title")).toHaveValue(
    "Southwest WN1234: LGA to SLC",
  );
  await editDialog.getByRole("button", { name: "Cancel" }).click();

  // 6. Bookings > Flights shows both flights as booked; the rides are ground transport.
  await page.goto(`/trips/${tripId}/bookings`);
  const flights = page.getByTestId("bookings-section-flight");
  await expect(flights.getByTestId("flight-search-panel")).toBeVisible();
  const flightCards = flights.getByTestId("booking-card");
  await expect(flightCards).toHaveCount(2);
  for (const card of await flightCards.all()) {
    await expect(card).toContainText("Booked");
    await expect(card.getByTestId("booking-travelers")).toContainText(
      "Vaughn Park",
    );
    await expect(card.getByTestId("booking-travelers")).not.toContainText(
      "considering",
    );
  }
  await expect(flightCards.first()).toContainText("New York (LGA)");
  await expect(flightCards.first()).toContainText("Salt Lake City (SLC)");
  await expect(
    page
      .getByTestId("bookings-section-ground_transport")
      .getByTestId("booking-card"),
  ).toHaveCount(2);

  // 7. The week view shows when the traveler arrives and leaves, plus the rides.
  await page.goto(`/trips/${tripId}/itinerary`);
  const week = page.getByTestId("week-view");
  await expect(page.getByTestId("traveler-flights")).toContainText(
    "Vaughn Park",
  );
  await expect(page.getByTestId("traveler-flights")).toContainText(
    "Sat, Feb 27, 6 AM · New York (LGA) → Salt Lake City (SLC) · Booked",
  );
  await expect(page.getByTestId("traveler-flights")).toContainText(
    "Sun, Mar 7, 7:05 AM · Salt Lake City (SLC) → New York (JFK) · Booked",
  );
  const outbound = week
    .getByTestId("calendar-item")
    .filter({ hasText: "Southwest WN1234" });
  await expect(outbound).toHaveAttribute("data-status", "booked");
  await expect(outbound).toContainText("Vaughn · Booked");
  const rides = week.locator(
    '[data-testid="calendar-item"][data-kind="ground"]',
  );
  await expect(rides).toHaveCount(2);
  await expect(week.getByTestId("week-day").first()).toContainText(
    "Jackson Hole",
  );

  await page.getByRole("button", { name: "Later days" }).click();
  const home = week
    .getByTestId("calendar-item")
    .filter({ hasText: "American AA2210" });
  await expect(home).toHaveAttribute("data-status", "booked");
  await home.click();
  await expect(page.getByTestId("calendar-item-details")).toContainText(
    "Sun, Mar 7, 7:05 AM to 2:59 PM (local time)",
  );

  // 8. On a phone the calendar starts with three days.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: "3 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("week-day")).toHaveCount(3);

  const bookings = await prisma.booking.findMany({
    where: { tripId },
    include: { participants: true },
  });
  expect(bookings.filter((booking) => booking.category === "FLIGHT")).toEqual([
    expect.objectContaining({ status: "BOOKED" }),
    expect.objectContaining({ status: "BOOKED" }),
  ]);
  expect(
    bookings.every((booking) =>
      booking.participants.every(
        (participant) => participant.status === "BOOKED",
      ),
    ),
  ).toBe(true);
  expect(
    await prisma.tripPreference.count({ where: { tripId, kind: "TRANSPORT" } }),
  ).toBe(0);
});
