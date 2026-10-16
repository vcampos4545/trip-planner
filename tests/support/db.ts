import { db } from "@/server/db";

import { assertTestDatabase } from "./test-database";

/** Empties every application table. Only allowed against the test database. */
export async function resetDatabase() {
  assertTestDatabase(process.env.DATABASE_URL ?? "");
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length === 0) return;
  const list = tables
    .map((table) => `"public"."${table.tablename}"`)
    .join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;

/**
 * Creates a user. `verified` mirrors a Google sign-in, where the app records that Google verified
 * the address.
 */
export async function createUser(
  name = "Test User",
  options: { email?: string; verified?: boolean } = {},
) {
  counter += 1;
  const slug = `${name.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}.${counter}`;
  const user = await db.user.create({
    data: {
      name,
      email: options.email ?? `${slug}@example.test`,
      emailVerified: options.verified === false ? null : new Date(),
    },
  });
  return { id: user.id, name: user.name, email: user.email, image: null };
}

export async function addMember(
  tripId: string,
  userId: string,
  role: "ORGANIZER" | "MEMBER" = "MEMBER",
) {
  return db.tripMember.create({ data: { tripId, userId, role } });
}

export { db };
