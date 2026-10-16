import { createTripManually, expect, prisma, test } from "./support/fixtures";

test("Flow F: provider outages and invalid AI output give clear feedback and leave data intact", async ({
  signIn,
}) => {
  const { page } = await signIn("Rae Reliable");
  const tripId = await createTripManually(page, {
    title: "Reliability",
    destination: "Oslo",
    startDate: "2027-08-01",
    endDate: "2027-08-04",
  });
  const before = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });

  // The old Plan with AI address opens the Atlas panel.
  await page.goto(`/trips/${tripId}/plan`);
  await expect(page.getByRole("dialog", { name: "Atlas" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("simulate outage please");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("note")).toContainText(
    "couldn't reach the AI provider",
  );
  await expect(page.getByRole("note")).toContainText(
    "Nothing in the trip was changed.",
  );
  await expect(page.getByText("simulate outage please")).toBeVisible();

  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Use this invalid date for the start");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/I couldn't save that/)).toBeVisible();
  await expect(
    page.getByRole("list", { name: "What changed" }).last(),
  ).toContainText("Nothing was saved. Invalid values: startDate");

  const after = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  expect(after.startDate?.toISOString()).toBe(before.startDate?.toISOString());
  expect(after.version).toBe(before.version);

  // Everything persists across a fresh page load.
  await page.reload();
  await expect(page.getByText("simulate outage please")).toBeVisible();
});

test("Flow F: Atlas suggests tasks that wait for review", async ({
  signIn,
}) => {
  const { page } = await signIn("Tara Tasks");
  const tripId = await createTripManually(page, {
    title: "Task suggestions",
    destination: "Madrid",
  });
  await page.goto(
    `/trips/${tripId}/plan?prompt=${encodeURIComponent("Please suggest tasks for what's missing")}`,
  );
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Please suggest tasks for what's missing",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Suggested task: Atlas pick: Compare airport transfers"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Tasks & decisions" }).click();
  const suggested = page.getByTestId("suggested-tasks");
  await expect(suggested).toContainText("Compare airport transfers");
  await expect(page.getByTestId("task-list")).toHaveCount(0);
  await suggested.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByTestId("task-list")).toContainText(
    "Compare airport transfers",
  );
});
