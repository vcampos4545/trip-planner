import "server-only";

import { revalidatePath } from "next/cache";

/** Refreshes every tab of a trip workspace plus the dashboard after a mutation. */
export function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}`, "layout");
  revalidatePath("/trips");
}
