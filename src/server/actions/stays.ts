"use server";

import type { ActionResult } from "@/lib/action-result";
import type { StayOffer, StaySearchSummary } from "@/lib/stays";
import {
  saveStaySchema,
  stayLinkFormSchema,
  staySearchFormSchema,
} from "@/lib/validation/stays";
import { requireTripAccess } from "@/server/access";
import { openResult, sealResult } from "@/server/flights/seal";
import { checkRateLimit } from "@/server/rate-limit";
import { getStayProvider } from "@/server/stays";
import {
  addStayFromLink,
  saveStayOffer,
  searchStays,
  type SavedStay,
  type StayFromLink,
} from "@/server/services/stays";

import { revalidateTrip } from "./revalidate";
import { runAction } from "./run-action";

const STAY_PURPOSE = "stay-offer";

export type StaySearchResponse = {
  search: StaySearchSummary;
  retrievedAt: string;
  sourceName: string;
  /** True when the app reused an identical recent search instead of asking the provider again. */
  cached: boolean;
  results: { offer: StayOffer; token: string }[];
};

export async function searchStaysAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<StaySearchResponse>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const input = staySearchFormSchema.parse(raw);
    checkRateLimit(`stays:${user.id}`, 10, 60_000);
    const result = await searchStays(getStayProvider(), input);
    return {
      search: result.search,
      retrievedAt: result.retrievedAt,
      sourceName: result.sourceName,
      cached: result.cached ?? false,
      results: result.offers.map((offer) => ({
        offer,
        token: sealResult(STAY_PURPOSE, offer, access),
      })),
    };
  });
}

export async function saveStayAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<SavedStay>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const input = saveStaySchema.parse(raw);
    const offer = openResult<StayOffer>(STAY_PURPOSE, input.token, access);
    const saved = await saveStayOffer(access, offer, {
      asBooking: input.asBooking,
    });
    revalidateTrip(tripId);
    return saved;
  });
}

export async function addStayFromLinkAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<StayFromLink>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const input = stayLinkFormSchema.parse(raw);
    const added = await addStayFromLink(access, input, {
      userName: user.name,
    });
    revalidateTrip(tripId);
    return added;
  });
}
