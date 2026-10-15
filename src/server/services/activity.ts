import "server-only";

import type { TripAccess } from "@/server/access";
import { db } from "@/server/db";

export async function listRecentActivity(access: TripAccess, limit = 15) {
  return db.activityLog.findMany({
    where: { tripId: access.tripId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    include: { actor: { select: { id: true, name: true, image: true } } },
  });
}
