import {
  addMemberDirectly,
  createSignedInUser,
  createTripManually,
  expect,
  signedInContext,
  test,
} from "./support/fixtures";

test("Flow C: options are saved with sources, shortlisted, voted on, and approved without being booked", async ({
  signIn,
  browser,
  baseURL,
}) => {
  const organizer = await signIn("Cora Chooser");
  const tripId = await createTripManually(organizer.page, {
    title: "Hotel decision",
    destination: "Rome",
  });
  const member = await createSignedInUser("Milo Member");
  await addMemberDirectly(tripId, member.id);

  // 1-2. Manually add two candidates with a source and price.
  const page = organizer.page;
  await page.goto(`/trips/${tripId}/options`);
  await expect(page.getByText("Live research is unavailable")).toBeVisible();
  for (const [name, price] of [
    ["Hotel near the Pantheon", "240"],
    ["Apartment in Trastevere", "180"],
  ] as const) {
    await page.getByRole("button", { name: "Add option" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog
      .getByLabel("Link")
      .fill(`https://example.com/${encodeURIComponent(name)}`);
    await dialog.getByLabel("Source").fill("Example Stays");
    await dialog.getByLabel("Price").fill(price);
    await dialog.getByLabel("Per").fill("night");
    await dialog.getByRole("button", { name: "Save option" }).click();
    await expect(dialog).toBeHidden();
  }
  const hotel = page
    .getByTestId("option-card")
    .filter({ hasText: "Hotel near the Pantheon" });
  await expect(hotel).toContainText("Suggested");
  await expect(hotel).toContainText("$240 per night");
  await expect(
    hotel.getByRole("link", { name: "Example Stays" }),
  ).toHaveAttribute("href", /example\.com/);

  // 3. Shortlist both and start a vote.
  for (const name of ["Hotel near the Pantheon", "Apartment in Trastevere"]) {
    const card = page.getByTestId("option-card").filter({ hasText: name });
    await card.getByRole("button", { name: "Shortlist" }).click();
    await expect(card).toContainText("Shortlisted");
    await card.getByRole("checkbox").check();
  }
  await page.getByRole("button", { name: "Compare and vote" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start vote" })
    .click();
  await expect(page.getByText(/Vote started/)).toBeVisible();

  await page.goto(`/trips/${tripId}/tasks`);
  const decision = page.getByTestId("decision-card").first();
  await decision
    .locator("li", { hasText: "Hotel near the Pantheon" })
    .getByRole("button", { name: "Vote" })
    .click();
  await expect(
    decision.getByRole("button", { name: "Your vote" }),
  ).toBeVisible();

  const memberContext = await signedInContext(browser, baseURL!, member);
  const memberPage = await memberContext.newPage();
  await memberPage.goto(`/trips/${tripId}/tasks`);
  const memberDecision = memberPage.getByTestId("decision-card").first();
  await expect(memberDecision).toContainText("1 of 2 voted");
  await memberDecision
    .locator("li", { hasText: "Apartment in Trastevere" })
    .getByRole("button", { name: "Vote" })
    .click();
  await expect(memberDecision).toContainText("2 of 2 voted");
  // Only organizers can resolve.
  await expect(
    memberDecision.getByRole("button", { name: "Resolve decision" }),
  ).toHaveCount(0);
  await memberContext.close();

  // 4. The organizer resolves the decision.
  await page.reload();
  await page.getByRole("button", { name: "Resolve decision" }).click();
  const resolve = page.getByRole("dialog");
  await resolve
    .getByLabel("Outcome")
    .selectOption({ label: "Hotel near the Pantheon (1 vote)" });
  await resolve.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByTestId("decision-card").first()).toContainText(
    "Resolved",
  );

  // 5. Approved is not booked.
  await page.goto(`/trips/${tripId}/options`);
  const approved = page
    .getByTestId("option-card")
    .filter({ hasText: "Hotel near the Pantheon" });
  await expect(approved).toContainText("Approved");
  await expect(approved).not.toContainText("Booked");
  await page.goto(`/trips/${tripId}/bookings`);
  await expect(page.getByTestId("booking-card")).toHaveCount(0);
});
