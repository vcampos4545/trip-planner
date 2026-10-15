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
  await page.goto(`/trips/${tripId}/plan`);
  await expect(page.getByTestId("ai-not-configured")).toBeVisible();
  await expect(page.getByText("Live search off")).toBeVisible();
});
