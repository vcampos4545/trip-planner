/**
 * Reads what a pasted listing link says about itself without opening it. The app never fetches
 * or scrapes the page: Airbnb has no public API and its terms prohibit scraping, so the traveler
 * types the price and details and the link is kept as the source.
 */

export type ListingSite = {
  /** Display name, such as "Airbnb". */
  name: string;
  /** The host as pasted, without "www.", such as "airbnb.com". */
  host: string;
  /** False for a site the app doesn't know, named from its host. */
  known: boolean;
};

export type ListingLink = {
  url: string;
  site: ListingSite;
  /** A name read from the link's path, when the site puts one there. The traveler can edit it. */
  suggestedName: string | null;
};

type KnownSite = {
  name: string;
  /** Registrable domains, matched on the host and its subdomains. */
  domains: string[];
  /** Reads a name from the path when the site's URLs carry one. */
  nameFrom?: (url: URL) => string | null;
};

const SITES: KnownSite[] = [
  { name: "Airbnb", domains: ["airbnb.com", "airbnb.co.uk", "airbnb.ca"] },
  { name: "Vrbo", domains: ["vrbo.com", "homeaway.com"] },
  {
    name: "Booking.com",
    domains: ["booking.com"],
    // /hotel/us/the-lodge-at-mountain-village.en-gb.html
    nameFrom: (url) =>
      slugName(/^\/hotel\/[a-z]{2}\/([^/.]+)/i.exec(url.pathname)?.[1]),
  },
  {
    name: "Expedia",
    domains: ["expedia.com", "expedia.co.uk", "expedia.ca"],
    // /Park-City-Hotels-Grand-Summit-Lodge.h12345.Hotel-Information
    nameFrom: (url) =>
      slugName(
        /\/[^/]*?-Hotels-([^/]+?)\.h\d+\.Hotel-Information/i.exec(
          url.pathname,
        )?.[1],
      ),
  },
  {
    name: "Hotels.com",
    domains: ["hotels.com"],
    // /ho123456/grand-summit-lodge-park-city-united-states-of-america/
    nameFrom: (url) => slugName(/^\/ho\d+\/([^/]+)/i.exec(url.pathname)?.[1]),
  },
  { name: "Marriott", domains: ["marriott.com"] },
  { name: "Hilton", domains: ["hilton.com"] },
  { name: "Hyatt", domains: ["hyatt.com"] },
  { name: "IHG", domains: ["ihg.com"] },
  { name: "Google Hotels", domains: ["google.com"] },
  { name: "Tripadvisor", domains: ["tripadvisor.com"] },
  { name: "Hostelworld", domains: ["hostelworld.com"] },
  { name: "Evolve", domains: ["evolve.com"] },
  { name: "Sonder", domains: ["sonder.com"] },
];

function slugName(slug: string | undefined): string | null {
  if (!slug) return null;
  let text: string;
  try {
    text = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const words = text
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (words.length < 3 || /^\d+$/.test(words)) return null;
  return words
    .split(" ")
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ")
    .slice(0, 160);
}

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "in",
  "of",
  "on",
  "the",
]);

function matches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** "stays.example.co.uk" to "Example", for a site the app doesn't know. */
function nameFromHost(host: string) {
  const parts = host.split(".");
  const secondLevel =
    parts.length > 2 && parts[parts.length - 2]!.length <= 3
      ? parts[parts.length - 3]
      : parts[parts.length - 2];
  const label = secondLevel ?? host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Recognises the site behind a listing link, or returns null when it isn't a web link. */
export function parseListingLink(raw: string): ListingLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return null;
  const site = SITES.find((candidate) =>
    candidate.domains.some((domain) => matches(host, domain)),
  );
  return {
    url: url.toString(),
    site: site
      ? { name: site.name, host, known: true }
      : { name: nameFromHost(host), host, known: false },
    suggestedName: site?.nameFrom?.(url) ?? null,
  };
}
