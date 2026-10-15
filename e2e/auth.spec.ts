import {
  createSignedInUser,
  expect,
  signedInContext,
  test,
} from "./support/fixtures";

test.describe("authentication", () => {
  test("signed-out visitors land on the welcome screen and private routes redirect", async ({
    page,
  }) => {
    await page.goto("/trips");
    await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Ftrips/);
    await expect(
      page.getByRole("heading", { name: /Plan the trip together/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();
  });

  test("Continue with Google starts a real OAuth request with the right callback", async ({
    page,
    baseURL,
  }) => {
    let googleUrl: URL | null = null;
    await page.route("https://accounts.google.com/**", async (route) => {
      googleUrl = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Google sign-in (intercepted)</h1>",
      });
    });
    await page.goto("/signin");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(
      page.getByRole("heading", { name: "Google sign-in (intercepted)" }),
    ).toBeVisible();
    expect(googleUrl).not.toBeNull();
    const url = googleUrl!;
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(
      "e2e-google-client-id.apps.googleusercontent.com",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${baseURL}/api/auth/callback/google`,
    );
    expect(url.searchParams.get("scope")).toContain("email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("an expired session is sent back to sign in with an explanation", async ({
    browser,
    baseURL,
  }) => {
    const user = await createSignedInUser("Expired Erin", { expired: true });
    const context = await signedInContext(browser, baseURL!, user);
    const page = await context.newPage();
    await page.goto("/trips");
    await expect(page).toHaveURL(/\/signin\?.*reason=expired/);
    await expect(page.getByText("Your session expired")).toBeVisible();
    await context.close();
  });

  test("failed sign-in shows a helpful error", async ({ page }) => {
    await page.goto("/signin?error=AccessDenied");
    await expect(page.getByText("Sign-in failed")).toBeVisible();
    await expect(page.getByText(/Access was denied/)).toBeVisible();
  });

  test("a signed-in user can sign out", async ({ signIn }) => {
    const { page } = await signIn("Sasha Signout");
    await page.goto("/trips");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin/);
    await page.goto("/trips");
    await expect(page).toHaveURL(/\/signin/);
  });
});
