import { describeStayPrice, type StayOffer } from "@/lib/stays";

/**
 * Atlas keeps the stay results it showed in a conversation, so "save the second one" or "we
 * booked the Grand Summit" resolves to the exact result, with its price, source, and retrieval
 * time. A name that fits more than one shown stay is reported as ambiguous so Atlas asks.
 */

export type ShownStay = { resultId: string; offer: StayOffer };

export type StayReference = {
  resultId: string | null;
  /** All or part of the place's name, as the user said it. */
  name: string | null;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

/** Shown stays that fit the reference, most recent first. */
export function matchShownStays(
  shown: ShownStay[],
  reference: StayReference,
): ShownStay[] {
  if (reference.resultId) {
    const exact = shown.filter((item) => item.resultId === reference.resultId);
    if (exact.length > 0) return exact;
  }
  const name = reference.name ? normalize(reference.name) : "";
  if (!name) return [];
  const words = name.split(" ");
  const byName = shown.filter((item) => {
    const candidate = normalize(item.offer.name);
    const candidateWords = new Set(candidate.split(" "));
    return (
      candidate.includes(name) ||
      name.includes(candidate) ||
      words.every((word) => candidateWords.has(word))
    );
  });
  // The same place shown by two searches is one stay: keep the latest showing of each.
  const seen = new Set<string>();
  return [...byName].reverse().filter((item) => {
    const key = `${normalize(item.offer.name)}|${item.offer.checkIn}|${item.offer.checkOut}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function describeShownStay(item: ShownStay) {
  const { offer } = item;
  return `${offer.name} (${offer.kind === "vacation_rental" ? "vacation rental" : "hotel"}), ${offer.checkIn} to ${offer.checkOut}, ${describeStayPrice(offer)}`;
}

/** Checks the shape of a stored result before it is trusted again. */
export function isShownStay(value: unknown): value is ShownStay {
  if (!value || typeof value !== "object") return false;
  const item = value as { resultId?: unknown; offer?: unknown };
  if (typeof item.resultId !== "string" || !/^s\d+$/.test(item.resultId))
    return false;
  const offer = item.offer as Partial<StayOffer> | null;
  return Boolean(
    offer &&
    typeof offer.offerId === "string" &&
    typeof offer.name === "string" &&
    typeof offer.currency === "string" &&
    typeof offer.checkIn === "string" &&
    typeof offer.checkOut === "string" &&
    typeof offer.retrievedAt === "string" &&
    typeof offer.sourceName === "string" &&
    typeof offer.bookingUrl === "string" &&
    (offer.kind === "hotel" || offer.kind === "vacation_rental") &&
    Array.isArray(offer.priceSources) &&
    Array.isArray(offer.essentialInfo) &&
    Array.isArray(offer.amenities),
  );
}

/** The next free stay result ID, so IDs stay unique across turns of one conversation. */
export function nextStayResultId(existing: Iterable<string>) {
  let max = 0;
  for (const id of existing) {
    const number = Number(/^s(\d+)$/.exec(id)?.[1] ?? 0);
    if (number > max) max = number;
  }
  return `s${max + 1}`;
}
