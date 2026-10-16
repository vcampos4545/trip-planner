import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

import type { FlightCacheStore } from "./cache";

/**
 * Keeps the flight search cache in Postgres so a restart or a second app instance does not lose
 * it. Rows hold public fare data only, never trip or user data. Expired rows are cleared as new
 * ones are written.
 */
export const dbFlightCache: FlightCacheStore = {
  async get(key, now) {
    const row = await db.flightSearchCache.findUnique({
      where: { key },
      select: { payload: true, expiresAt: true },
    });
    if (!row || row.expiresAt <= now) return null;
    return row.payload;
  },
  async set(key, value, expiresAt) {
    const payload = value as Prisma.InputJsonValue;
    await db.flightSearchCache.upsert({
      where: { key },
      create: { key, payload, expiresAt },
      update: { payload, expiresAt },
    });
    await db.flightSearchCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  },
};
