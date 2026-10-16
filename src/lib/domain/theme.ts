import type { TaskPriority, TripTheme } from "@/generated/prisma/enums";
import { eachDay } from "@/lib/dates";

/**
 * Trip themes. Atlas records a theme only when the group says it (for example "we're skiing"). When
 * the theme is only implied by context, such as a winter trip to well-known ski towns, Atlas asks
 * one short question instead of assuming. The decision is made here so it is the same every time.
 */

type Hemisphere = "north" | "south";

/** Well-known ski destinations. Matching is by whole words, so "Park City" matches "Park City, UT". */
export const SKI_DESTINATIONS: { name: string; hemisphere: Hemisphere }[] = [
  ...[
    "Park City",
    "Deer Valley",
    "Alta",
    "Snowbird",
    "Brighton",
    "Solitude",
    "Snowbasin",
    "Jackson Hole",
    "Big Sky",
    "Aspen",
    "Snowmass",
    "Vail",
    "Beaver Creek",
    "Breckenridge",
    "Keystone",
    "Telluride",
    "Steamboat",
    "Crested Butte",
    "Winter Park",
    "Copper Mountain",
    "Arapahoe Basin",
    "Sun Valley",
    "Mammoth",
    "Lake Tahoe",
    "Palisades Tahoe",
    "Heavenly",
    "Taos",
    "Whistler",
    "Banff",
    "Lake Louise",
    "Revelstoke",
    "Mont Tremblant",
    "Stowe",
    "Killington",
    "Sugarbush",
    "Chamonix",
    "Zermatt",
    "Verbier",
    "St. Moritz",
    "St. Anton",
    "Kitzbühel",
    "Val d'Isère",
    "Courchevel",
    "Méribel",
    "Val Thorens",
    "Cortina d'Ampezzo",
    "Niseko",
    "Hakuba",
  ].map((name) => ({ name, hemisphere: "north" as const })),
  ...[
    "Queenstown",
    "Wanaka",
    "Thredbo",
    "Perisher",
    "Portillo",
    "Valle Nevado",
  ].map((name) => ({ name, hemisphere: "south" as const })),
];

/** Months (1 to 12) that are ski season in each hemisphere. */
const SKI_SEASON: Record<Hemisphere, number[]> = {
  north: [12, 1, 2, 3, 4],
  south: [6, 7, 8, 9],
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const SKI_WORDS =
  /\b(ski|skis|skiing|skier|skiers|snowboard\w*|apr[eè]s[- ]ski|lift pass\w*)\b/i;
const BEACH_WORDS = /\b(beach|beaches|snorkel\w*|surf|surfing)\b/i;

export type ThemeContext = {
  theme: TripTheme | null;
  tripStyle: string | null;
  preferences: { description: string }[];
  destination: string | null;
  stops: { name: string }[];
  candidateDestinations?: { name: string }[];
  startDate: string | null;
  endDate: string | null;
  dateNotes: string | null;
};

export type ThemeHint =
  | { kind: "stated"; theme: TripTheme; reason: string }
  | { kind: "ask"; theme: TripTheme; question: string; reason: string };

function wholeWord(haystack: string, needle: string) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, "iu").test(
    haystack,
  );
}

export function skiDestinationsIn(places: string[]) {
  const found: { name: string; hemisphere: Hemisphere }[] = [];
  for (const place of places) {
    for (const destination of SKI_DESTINATIONS) {
      if (
        wholeWord(place, destination.name) &&
        !found.some((item) => item.name === destination.name)
      )
        found.push(destination);
    }
  }
  return found;
}

/** Calendar months the trip touches, from exact dates or month names in the timing notes. */
export function tripMonths(context: {
  startDate: string | null;
  endDate: string | null;
  dateNotes: string | null;
}): number[] {
  const months = new Set<number>();
  if (context.startDate) {
    for (const day of eachDay(
      context.startDate,
      context.endDate ?? context.startDate,
      370,
    ))
      months.add(Number(day.slice(5, 7)));
  }
  const notes = context.dateNotes?.toLowerCase() ?? "";
  MONTHS.forEach((month, index) => {
    if (wholeWord(notes, month) || wholeWord(notes, month.slice(0, 3)))
      months.add(index + 1);
  });
  if (/\b(winter|christmas|new year'?s?|holidays)\b/.test(notes)) {
    months.add(12);
    months.add(1);
  }
  if (/\bspring break\b/.test(notes)) months.add(3);
  return [...months];
}

function monthName(month: number) {
  const name = MONTHS[month - 1]!;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * What Atlas should do about the theme this turn: record a theme the user stated, ask one short
 * question when context only implies it, or nothing. Never assumes a theme from context alone.
 */
export function themeHint(context: ThemeContext): ThemeHint | null {
  if (context.theme) return null;
  const said = [
    context.tripStyle ?? "",
    ...context.preferences.map((preference) => preference.description),
  ].join(" \n ");
  if (SKI_WORDS.test(said))
    return {
      kind: "stated",
      theme: "SKI",
      reason: "the user mentioned skiing or snowboarding",
    };
  if (BEACH_WORDS.test(said))
    return {
      kind: "stated",
      theme: "BEACH",
      reason: "the user mentioned the beach",
    };

  const places = [
    context.destination ?? "",
    ...context.stops.map((stop) => stop.name),
    ...(context.candidateDestinations ?? []).map((place) => place.name),
  ].filter(Boolean);
  const resorts = skiDestinationsIn(places);
  if (resorts.length === 0) return null;
  const months = tripMonths(context);
  const inSeason = months.filter((month) =>
    resorts.some((resort) => SKI_SEASON[resort.hemisphere].includes(month)),
  );
  if (inSeason.length === 0) return null;
  const names = resorts.map((resort) => resort.name);
  const listed =
    names.length === 1
      ? `${names[0]} is a well-known ski destination`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are well-known ski destinations`;
  return {
    kind: "ask",
    theme: "SKI",
    question: "Is this a ski trip?",
    reason: `${monthName(inSeason[0]!)} is ski season and ${listed}`,
  };
}

/** Titles the app generated on its own, which Atlas may offer to improve once the theme is known. */
export function isAutomaticTitle(
  title: string | null,
  context: {
    destination: string | null;
    stops: { name: string }[];
    candidateDestinations?: { name: string }[];
  },
) {
  if (!title) return true;
  const normalized = title.trim().toLowerCase();
  if (["new trip", "trip to be discovered"].includes(normalized)) return true;
  const places = [
    context.destination,
    ...context.stops.map((stop) => stop.name),
    ...(context.candidateDestinations ?? []).map((place) => place.name),
  ].filter((place): place is string => Boolean(place));
  return places.some(
    (place) =>
      normalized === `${place.trim().toLowerCase()} trip` ||
      normalized === place.trim().toLowerCase(),
  );
}

export type ThemeTask = {
  title: string;
  description: string;
  priority: TaskPriority;
};

/** Practical tasks that come with a theme. Atlas suggests them; a member accepts each one. */
export const THEME_TASKS: Partial<Record<TripTheme, ThemeTask[]>> = {
  SKI: [
    {
      title: "Reserve ski or snowboard rentals",
      description:
        "Compare rental shops near each stop and reserve gear for everyone who needs it. Busy weeks sell out.",
      priority: "HIGH",
    },
    {
      title: "Buy lift passes",
      description:
        "Check whether a multi-resort pass covers each mountain, or buy lift tickets ahead. Online prices are often lower than at the window.",
      priority: "HIGH",
    },
    {
      title: "Book ski or snowboard lessons",
      description:
        "Lessons fill up early in peak season. Book for anyone who wants one.",
      priority: "MEDIUM",
    },
    {
      title: "Check ski gear and warm layers",
      description:
        "Helmet, goggles, gloves, base layers, and anything you would rather bring than rent.",
      priority: "LOW",
    },
  ],
  BEACH: [
    {
      title: "Plan beach gear",
      description:
        "Sunscreen, swimwear, and whether chairs or umbrellas are worth renting there.",
      priority: "LOW",
    },
    {
      title: "Check beach access and parking",
      description:
        "Some beaches need permits, reservations, or early arrival for parking.",
      priority: "MEDIUM",
    },
  ],
  OUTDOORS: [
    {
      title: "Check trail conditions and permits",
      description:
        "Some trails and parks need permits or timed entry, and conditions change by season.",
      priority: "MEDIUM",
    },
    {
      title: "Plan hiking gear",
      description: "Footwear, layers, water, and anything to rent locally.",
      priority: "LOW",
    },
  ],
};
