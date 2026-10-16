import { createTripManually, expect, test } from "./support/fixtures";

test("Flow D: itinerary items can be added, edited, removed, and Atlas proposals reviewed", async ({
  signIn,
}) => {
  const { page } = await signIn("Ines Itinerary");
  const tripId = await createTripManually(page, {
    title: "Lisbon days",
    destination: "Lisbon",
    startDate: "2027-05-20",
    endDate: "2027-05-22",
  });

  // 1-2. Create an event; it shows up on the right day and time in the day list.
  await page.goto(`/trips/${tripId}/itinerary?view=list`);
  await expect(
    page.getByRole("heading", { name: /Day 1 · Thursday, May 20, 2027/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add to itinerary" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("What").fill("Castle visit");
  await dialog.getByLabel("Date").fill("2027-05-21");
  await dialog.getByLabel("Start").fill("10:00");
  await dialog.getByLabel("End").fill("12:00");
  await dialog.getByLabel("Place").fill("Castelo de São Jorge");
  await dialog.getByRole("button", { name: "Add to itinerary" }).click();
  await expect(dialog).toBeHidden();
  const day2 = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: /Day 2 · Friday, May 21, 2027/ }),
  });
  const castle = day2
    .getByTestId("itinerary-event")
    .filter({ hasText: "Castle visit" });
  await expect(castle).toContainText("10 AM to 12 PM");
  await expect(castle).toContainText("Planned");

  // 3. Edit and remove.
  await castle
    .getByRole("button", { name: "Actions for Castle visit" })
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("What").fill("Castle and Alfama walk");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  const renamed = day2
    .getByTestId("itinerary-event")
    .filter({ hasText: "Castle and Alfama walk" });
  await expect(renamed).toBeVisible();
  await renamed
    .getByRole("button", { name: "Actions for Castle and Alfama walk" })
    .click();
  await page.getByRole("menuitem", { name: "Mark confirmed" }).click();
  await expect(renamed).toContainText("Confirmed");
  await renamed
    .getByRole("button", { name: "Actions for Castle and Alfama walk" })
    .click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText("Castle and Alfama walk")).toHaveCount(0);

  // 4. Atlas proposes activities from the trip context, from the panel on this tab.
  await page.getByRole("button", { name: "Ask Atlas", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Atlas" });
  await panel
    .getByRole("textbox", { name: "Message" })
    .fill("Can you suggest an activity for a free afternoon?");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(
    panel.getByText(/I added two ideas for your second day/),
  ).toBeVisible();
  await expect(
    panel.getByText(
      "Suggested for the itinerary: Atlas pick: Tile museum visit",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // The week view, the default, shows suggestions apart from the plan.
  await page.goto(`/trips/${tripId}/itinerary`);
  const week = page.getByTestId("week-view");
  await expect(
    week.locator('[data-testid="calendar-item"][data-status="suggested"]'),
  ).toHaveCount(2);

  // 5-6. Suggestions stay separate until reviewed; accept one, reject the other.
  await page.getByRole("link", { name: "List" }).click();
  await page.waitForURL(/view=list$/);
  const suggestions = page.getByTestId("itinerary-suggestions");
  await expect(suggestions.getByTestId("itinerary-suggestion")).toHaveCount(2);
  await expect(suggestions).toContainText(
    "Not verified: Opening hours and travel time are not verified.",
  );
  await expect(day2.getByTestId("itinerary-event")).toHaveCount(0);

  await suggestions
    .getByTestId("itinerary-suggestion")
    .filter({ hasText: "Tile museum" })
    .getByRole("button", { name: "Accept" })
    .click();
  await expect(
    day2.getByTestId("itinerary-event").filter({ hasText: "Tile museum" }),
  ).toContainText("Planned");
  await suggestions
    .getByTestId("itinerary-suggestion")
    .filter({ hasText: "Sunset viewpoint" })
    .getByRole("button", { name: "Reject" })
    .click();
  await expect(page.getByTestId("itinerary-suggestions")).toHaveCount(0);
  await expect(page.getByText("Sunset viewpoint")).toHaveCount(0);
  await expect(
    day2.getByTestId("itinerary-event").filter({ hasText: "Tile museum" }),
  ).not.toContainText("Suggestion");
});
