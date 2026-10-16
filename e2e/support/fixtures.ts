import { randomBytes } from "node:crypto";

import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { prisma } from "./db";

export type TestUser = {
  id: string;
  name: string;
  email: string;
  token: string;
};

let counter = 0;

/**
 * Creates a user and a database session for them, the same rows Auth.js writes after a Google
 * sign-in. This only touches the test database; the app has no special login route.
 */
export async function createSignedInUser(
  name: string,
  options: { expired?: boolean } = {},
): Promise<TestUser> {
  counter += 1;
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}.${Date.now()}.${counter}@example.test`;
  // Google-verified, as the app records it at sign-in.
  const user = await prisma.user.create({
    data: { name, email, emailVerified: new Date() },
  });
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      sessionToken: token,
      userId: user.id,
      expires: new Date(
        Date.now() + (options.expired ? -60_000 : 24 * 60 * 60 * 1000),
      ),
    },
  });
  return { id: user.id, name, email, token };
}

export async function signedInContext(
  browser: Browser,
  baseURL: string,
  user: TestUser,
) {
  const context = await browser.newContext({ baseURL });
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: user.token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return context;
}

type Fixtures = {
  /** Opens a signed-in page for a brand new user. */
  signIn: (
    name: string,
  ) => Promise<{ user: TestUser; page: Page; context: BrowserContext }>;
};

export const test = base.extend<Fixtures>({
  signIn: async ({ browser, baseURL }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (name) => {
      const user = await createSignedInUser(name);
      const context = await signedInContext(browser, baseURL!, user);
      contexts.push(context);
      return { user, context, page: await context.newPage() };
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect, prisma };

/** Creates a trip through the UI's manual path and returns its ID. */
export async function createTripManually(
  page: Page,
  input: {
    title: string;
    destination?: string;
    startDate?: string;
    endDate?: string;
  },
) {
  await page.goto("/trips/new");
  await page.getByRole("button", { name: "Create manually" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Trip name").fill(input.title);
  if (input.destination)
    await dialog.getByLabel("Destination").fill(input.destination);
  if (input.startDate)
    await dialog.getByLabel("Start date").fill(input.startDate);
  if (input.endDate) await dialog.getByLabel("End date").fill(input.endDate);
  await dialog.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL(/\/trips\/(?!new)[^/]+$/);
  const id = new URL(page.url()).pathname.split("/")[2]!;
  await expect(page.getByTestId("trip-title")).toHaveText(input.title);
  return id;
}

export async function addMemberDirectly(
  tripId: string,
  userId: string,
  role: "MEMBER" | "ORGANIZER" = "MEMBER",
) {
  await prisma.tripMember.create({ data: { tripId, userId, role } });
}
