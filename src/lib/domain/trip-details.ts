import { z } from "zod";

import {
  ArrangementStatus,
  BudgetBasis,
  BudgetComponent,
  DateFlexibility,
  PreferenceKind,
  PreferenceStrength,
  TripTheme,
  type TripStartMode,
} from "@/generated/prisma/enums";
import { isDateOnly } from "@/lib/dates";
import { isMoneyString } from "@/lib/money";

import { MAX_STOPS, stopInputSchema } from "./stops";

/**
 * The structured trip profile that Atlas reads and updates.
 *
 * The same shape backs three things: the draft kept on a conversation before the trip exists,
 * the editable details of an existing trip, and the small patches Atlas proposes after each
 * message. Unknown values are null (or UNKNOWN for enums), never guessed.
 */

const dateOnly = z.string().refine(isDateOnly, "Use a YYYY-MM-DD date");
const money = z
  .string()
  .refine(isMoneyString, "Use a plain amount like 1500 or 1500.00");
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code like USD")
  .transform((value) => value.toUpperCase());

export const tripDetailsSchema = z.object({
  title: z.string().trim().min(1).max(120).nullable(),
  summary: z.string().trim().max(1000).nullable(),
  destination: z.string().trim().max(160).nullable(),
  destinationConfirmed: z.boolean(),
  departureLocation: z.string().trim().max(160).nullable(),
  flyIntoAirport: z.string().trim().max(160).nullable(),
  flyOutOfAirport: z.string().trim().max(160).nullable(),
  tripStyle: z.string().trim().max(300).nullable(),
  theme: z.enum(TripTheme).nullable(),
  startDate: dateOnly.nullable(),
  endDate: dateOnly.nullable(),
  dateFlexibility: z.enum(DateFlexibility),
  dateNotes: z.string().trim().max(300).nullable(),
  durationDays: z.number().int().min(1).max(365).nullable(),
  groupSize: z.number().int().min(1).max(500).nullable(),
  groupNotes: z.string().trim().max(500).nullable(),
  budgetAmount: money.nullable(),
  budgetCurrency: currency.nullable(),
  budgetBasis: z.enum(BudgetBasis),
  budgetIncludes: z.array(z.enum(BudgetComponent)).max(5),
  budgetNotes: z.string().trim().max(300).nullable(),
  flightsStatus: z.enum(ArrangementStatus),
  lodgingStatus: z.enum(ArrangementStatus),
  localTransportStatus: z.enum(ArrangementStatus),
  activitiesStatus: z.enum(ArrangementStatus),
});

export type TripDetails = z.infer<typeof tripDetailsSchema>;
export type TripDetailField = keyof TripDetails;

export const TRIP_DETAIL_FIELDS = Object.keys(
  tripDetailsSchema.shape,
) as TripDetailField[];

export const EMPTY_TRIP_DETAILS: TripDetails = {
  title: null,
  summary: null,
  destination: null,
  destinationConfirmed: false,
  departureLocation: null,
  flyIntoAirport: null,
  flyOutOfAirport: null,
  tripStyle: null,
  theme: null,
  startDate: null,
  endDate: null,
  dateFlexibility: "UNKNOWN",
  dateNotes: null,
  durationDays: null,
  groupSize: null,
  groupNotes: null,
  budgetAmount: null,
  budgetCurrency: null,
  budgetBasis: "UNKNOWN",
  budgetIncludes: [],
  budgetNotes: null,
  flightsStatus: "UNKNOWN",
  lodgingStatus: "UNKNOWN",
  localTransportStatus: "UNKNOWN",
  activitiesStatus: "UNKNOWN",
};

export const preferenceInputSchema = z.object({
  kind: z.enum(PreferenceKind),
  strength: z.enum(PreferenceStrength),
  description: z.string().trim().min(2).max(300),
});
export type PreferenceInput = z.infer<typeof preferenceInputSchema>;

export const candidateDestinationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  reason: z.string().trim().max(500).nullable(),
  suggestedBy: z.enum(["user", "atlas"]),
});
export type CandidateDestination = z.infer<typeof candidateDestinationSchema>;

/** Draft kept on a conversation before there is enough to create a trip. */
export const tripDraftSchema = z.object({
  details: tripDetailsSchema,
  preferences: z.array(preferenceInputSchema).max(40),
  candidateDestinations: z.array(candidateDestinationSchema).max(12),
  stops: z.array(stopInputSchema).max(MAX_STOPS),
});
export type TripDraft = z.infer<typeof tripDraftSchema>;

export const EMPTY_DRAFT: TripDraft = {
  details: EMPTY_TRIP_DETAILS,
  preferences: [],
  candidateDestinations: [],
  stops: [],
};

/** Reads a stored draft. Drafts saved before a field existed get that field's empty value. */
export function parseDraft(value: unknown): TripDraft {
  const stored =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const details =
    stored.details && typeof stored.details === "object" ? stored.details : {};
  const parsed = tripDraftSchema.safeParse({
    preferences: [],
    candidateDestinations: [],
    stops: [],
    ...stored,
    details: { ...EMPTY_TRIP_DETAILS, ...details },
  });
  return parsed.success ? parsed.data : EMPTY_DRAFT;
}

/** A partial update. Absent or null fields mean "not mentioned", never "clear this value". */
export const tripDetailsPatchSchema = tripDetailsSchema.partial();
export type TripDetailsPatch = z.infer<typeof tripDetailsPatchSchema>;

export type FieldChange = {
  field: TripDetailField;
  from: unknown;
  to: unknown;
};

export function isEmptyValue(field: TripDetailField, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (field === "destinationConfirmed") return value === false;
  return value === "UNKNOWN";
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      [...a].sort().join("|") === [...b].sort().join("|")
    );
  }
  if (typeof a === "string" && typeof b === "string")
    return a.trim() === b.trim();
  return a === b;
}

/**
 * Splits a patch into changes that fill unknown fields and changes that would overwrite a value
 * someone already set. Callers apply fills directly and treat overwrites as proposals.
 */
export function classifyPatch(current: TripDetails, patch: TripDetailsPatch) {
  const fills: FieldChange[] = [];
  const overwrites: FieldChange[] = [];
  for (const field of TRIP_DETAIL_FIELDS) {
    if (!(field in patch)) continue;
    const next = patch[field];
    if (isEmptyValue(field, next)) continue;
    const previous = current[field];
    if (sameValue(previous, next)) continue;
    if (isEmptyValue(field, previous))
      fills.push({ field, from: previous, to: next });
    else overwrites.push({ field, from: previous, to: next });
  }
  return { fills, overwrites };
}

export function applyChanges(
  current: TripDetails,
  changes: FieldChange[],
): TripDetails {
  const next: TripDetails = { ...current };
  for (const change of changes) {
    (next as Record<string, unknown>)[change.field] = change.to;
  }
  return next;
}

/** Checks rules that span fields. Returns a message or null. */
export function crossFieldProblem(details: TripDetails): string | null {
  if (
    details.startDate &&
    details.endDate &&
    details.endDate < details.startDate
  ) {
    return "The end date is before the start date.";
  }
  return null;
}

export function mergeCandidates(
  existing: CandidateDestination[],
  incoming: CandidateDestination[],
): CandidateDestination[] {
  const result = [...existing];
  for (const candidate of incoming) {
    const key = candidate.name.trim().toLowerCase();
    if (result.some((item) => item.name.trim().toLowerCase() === key)) continue;
    result.push(candidate);
  }
  return result.slice(0, 12);
}

export function mergePreferences(
  existing: PreferenceInput[],
  incoming: PreferenceInput[],
) {
  const result = [...existing];
  for (const preference of incoming) {
    const key = `${preference.kind}:${preference.description.trim().toLowerCase()}`;
    if (
      result.some(
        (item) =>
          `${item.kind}:${item.description.trim().toLowerCase()}` === key,
      )
    )
      continue;
    result.push(preference);
  }
  return result.slice(0, 40);
}

/**
 * A draft becomes a trip once it has a sense of where (a destination, candidates, or a vibe)
 * plus one more anchor, or a named destination on its own.
 */
export function isEstablishable(draft: TripDraft): boolean {
  const d = draft.details;
  if (d.destination || draft.stops.length > 0) return true;
  const hasWhere =
    draft.candidateDestinations.length > 0 || Boolean(d.tripStyle);
  const hasAnchor =
    Boolean(d.startDate || d.dateNotes || d.durationDays) ||
    Boolean(d.departureLocation) ||
    d.groupSize !== null ||
    Boolean(d.groupNotes) ||
    d.budgetAmount !== null;
  return hasWhere && hasAnchor;
}

export function deriveTitle(
  draft: TripDraft,
  mode?: TripStartMode | null,
): string {
  const d = draft.details;
  if (d.title) return d.title;
  if (d.destination) return `${d.destination} trip`;
  if (draft.stops.length > 0)
    return `${draft.stops
      .slice(0, 2)
      .map((stop) => stop.name)
      .join(" and ")} trip`;
  const names = draft.candidateDestinations.map((candidate) => candidate.name);
  if (names.length === 1) return `${names[0]} trip`;
  if (names.length > 1) return `${names.slice(0, 2).join(" or ")}?`;
  if (d.tripStyle) {
    const style =
      d.tripStyle.length > 48 ? `${d.tripStyle.slice(0, 45)}...` : d.tripStyle;
    return style.charAt(0).toUpperCase() + style.slice(1);
  }
  if (mode === "DISCOVER") return "Trip to be discovered";
  return "New trip";
}
