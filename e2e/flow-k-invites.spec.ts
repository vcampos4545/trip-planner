import {
  addMemberDirectly,
  createSignedInUser,
  createTripManually,
  expect,
  prisma,
  signedInContext,
  test,
} from "./support/fixtures";

test("Flow K: the Invite your group next step opens the invite dialog, and a second user joins with the copied link", async ({
  signIn,
  browser,
  baseURL,
}) => {
  const organizer = await signIn("Nora Nextstep");
  await organizer.context.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: baseURL },
  );
  const tripId = await createTripManually(organizer.page, {
    title: "Invite regression trip",
    destination: "Porto",
    startDate: "2027-06-01",
    endDate: "2027-06-07",
  });
  const page = organizer.page;
  await expect(page.getByTestId("next-step-title")).toHaveText(
    "Invite your group",
  );

  // Regression: the button opens the dialog instead of appending #proposals.
  await page
    .getByRole("region", { name: "Next step" })
    .getByRole("button", { name: "Invite people" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Invite people to Invite regression trip",
    }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");

  // Create and copy a link.
  await dialog.getByLabel("Use limit").fill("2");
  await dialog.getByRole("button", { name: "Create invite link" }).click();
  const inviteUrl = await dialog.getByTestId("invite-link").inputValue();
  expect(inviteUrl).toMatch(
    new RegExp(`^${baseURL}/invite/[A-Za-z0-9_-]{40,}$`),
  );
  await dialog.getByRole("button", { name: "Copy invite link" }).click();
  await expect(
    dialog.getByRole("button", { name: "Copied invite link" }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    inviteUrl,
  );
  await expect(dialog.getByTestId("invite-links-list")).toContainText(
    "Created by Nora Nextstep",
  );
  await expect(dialog.getByTestId("invite-links-list")).toContainText(
    "used 0 of 2",
  );
  await page.keyboard.press("Escape");

  // A signed-out visitor sees the safe preview and a way to sign in, nothing more.
  const anonymous = await browser.newContext({ baseURL });
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(inviteUrl);
  await expect(anonymousPage.getByTestId("invite-trip-title")).toHaveText(
    "Invite regression trip",
  );
  await expect(anonymousPage.getByTestId("invite-summary")).toContainText(
    "1 person is planning this trip",
  );
  await expect(
    anonymousPage.getByRole("button", { name: "Sign in with Google to join" }),
  ).toBeVisible();
  await anonymous.close();

  // A second user joins with the link.
  const friend = await signIn("Finn Friend");
  await friend.page.goto(inviteUrl);
  await expect(
    friend.page.getByText("Nora Nextstep invited you"),
  ).toBeVisible();
  await friend.page.getByRole("button", { name: "Join this trip" }).click();
  await friend.page.waitForURL(new RegExp(`/trips/${tripId}$`));
  await expect(friend.page.getByTestId("member-list")).toContainText(
    "Nora Nextstep",
  );
  // Members can't invite until an organizer allows it.
  await expect(
    friend.page.getByRole("button", { name: "Invite", exact: true }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("member-list")).toContainText("Finn Friend");
  await expect(page.getByText(/used an invite link from Nora/)).toBeVisible();

  // The dashboard's next step for a solo trip opens the dialog on the trip page.
  const soloOwner = await createSignedInUser("Sol Solo");
  const soloContext = await signedInContext(browser, baseURL!, soloOwner);
  const soloPage = await soloContext.newPage();
  await createTripManually(soloPage, {
    title: "Solo dashboard trip",
    destination: "Oslo",
    startDate: "2027-08-01",
    endDate: "2027-08-03",
  });
  await soloPage.goto("/trips");
  await soloPage.getByRole("link", { name: "Invite your group" }).click();
  await expect(
    soloPage.getByRole("heading", {
      name: "Invite people to Solo dashboard trip",
    }),
  ).toBeVisible();
  expect(new URL(soloPage.url()).search).toBe("");
  await soloContext.close();
});

test("Flow K: email invitations without an email provider show the link and never claim an email was sent", async ({
  signIn,
}) => {
  const organizer = await signIn("Emma Emailer");
  await createTripManually(organizer.page, { title: "Email invite trip" });
  const page = organizer.page;
  await page
    .getByRole("button", { name: "Invite", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Invite by email" }).click();
  await expect(dialog.getByTestId("email-not-configured")).toContainText(
    "Email sending isn't set up",
  );

  await dialog.getByLabel("Email addresses").fill("not an address");
  await dialog.getByRole("button", { name: /Create invitation/ }).click();
  await expect(dialog.getByText(/Not an email address/)).toBeVisible();

  await dialog
    .getByLabel("Email addresses")
    .fill("Jamie <jamie@example.test>, sam@example.test");
  await dialog.getByRole("button", { name: "Create 2 invitations" }).click();
  const results = dialog.getByTestId("invite-email-results");
  await expect(results).toContainText(
    "Email sending isn't set up, so nothing was emailed",
  );
  await expect(results.getByText("Not emailed")).toHaveCount(2);
  await expect(results.getByText("Email sent")).toHaveCount(0);
  await expect(results.getByTestId("invite-email-link")).toHaveCount(2);
  const jamieLink = await results
    .getByTestId("invite-email-link")
    .first()
    .inputValue();
  expect(jamieLink).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);

  const list = dialog.getByTestId("invite-emails-list");
  await expect(list).toContainText("jamie@example.test");
  await expect(list).toContainText("Pending");
  await expect(list).toContainText("Not emailed");

  // Revoke one.
  await list
    .getByRole("button", { name: "Revoke invitation to sam@example.test" })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(
    list.locator("li", { hasText: "sam@example.test" }),
  ).toContainText("Revoked");

  // The email-bound link only works for the matching account.
  const other = await signIn("Oscar Other");
  await other.page.goto(jamieLink);
  await expect(
    other.page.getByText("This invitation is for a different account"),
  ).toBeVisible();
  await expect(
    other.page.getByRole("button", { name: "Join this trip" }),
  ).toHaveCount(0);
});

test("Flow K: organizers remove members, and the leave rules keep a trip with an organizer", async ({
  signIn,
  browser,
  baseURL,
}) => {
  const organizer = await signIn("Lena Leader");
  const tripId = await createTripManually(organizer.page, {
    title: "Leave rules trip",
  });
  const page = organizer.page;
  const members = page.getByRole("region", { name: "Group members" });

  // 1. The only member can't leave, from the members card or the trip menu.
  await expect(members.getByTestId("leave-blocked")).toContainText(
    "You're the only member",
  );
  await expect(
    members.getByRole("button", { name: "Leave trip" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Trip options" }).click();
  await expect(
    page.getByRole("menuitem", { name: /Leave trip/ }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  // 2. With other members, the only organizer still can't leave.
  const friend = await createSignedInUser("Fred Follower");
  const extra = await createSignedInUser("Xena Extra");
  await addMemberDirectly(tripId, friend.id);
  await addMemberDirectly(tripId, extra.id);
  await page.reload();
  await expect(members.getByTestId("leave-blocked")).toContainText(
    "You're the only organizer",
  );

  // 3. Remove a member, with confirmation.
  await members.getByRole("button", { name: "Manage Xena Extra" }).click();
  await page.getByRole("menuitem", { name: "Remove from trip" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByTestId("member-list")).not.toContainText("Xena Extra");
  expect(
    await prisma.tripMember.count({ where: { tripId, userId: extra.id } }),
  ).toBe(0);

  // 4. A regular member can leave.
  const friendContext = await signedInContext(browser, baseURL!, friend);
  const friendPage = await friendContext.newPage();
  await friendPage.goto(`/trips/${tripId}`);
  await friendPage
    .getByRole("region", { name: "Group members" })
    .getByRole("button", { name: "Leave trip" })
    .click();
  await friendPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "Leave trip" })
    .click();
  await friendPage.waitForURL(/\/trips$/);
  await expect(friendPage.getByText("Leave rules trip")).toHaveCount(0);
  await friendContext.close();

  // 5. After transferring the organizer role, the former organizer can leave.
  await addMemberDirectly(tripId, friend.id);
  await page.reload();
  await members.getByRole("button", { name: "Manage Fred Follower" }).click();
  await page.getByRole("menuitem", { name: "Transfer organizer role" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Transfer role" })
    .click();
  await expect(members.getByTestId("leave-blocked")).toHaveCount(0);
  await members.getByRole("button", { name: "Leave trip" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Leave trip" })
    .click();
  await page.waitForURL(/\/trips$/);
  const roles = await prisma.tripMember.findMany({
    where: { tripId },
    select: { userId: true, role: true },
  });
  expect(roles).toEqual([{ userId: friend.id, role: "ORGANIZER" }]);
});
