/**
 * Stay search shapes and formatting shared by the server, the UI, and Atlas. Nothing here depends
 * on a specific vendor: providers map their responses into these types.
 */

export const STAY_KINDS = ["hotel", "vacation_rental"] as const;
export type StayKind = (typeof STAY_KINDS)[number];

export const STAY_KIND_LABELS: Record<StayKind, string> = {
  hotel: "Hotel",
  vacation_rental: "Vacation rental",
};

export const STAY_SORTS = [
  "relevance",
  "lowest_price",
  "highest_rating",
  "most_reviewed",
] as const;
export type StaySort = (typeof STAY_SORTS)[number];

export const STAY_SORT_LABELS: Record<StaySort, string> = {
  relevance: "Best match",
  lowest_price: "Lowest price",
  highest_rating: "Highest rating",
  most_reviewed: "Most reviewed",
};

export const MAX_STAY_GUESTS = 20;
export const MAX_STAY_BEDROOMS = 12;
export const MAX_STAY_NIGHTS = 30;

/** One price for the stay as one listing site quoted it. */
export type StayPriceSource = {
  source: string;
  /** Decimal string per night, as the source showed it. */
  nightlyAmount: string | null;
};

/** One priced place to stay returned by a stay search provider. */
export type StayOffer = {
  offerId: string;
  name: string;
  kind: StayKind;
  description: string | null;
  /** 1 to 5 for hotels that have a star class. */
  hotelClass: number | null;
  /** Average guest rating out of 5, as the source showed it. */
  rating: number | null;
  reviews: number | null;
  /** Facts the source listed, such as "Sleeps 10" or "4 bedrooms". */
  essentialInfo: string[];
  amenities: string[];
  /** Lowest nightly rate including taxes and fees, as a decimal string. */
  nightlyAmount: string | null;
  /** Lowest total for the whole stay including taxes and fees, when the source gave one. */
  totalAmount: string | null;
  currency: string;
  /** Where the prices came from, such as Booking.com or Vrbo, cheapest first. */
  priceSources: StayPriceSource[];
  sponsored: boolean;
  latitude: number | null;
  longitude: number | null;
  /** As the source wrote it, such as "3:00 PM". */
  checkInTime: string | null;
  checkOutTime: string | null;
  imageUrl: string | null;
  /** The property's own website, when the source listed one. */
  propertyUrl: string | null;
  /** Where to see the place and its prices to book outside the app. */
  bookingUrl: string;
  /** The provider's token for loading this property's details later. */
  propertyToken: string | null;
  /** The searched place, such as "Park City, Utah". */
  location: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  /** ISO timestamp of the search that returned this result. */
  retrievedAt: string;
  sourceName: string;
  providerId: string;
};

export type StaySearchSummary = {
  location: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  kind: StayKind;
  bedrooms: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  sort: StaySort;
  currency: string;
};

export function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function nightsLabel(nights: number) {
  return nights === 1 ? "1 night" : `${nights} nights`;
}

export function guestsLabel(guests: number) {
  return guests === 1 ? "1 guest" : `${guests} guests`;
}

/**
 * A link to the place on Google's hotel search, where the traveler sets their dates and books
 * with a site of their choice. The app never books.
 */
export function googleHotelsUrl(name: string, location: string): string {
  const q = [name, location].filter(Boolean).join(", ");
  return `https://www.google.com/travel/search?q=${encodeURIComponent(q)}`;
}

/** "Hotel, 4-star, 4.5/5 from 812 reviews, Sleeps 10, 4 bedrooms" for notes and Atlas output. */
export function describeStay(offer: StayOffer): string {
  return [
    STAY_KIND_LABELS[offer.kind],
    offer.hotelClass ? `${offer.hotelClass}-star` : null,
    offer.rating !== null
      ? `rated ${offer.rating.toFixed(1)}/5${offer.reviews ? ` from ${offer.reviews} reviews` : ""}`
      : null,
    ...offer.essentialInfo.slice(0, 4),
  ]
    .filter(Boolean)
    .join(", ");
}

/** "212.00 USD a night, 636.00 USD total for 3 nights" from what the source quoted. */
export function describeStayPrice(offer: StayOffer): string {
  const parts = [
    offer.nightlyAmount
      ? `${offer.nightlyAmount} ${offer.currency} a night`
      : null,
    offer.totalAmount
      ? `${offer.totalAmount} ${offer.currency} total for ${nightsLabel(offer.nights)}`
      : "total not shown",
  ];
  return parts.filter(Boolean).join(", ");
}

/** Minutes after midnight from "3:00 PM" or "15:00", or null when it can't be read. */
export function clockToMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}
