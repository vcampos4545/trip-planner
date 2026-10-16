import {
  createSignedInUser,
  createTripManually,
  expect,
  signedInContext,
  test,
} from "./support/fixtures";

test("Flow B: organizer invites a friend, both see the same shared trip, outsiders are locked out", async ({
  signIn,
  browser,
  baseURL,
}) => {
  const organizer = await signIn("Olivia Organizer");
  const tripId = await createTripManually(organizer.page, {
    title: "Group trip to Mexico City",
    destination: "Mexico City",
  });

  // 1. The organizer creates an invite link.
  await organizer.page
    .getByRole("button", { name: "Invite", exact: true })
    .first()
    .click();
  const dialog = organizer.page.getByRole("dialog");
  await dialog.getByLabel("Link expires after").selectOption("3");
  await dialog.getByRole("button", { name: "Create invite link" }).click();
  const inviteUrl = await dialog.getByTestId("invite-link").inputValue();
  expect(inviteUrl).toMatch(
    new RegExp(`^${baseURL}/invite/[A-Za-z0-9_-]{40,}$`),
  );
  await expect(dialog.getByText("Active invite links")).toBeVisible();
  await organizer.page.keyboard.press("Escape");

  // 2. The invited user signs in and joins.
  const friend = await signIn("Felix Friend");
  await friend.page.goto(inviteUrl);
  await expect(friend.page.getByTestId("invite-trip-title")).toHaveText(
    "Group trip to Mexico City",
  );
  await friend.page.getByRole("button", { name: "Join this trip" }).click();
  await friend.page.waitForURL(new RegExp(`/trips/${tripId}$`));

  // 3. Both see the same members.
  await expect(friend.page.getByTestId("member-list")).toContainText(
    "Olivia Organizer",
  );
  await expect(friend.page.getByTestId("member-list")).toContainText(
    "Felix Friend",
  );
  await organizer.page.reload();
  await expect(organizer.page.getByTestId("member-list")).toContainText(
    "Felix Friend",
  );

  // 4. The friend creates a task and saves an option.
  await friend.page.getByRole("link", { name: "Tasks & decisions" }).click();
  await friend.page.getByRole("button", { name: "New task" }).click();
  const taskDialog = friend.page.getByRole("dialog");
  await taskDialog.getByLabel("Title").fill("Research street food tours");
  await taskDialog
    .getByLabel("Assignee")
    .selectOption({ label: "Felix Friend" });
  await taskDialog.getByRole("button", { name: "Create task" }).click();
  await expect(friend.page.getByTestId("task-list")).toContainText(
    "Research street food tours",
  );

  await friend.page.getByRole("link", { name: "Options" }).click();
  await friend.page.getByRole("button", { name: "Add option" }).first().click();
  const optionDialog = friend.page.getByRole("dialog");
  await optionDialog.getByLabel("Type").selectOption("ACTIVITY");
  await optionDialog.getByLabel("Name").fill("Taco tour in Roma Norte");
  await optionDialog.getByLabel("Link").fill("https://example.com/taco-tour");
  await optionDialog.getByRole("button", { name: "Save option" }).click();
  await expect(
    friend.page
      .getByTestId("option-card")
      .filter({ hasText: "Taco tour in Roma Norte" }),
  ).toBeVisible();

  // 5. The organizer sees both changes and the activity history.
  await organizer.page.goto(`/trips/${tripId}/tasks`);
  await expect(organizer.page.getByTestId("task-list")).toContainText(
    "Research street food tours",
  );
  await organizer.page.goto(`/trips/${tripId}/options`);
  await expect(
    organizer.page
      .getByTestId("option-card")
      .filter({ hasText: "Taco tour in Roma Norte" }),
  ).toContainText("Suggested");
  await organizer.page.goto(`/trips/${tripId}`);
  await expect(
    organizer.page.getByText(
      /Felix Friend\s+saved the option "Taco tour in Roma Norte"/,
    ),
  ).toBeVisible();

  // 6. An unrelated user cannot reach the trip by guessing its URL.
  const stranger = await createSignedInUser("Sam Stranger");
  const strangerContext = await signedInContext(browser, baseURL!, stranger);
  const strangerPage = await strangerContext.newPage();
  for (const path of ["", "/tasks", "/options", "/bookings", "/plan"]) {
    await strangerPage.goto(`/trips/${tripId}${path}`);
    await expect(
      strangerPage.getByRole("heading", { name: "Trip not found" }),
    ).toBeVisible();
    await expect(
      strangerPage.getByText("Group trip to Mexico City"),
    ).toHaveCount(0);
  }
  await strangerContext.close();
});

test("Flow B: revoked invite links stop working", async ({ signIn }) => {
  const organizer = await signIn("Rita Revoker");
  await createTripManually(organizer.page, { title: "Revocation test" });
  await organizer.page
    .getByRole("button", { name: "Invite", exact: true })
    .first()
    .click();
  const dialog = organizer.page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create invite link" }).click();
  const inviteUrl = await dialog.getByTestId("invite-link").inputValue();
  await dialog
    .getByTestId("invite-links-list")
    .getByRole("button", { name: "Revoke" })
    .click();
  await organizer.page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(dialog.getByText("Active invite links")).toHaveCount(0);

  const latecomer = await signIn("Larry Late");
  await latecomer.page.goto(inviteUrl);
  await expect(
    latecomer.page.getByRole("heading", {
      name: "This invitation was revoked",
    }),
  ).toBeVisible();
  await latecomer.page.goto(inviteUrl.replace(/.{6}$/, "AAAAAA"));
  await expect(
    latecomer.page.getByRole("heading", {
      name: "This invite link isn't valid",
    }),
  ).toBeVisible();
});
