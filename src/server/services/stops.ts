import "server-only";

import { parseDateOnly, toDateOnly } from "@/lib/dates";
import {
  stopListProblem,
  syncStopsWithDestination,
  type TripStopInput,
} from "@/lib/domain/stops";
import type { TripAccess } from "@/server/access";
import { logActivity } from "@/server/activity";
import { db, type DbTransaction } from "@/server/db";
import { conflict, invalid } from "@/server/errors";

type Client = typeof db | DbTransaction;

export async function loadStops(
  client: Client,
  tripId: string,
): Promise<TripStopInput[]> {
  const rows = await client.tripStop.findMany({
    where: { tripId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { name: true, startDate: true, endDate: true },
  });
  return rows.map((row) => ({
    name: row.name,
    startDate: row.startDate ? toDateOnly(row.startDate) : null,
    endDate: row.endDate ? toDateOnly(row.endDate) : null,
  }));
}

export function listStops(access: TripAccess) {
  return loadStops(db, access.tripId);
}

/** Replaces a trip's stops with an already validated list, keeping their order. */
export async function replaceStopsTx(
  tx: DbTransaction,
  tripId: string,
  stops: TripStopInput[],
) {
  await tx.tripStop.deleteMany({ where: { tripId } });
  if (stops.length === 0) return;
  await tx.tripStop.createMany({
    data: stops.map((stop, position) => ({
      tripId,
      position,
      name: stop.name.trim(),
      startDate: stop.startDate ? parseDateOnly(stop.startDate) : null,
      endDate: stop.endDate ? parseDateOnly(stop.endDate) : null,
    })),
  });
}

/**
 * Keeps a lone stop in step with the destination after the destination changed. Runs inside the
 * transaction that changed it.
 */
export async function syncDestinationStopTx(
  tx: DbTransaction,
  tripId: string,
  previousDestination: string | null,
  nextDestination: string | null,
) {
  if ((previousDestination ?? "") === (nextDestination ?? "")) return;
  const stops = await loadStops(tx, tripId);
  const next = syncStopsWithDestination(
    stops,
    previousDestination,
    nextDestination,
  );
  if (next) await replaceStopsTx(tx, tripId, next);
}

/**
 * Saves the trip's route as edited by hand: the ordered stops and the airports people fly into
 * and home from. Uses the trip's version, like other edits to the trip record.
 */
export async function updateTripRoute(
  access: TripAccess,
  input: {
    stops: TripStopInput[];
    flyIntoAirport: string | null;
    flyOutOfAirport: string | null;
  },
  expectedVersion: number,
) {
  return db.$transaction(async (tx) => {
    const trip = await tx.trip.findUniqueOrThrow({
      where: { id: access.tripId },
    });
    if (trip.version !== expectedVersion) throw conflict();
    const problem = stopListProblem(input.stops, {
      startDate: trip.startDate ? toDateOnly(trip.startDate) : null,
      endDate: trip.endDate ? toDateOnly(trip.endDate) : null,
    });
    if (problem) throw invalid(problem, { stops: [problem] });
    const result = await tx.trip.updateMany({
      where: { id: trip.id, version: expectedVersion },
      data: {
        flyIntoAirport: input.flyIntoAirport,
        flyOutOfAirport: input.flyOutOfAirport,
        // A trip without a destination takes its first stop as one.
        ...(trip.destination || input.stops.length === 0
          ? {}
          : { destination: input.stops[0]!.name }),
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    if (result.count !== 1) throw conflict();
    await replaceStopsTx(tx, trip.id, input.stops);
    await logActivity(tx, {
      tripId: trip.id,
      actorId: access.userId,
      type: "TRIP_UPDATED",
      summary: "updated the stops and airports",
      entityType: "trip",
      entityId: trip.id,
      metadata: { fields: ["stops"] },
    });
  });
}
