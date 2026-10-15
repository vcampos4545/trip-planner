import { execFileSync } from "node:child_process";

import {
  assertTestDatabase,
  TEST_DATABASE_URL,
} from "../../tests/support/test-database";

import { prisma } from "./db";

/** Migrates and empties the test database before the suite. */
export default async function globalSetup() {
  assertTestDatabase(TEST_DATABASE_URL);
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((table) => `"public"."${table.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
  await prisma.$disconnect();
}
