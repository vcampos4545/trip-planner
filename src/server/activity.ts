import "server-only";

import type { ActivityType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { DbTransaction } from "@/server/db";

export type ActivityEntry = {
  tripId: string;
  actorId: string | null;
  type: ActivityType;
  summary: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
};

/** Writes an activity entry inside the caller's transaction so history matches the change. */
export async function logActivity(tx: DbTransaction, entry: ActivityEntry) {
  await tx.activityLog.create({
    data: {
      tripId: entry.tripId,
      actorId: entry.actorId,
      type: entry.type,
      summary: entry.summary.slice(0, 300),
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
    },
  });
}
