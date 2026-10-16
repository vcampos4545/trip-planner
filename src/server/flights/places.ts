import "server-only";

import {
  listChoices,
  type PlaceCandidate,
  type PlacePick,
} from "@/lib/domain/flight-places";
import type { ResolvedPlace } from "@/lib/flights";

import { FlightProviderError, type FlightSearchQuery } from "./types";

export type PlaceField = "origin" | "destination";

const FIELD_LABELS: Record<PlaceField, string> = {
  origin: "From",
  destination: "To",
};

/** One place that could not be searched as typed. */
export type PlaceIssue = {
  field: PlaceField;
  message: string;
  candidates: PlaceCandidate[];
};

/** A single place that matched nothing, or more than one city. */
export class PlaceLookupError extends FlightProviderError {
  constructor(
    kind: "unknown_place" | "ambiguous_place",
    message: string,
    readonly candidates: PlaceCandidate[] = [],
  ) {
    super(kind, message);
    this.name = "PlaceLookupError";
  }
}

/** From, To, or both could not be searched as typed. No flight search was run. */
export class RouteLookupError extends FlightProviderError {
  constructor(readonly issues: PlaceIssue[]) {
    super(
      issues.every((issue) => issue.candidates.length > 0)
        ? "ambiguous_place"
        : "unknown_place",
      issues
        .map((issue) => `${FIELD_LABELS[issue.field]}: ${issue.message}`)
        .join(" "),
    );
    this.name = "RouteLookupError";
  }
}

export function unknownPlace(query: string) {
  return new PlaceLookupError(
    "unknown_place",
    `No airport or city matches "${query.trim().slice(0, 80)}". Try a city name or a 3-letter airport code.`,
  );
}

/** Turns a pick into the place to search, or the error to show. */
export function fromPick(
  query: string,
  pick: PlacePick,
): Omit<ResolvedPlace, "query"> {
  if (pick.kind === "none") throw unknownPlace(query);
  if (pick.kind === "ambiguous") {
    throw new PlaceLookupError(
      "ambiguous_place",
      `"${query.trim().slice(0, 80)}" could be ${listChoices(pick.candidates.map((candidate) => candidate.label))}. Pick one.`,
      pick.candidates,
    );
  }
  return {
    iataCode: pick.place.codes[0]!,
    name: pick.place.name,
    ...(pick.place.codes.length > 1 ? { airportCodes: pick.place.codes } : {}),
  };
}

/**
 * Resolves From and To together, so a traveler who mistyped both hears about both at once. Place
 * problems are collected per field; any other failure, such as a quota error, is thrown as is.
 */
export async function resolveRoute(
  query: Pick<FlightSearchQuery, "origin" | "destination">,
  resolve: (place: string) => Promise<ResolvedPlace>,
): Promise<[ResolvedPlace, ResolvedPlace]> {
  const fields: PlaceField[] = ["origin", "destination"];
  const settled = await Promise.allSettled(
    fields.map((field) => resolve(query[field])),
  );
  const issues: PlaceIssue[] = [];
  const places: ResolvedPlace[] = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      places.push(result.value);
    } else if (result.reason instanceof PlaceLookupError) {
      issues.push({
        field: fields[index]!,
        message: result.reason.message,
        candidates: result.reason.candidates,
      });
    } else {
      throw result.reason;
    }
  }
  if (issues.length > 0) throw new RouteLookupError(issues);
  return [places[0]!, places[1]!];
}
