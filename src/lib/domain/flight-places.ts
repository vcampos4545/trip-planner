/**
 * What a traveler types as a flight's From or To, and how a flight source's place suggestions turn
 * into the airports to search. The providers fetch the suggestions; the rules live here.
 *
 * A place is a 3-letter code in any case ("jfk"), a list of codes ("JFK, LGA"), a code inside a
 * label ("Boston (BOS)", "New York or JFK"), or a name ("New York", "Portland, OR", "New York City (Vaughn)"). When a
 * name fits more than one city that has its own airport, the candidates are returned for the
 * traveler to pick instead of searching the first one.
 */

export type PlaceInput =
  | { kind: "codes"; codes: string[] }
  | {
      kind: "name";
      /** The part before any comma, such as "Portland". */
      name: string;
      /** The part after the first comma, such as "OR" or "Portugal". */
      qualifier: string | null;
      /** The cleaned text, such as "Portland, OR". */
      text: string;
    };

/** One place a flight source suggested for a name. */
export type PlaceSuggestion = {
  /** How the source names it, such as "Portland, Oregon". */
  name: string;
  /** Extra words from the source, such as "City in Oregon" or a country code. */
  detail?: string | null;
  /** The codes to search for this place. */
  codes: string[];
  /** The city of each airport serving it, to tell a city with an airport from a town near one. */
  airportCities: string[];
};

/** A place the traveler can pick: what to show, and what to put in the field to pick it. */
export type PlaceCandidate = { label: string; value: string };

export type PlacePick =
  | { kind: "match"; place: PlaceSuggestion }
  | { kind: "ambiguous"; candidates: PlaceCandidate[] }
  | { kind: "none" };

export const MAX_PLACE_CANDIDATES = 5;

const CODE = /^[A-Za-z]{3}$/;

/**
 * IATA metropolitan area codes and the airports they cover. Google Flights searches airports, so
 * "NYC" becomes JFK, LGA, and EWR there. Codes that are also an airport (SHA, HOU, BER) are left
 * out so they keep meaning that airport.
 */
export const METRO_AIRPORTS: Record<string, string[]> = {
  BHZ: ["CNF", "PLU"],
  BJS: ["PEK", "PKX"],
  BUE: ["EZE", "AEP"],
  CHI: ["ORD", "MDW"],
  DTT: ["DTW"],
  JKT: ["CGK", "HLP"],
  LON: ["LHR", "LGW", "STN", "LTN", "LCY", "SEN"],
  MIL: ["MXP", "LIN", "BGY"],
  MOW: ["SVO", "DME", "VKO"],
  NYC: ["JFK", "LGA", "EWR"],
  OSA: ["KIX", "ITM", "UKB"],
  PAR: ["CDG", "ORY", "BVA"],
  REK: ["KEF", "RKV"],
  RIO: ["GIG", "SDU"],
  ROM: ["FCO", "CIA"],
  SAO: ["GRU", "CGH", "VCP"],
  SEL: ["ICN", "GMP"],
  STO: ["ARN", "BMA", "NYO"],
  TYO: ["HND", "NRT"],
  WAS: ["IAD", "DCA", "BWI"],
  YEA: ["YEG"],
  YMQ: ["YUL"],
  YTO: ["YYZ", "YTZ"],
};

const US_STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

/** Lowercase, without accents or punctuation, so "São Paulo" and "sao paulo" compare equal. */
function words(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function same(a: string, b: string) {
  return words(a) === words(b);
}

function contains(haystack: string, needle: string) {
  const n = words(needle);
  return n.length > 0 && ` ${words(haystack)} `.includes(` ${n} `);
}

function baseName(name: string) {
  return name.split(",")[0]!.trim();
}

/** Reads what was typed. Returns null when nothing usable is left, such as "()". */
export function parsePlaceInput(raw: string): PlaceInput | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (CODE.test(text)) return { kind: "codes", codes: [text.toUpperCase()] };
  // A list of codes: "jfk, lga", "JFK or LGA", "JFK/LGA".
  const list = text.split(/\s*,\s*|\s+or\s+|\s*\/\s*/);
  if (
    list.length > 1 &&
    list.every((part) => CODE.test(part)) &&
    (text.includes(",") || list.every((part) => /^[A-Z]{3}$/.test(part)))
  ) {
    return {
      kind: "codes",
      codes: [...new Set(list.map((part) => part.toUpperCase()))],
    };
  }
  // A code given with a label: "Boston (BOS)", "JFK - John F. Kennedy", "Lisbon - LIS", or the
  // form's own example, "New York or JFK".
  const labelled =
    /\(([A-Z]{3})\)/.exec(text) ??
    /^([A-Z]{3})\s*[-–—:|]\s+\S/.exec(text) ??
    /\S\s+(?:[-–—|]\s*|or\s+)([A-Z]{3})$/.exec(text);
  if (labelled) return { kind: "codes", codes: [labelled[1]!] };
  // Notes in brackets are not part of the place: "New York City (Vaughn)".
  const cleaned = text
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  if (!cleaned || !/[A-Za-z]/.test(cleaned)) return null;
  if (cleaned !== text) return parsePlaceInput(cleaned);
  const [name, ...rest] = cleaned.split(",");
  const qualifier = rest.join(",").trim() || null;
  return { kind: "name", name: name!.trim(), qualifier, text: cleaned };
}

/** The airports to search for a code: a metro code's airports, or the code itself. */
export function airportsForCode(code: string): string[] {
  return METRO_AIRPORTS[code.toUpperCase()] ?? [code.toUpperCase()];
}

function ownAirports(place: PlaceSuggestion) {
  const city = baseName(place.name);
  return place.airportCities.filter((value) => same(value, city)).length;
}

function matchesQualifier(
  place: PlaceSuggestion,
  input: Extract<PlaceInput, { kind: "name" }>,
) {
  if (same(place.name, input.text)) return true;
  const qualifier = input.qualifier!;
  const full = `${place.name} ${place.detail ?? ""}`;
  const state = US_STATES[qualifier.toUpperCase()];
  return contains(full, qualifier) || (state ? contains(full, state) : false);
}

/**
 * Picks the place a name means from a source's suggestions, which come best first.
 *
 * A qualifier narrows the list ("Portland, OR"). Among places named exactly what was typed, one
 * with its own airport wins over towns that only have one nearby ("Lisbon" is Lisbon, Portugal,
 * not Lisbon, Maine, 28 miles from Portland's airport). Two or more such cities are ambiguous
 * ("Portland" alone) unless the first has more airports of its own than any other. Anything else
 * goes with the source's first suggestion, as Google Flights itself does.
 */
export function pickPlace(
  input: Extract<PlaceInput, { kind: "name" }>,
  suggestions: PlaceSuggestion[],
): PlacePick {
  const usable = suggestions.filter((place) => place.codes.length > 0);
  const choice = choose(input, usable);
  if (choice.kind !== "ambiguous") return choice;
  return {
    kind: "ambiguous",
    candidates: choice.places
      .slice(0, MAX_PLACE_CANDIDATES)
      .map((place) => toCandidate(place, usable)),
  };
}

function choose(
  input: Extract<PlaceInput, { kind: "name" }>,
  usable: PlaceSuggestion[],
):
  | Exclude<PlacePick, { kind: "ambiguous" }>
  | { kind: "ambiguous"; places: PlaceSuggestion[] } {
  if (usable.length === 0) return { kind: "none" };
  let pool = usable;
  if (input.qualifier) {
    const narrowed = usable.filter((place) => matchesQualifier(place, input));
    if (narrowed.length > 0) pool = narrowed;
  }
  const named = pool.filter((place) => same(baseName(place.name), input.name));
  if (named.length === 0) return { kind: "match", place: pool[0]! };
  const owners = named.filter((place) => ownAirports(place) > 0);
  if (owners.length === 0) return { kind: "match", place: named[0]! };
  const [first, ...others] = owners;
  if (others.every((place) => ownAirports(first!) > ownAirports(place))) {
    return { kind: "match", place: first! };
  }
  return { kind: "ambiguous", places: owners };
}

/**
 * A candidate's value is its name when that name alone picks it ("Portland, Oregon"), otherwise
 * its codes, so picking a candidate never asks again.
 */
function toCandidate(
  place: PlaceSuggestion,
  usable: PlaceSuggestion[],
): PlaceCandidate {
  const label = `${place.name} (${place.codes.join(", ")})`;
  const byName = parsePlaceInput(place.name);
  const pick = byName?.kind === "name" ? choose(byName, usable) : undefined;
  const value =
    pick?.kind === "match" && pick.place === place
      ? place.name
      : place.codes.join(", ");
  return { label, value: value.slice(0, 80) };
}

/** "A", "A or B", "A, B, or C". */
export function listChoices(labels: string[]) {
  if (labels.length <= 2) return labels.join(" or ");
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}
