import { expect, prisma, test } from "./support/fixtures";

test("Flow A: a new user creates a trip by describing it to Atlas and can come back to it", async ({
  signIn,
}) => {
  const { page, user } = await signIn("Avery Newcomer");

  // 1-2. Signed in, with an empty dashboard.
  await page.goto("/trips");
  await expect(page.getByText("Plan your first trip")).toBeVisible();

  // 3. Start with one of the three modes.
  await page.getByRole("link", { name: "Create a trip" }).click();
  await expect(
    page.getByRole("button", { name: /I know where I want to go/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /I have a vibe in mind/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /I have no idea/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /I know where I want to go/ }).click();
  await expect(page).toHaveURL(/\/trips\/new\/[^/]+$/);
  await expect(
    page.getByText("Where are you thinking of going? Who's coming, and when?"),
  ).toBeVisible();

  // 4. Describe the trip in natural language.
  await page
    .getByRole("textbox", { name: "Message" })
    .fill(
      "We want to go to Lisbon in late May, four of us, and we love food markets.",
    );
  await page.getByRole("button", { name: "Send message" }).click();

  // 5. Details are extracted and a trip is created; the conversation continues on the trip, in
  //    the Atlas panel.
  await page.waitForURL(/\/trips\/(?!new)[^/?]+\?atlas=open$/);
  await expect(page.getByRole("dialog", { name: "Atlas" })).toBeVisible();
  await expect(page.getByTestId("trip-title")).toHaveText("Lisbon trip");
  await expect(
    page.getByText(/Lisbon in late May with four of you/),
  ).toBeVisible();
  await expect(page.getByText(/Noted destination/)).toBeVisible();

  const tripId = new URL(page.url()).pathname.split("/")[2]!;
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: { preferences: true },
  });
  expect(trip).toMatchObject({
    destination: "Lisbon",
    groupSize: 4,
    dateNotes: "late May",
    startDate: null,
    createdById: user.id,
  });
  expect(trip.destinationConfirmed).toBe(false);
  expect(
    trip.preferences.map((preference) => preference.description),
  ).toContain("Food markets");

  // 6. Atlas asks a useful follow-up instead of repeating known information.
  await expect(
    page.getByText("Where will everyone be flying from?"),
  ).toBeVisible();

  // 7. Leave and return: everything is still there.
  await page.goto("/trips");
  await page.getByRole("link", { name: "Lisbon trip" }).click();
  await page.waitForURL(new RegExp(`/trips/${tripId}$`));
  await expect(page.getByTestId("trip-route")).toHaveText("Lisbon (tentative)");
  await page.reload();
  await page.getByRole("button", { name: "Ask Atlas", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Atlas" });
  await expect(
    panel.getByText("We want to go to Lisbon in late May"),
  ).toBeVisible();
  await expect(
    panel.getByText(/Lisbon in late May with four of you/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.getByRole("link", { name: "Tasks & decisions" }).click();
  await expect(
    page.getByRole("button", { name: "Ask Atlas", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("Group size")).toBeVisible();
  await expect(page.getByText("late May").first()).toBeVisible();
});

test("Flow A: details can be edited directly without asking Atlas", async ({
  signIn,
}) => {
  const { page } = await signIn("Devon Direct");
  await page.goto("/trips/new");
  await page.getByRole("button", { name: /I have no idea/ }).click();
  await expect(page).toHaveURL(/\/trips\/new\/[^/]+$/);
  await page.getByRole("button", { name: "Edit" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Trip name").fill("Somewhere warm");
  await sheet.getByLabel("Leaving from").fill("Denver");
  await sheet.getByLabel("Timing notes").fill("first week of March");
  await sheet.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByTestId("draft-title")).toHaveText("Somewhere warm");
  await expect(page.getByText("Denver")).toBeVisible();
  await page
    .getByRole("button", { name: "Create trip with these details" })
    .click();
  await page.waitForURL(/\/trips\/(?!new)[^/?]+\?atlas=open$/);
  await expect(page.getByTestId("trip-title")).toHaveText("Somewhere warm");
});
