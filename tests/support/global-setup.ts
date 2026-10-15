import { execFileSync } from "node:child_process";

import { assertTestDatabase, TEST_DATABASE_URL } from "./test-database";

/** Applies migrations to the test database once before the integration suite. */
export default function setup() {
  assertTestDatabase(TEST_DATABASE_URL);
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
