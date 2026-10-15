import {
  addMemberDirectly,
  createSignedInUser,
  createTripManually,
  expect,
  signedInContext,
  test,
} from "./support/fixtures";

test("Flow E: flights with several travelers, multiple stays, and a budget that ignores missing prices", async ({
  signIn,
  browser,
  baseURL,
}) => {
  const organizer = await signIn("Blake Booker");
  const tripId = await createTripManually(organizer.page, {
    title: "Budget trip",
    destination: "Porto",
  });
  const friend = await createSignedInUser("Fran Flyer");
  await addMemberDirectly(tripId, friend.id);
  const page = organizer.page;

  // 1. Record a flight.
  await page.goto(`/trips/${tripId}/bookings`);
  await page.getByRole("button", { name: "Add flights" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("TP 202 Boston to Porto");
  await dialog.getByLabel("Status").selectOption("CONFIRMED");
  await dialog.getByLabel("From").fill("BOS");
  await dialog.getByLabel("To").fill("OPO");
  await dialog.getByLabel("Amount").fill("500");
  await dialog.getByLabel("How it's split").selectOption("PER_PERSON");
  await dialog.getByLabel("This is an estimate").uncheck();
  await dialog.getByRole("checkbox", { name: "Blake Booker" }).check();
  await dialog.getByRole("button", { name: "Save booking" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("budget-total")).toHaveText("$500");

  // 2. Another traveler joins the same flight.
  const friendContext = await signedInContext(browser, baseURL!, friend);
  const friendPage = await friendContext.newPage();
  await friendPage.goto(`/trips/${tripId}/bookings`);
  const flight = friendPage
    .getByTestId("booking-card")
    .filter({ hasText: "TP 202" });
  await flight.getByRole("button", { name: "I'm on this flight" }).click();
  await expect(flight.getByTestId("booking-travelers")).toContainText(
    "Fran Flyer",
  );
  await expect(flight.getByTestId("booking-travelers")).toContainText(
    "Blake Booker",
  );
  await friendContext.close();

  // 4. The budget reflects both travelers.
  await page.reload();
  await expect(page.getByTestId("budget-total")).toHaveText("$1,000");

  // 3. Two separate accommodations, one without a price yet.
  for (const [title, amount] of [
    ["Riverside apartment", "300"],
    ["Hostel for the last night", ""],
  ] as const) {
    await page.getByRole("button", { name: "Add accommodation" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(title);
    if (amount) await dialog.getByLabel("Amount").fill(amount);
    await dialog.getByRole("checkbox", { name: "Blake Booker" }).check();
    await dialog.getByRole("button", { name: "Save booking" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(
    page.getByTestId("booking-card").filter({ hasText: "Riverside apartment" }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("booking-card")
      .filter({ hasText: "Hostel for the last night" }),
  ).toBeVisible();

  // 5. The missing price is not treated as zero.
  await expect(page.getByTestId("budget-total")).toHaveText("$1,300");
  await expect(page.getByTestId("budget-unpriced")).toContainText(
    "Hostel for the last night",
  );
  await expect(
    page
      .getByTestId("booking-card")
      .filter({ hasText: "Hostel for the last night" })
      .getByTestId("booking-cost"),
  ).toHaveText("No price yet, not counted in the budget");
});
