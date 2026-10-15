import { createTripManually, expect, prisma, test } from "./support/fixtures";

test("Web search: Atlas cites live results and saves one with its source, price, and retrieval time", async ({
  signIn,
}) => {
  const { page } = await signIn("Wren Websearch");
  const tripId = await createTripManually(page, {
    title: "Rome stays",
    destination: "Rome",
  });

  await page.goto(`/trips/${tripId}/options`);
  await expect(page.getByText("Live research is unavailable")).toHaveCount(0);

  await page.goto(`/trips/${tripId}/plan`);
  await expect(page.getByText("Live search: OpenAI web search")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Use live search for hotels near the Pantheon and save the first");
  await page.getByRole("button", { name: "Send message" }).click();

  // The reply links its citations, and only results the search really consulted appear.
  const reply = page.getByText(/^Live search found/);
  await expect(reply).toBeVisible();
  await expect(
    reply.getByRole("link", { name: "Stub Hotel Pantheon" }),
  ).toHaveAttribute("href", "https://stays.stub.example/pantheon");
  await expect(
    reply.getByRole("link", { name: "Stub Trastevere Apartment" }),
  ).toHaveAttribute("href", "https://rentals.stub.example/trastevere");
  await expect(page.getByText("Invented Palace Hotel")).toHaveCount(0);

  const sources = page.getByTestId("atlas-sources");
  await expect(sources).toContainText("Live search sources, retrieved");
  await expect(
    sources.getByRole("link", { name: "Stub Hotel Pantheon" }),
  ).toHaveAttribute("href", "https://stays.stub.example/pantheon");
  await expect(sources).toContainText("Stub Rentals");
  await expect(
    page.getByRole("list", { name: "What changed" }).last(),
  ).toContainText('Searched OpenAI web search for "hotels near the Pantheon"');

  // The saved option keeps its source, the price as stated by that source, and retrieval time.
  await page.goto(`/trips/${tripId}/options`);
  const card = page
    .getByTestId("option-card")
    .filter({ hasText: "Stub Hotel Pantheon" });
  await expect(card).toContainText("Live result");
  await expect(card).toContainText("€210 per night");
  await expect(card).toContainText("Price as stated");
  await expect(card).toContainText("Availability: Rooms available");
  await expect(card).toContainText("retrieved");
  await expect(card.getByRole("link", { name: "Stub Stays" })).toHaveAttribute(
    "href",
    "https://stays.stub.example/pantheon",
  );

  const saved = await prisma.researchOption.findFirstOrThrow({
    where: { tripId },
  });
  expect(saved.origin).toBe("RESEARCH_PROVIDER");
  expect(saved.retrievedAt).not.toBeNull();
  expect(saved.providerPayload).toMatchObject({ provider: "openai_web" });
});

test("Web search: a failed search says live research failed and saves nothing", async ({
  signIn,
}) => {
  const { page } = await signIn("Fern Failure");
  const tripId = await createTripManually(page, {
    title: "Rome fallback",
    destination: "Rome",
  });
  await page.goto(`/trips/${tripId}/plan`);
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Use live search for searchfail hotels");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText(/^Live research failed, so I can't show live results/),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "What changed" }).last(),
  ).toContainText("Live research failed: Could not reach OpenAI web search.");
  await expect(page.getByTestId("atlas-sources")).toHaveCount(0);
  expect(await prisma.researchOption.count({ where: { tripId } })).toBe(0);
});
