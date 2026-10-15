import { createTripManually, expect, test } from "./support/fixtures";

test("Web search selected without an API key says live research is unavailable", async ({
  signIn,
}) => {
  const { page } = await signIn("Kit Keyless");
  const tripId = await createTripManually(page, {
    title: "No key",
    destination: "Rome",
  });
  await page.goto(`/trips/${tripId}/options`);
  await expect(page.getByText("Live research is unavailable")).toBeVisible();
  await expect(page.getByTestId("research-unavailable-reason")).toContainText(
    "OpenAI web search is selected but cannot run: RESEARCH_PROVIDER is openai_web, but OPENAI_API_KEY is not set on the server.",
  );

  await page.goto(`/trips/${tripId}/plan`);
  await expect(page.getByText("Live search unavailable")).toBeVisible();
  await expect(page.getByText("Live search: OpenAI web search")).toHaveCount(0);
});
