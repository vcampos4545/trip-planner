import "server-only";

import { z } from "zod";

/**
 * The one SerpApi account behind flight and stay search. Both share its search quota (the free
 * plan allows about 250 a month and 50 an hour), its key, and how its failures are explained.
 * Each search product passes its own wording and error class, so a quota message names what ran
 * out without the two products knowing about each other.
 */

export const SERPAPI_URL = "https://serpapi.com";
const REQUEST_TIMEOUT_MS = 30_000;

export type SerpApiErrorKind =
  | "auth"
  | "rate_limit"
  | "invalid_request"
  | "unavailable"
  | "timeout"
  | "bad_response";

/** How one search product names itself in error messages. */
export type SerpApiCopy<E extends Error> = {
  /** The Google product, such as "Google Flights". */
  service: string;
  /** What a search finds, plural, such as "flight searches". */
  searches: string;
  /** What is still usable when the quota runs out. */
  quotaFallback: string;
  /** Shown for a 400 without a detail from SerpApi. */
  invalidHint: string;
  toError: (kind: SerpApiErrorKind, message: string) => E;
};

export type SerpApiClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const errorSchema = z.object({ error: z.string() });

export class SerpApiClient<E extends Error> {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    options: SerpApiClientOptions,
    private readonly copy: SerpApiCopy<E>,
  ) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || SERPAPI_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Runs one search. Every call spends one search from the account's quota. */
  async request(
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/search.json`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    // The key travels in the query string as SerpApi requires. The URL is never logged.
    url.searchParams.set("api_key", this.apiKey);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw this.copy.toError(
          "timeout",
          `${this.copy.service} (via SerpApi) took too long to respond. Try again in a moment.`,
        );
      }
      throw this.copy.toError(
        "unavailable",
        "Couldn't reach SerpApi. Try again in a moment.",
      );
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) throw serpApiError(response.status, json, this.copy);
    if (json === null) throw this.badResponse();
    return json;
  }

  badResponse() {
    return this.copy.toError(
      "bad_response",
      "SerpApi sent a response the app couldn't read. Try again in a moment.",
    );
  }
}

/** Maps a SerpApi error to a message a traveler can act on. The key never appears in it. */
export function serpApiError<E extends Error>(
  status: number,
  body: unknown,
  copy: SerpApiCopy<E>,
): E {
  const parsed = errorSchema.safeParse(body);
  const detail = parsed.success ? parsed.data.error.trim() : "";
  if (status === 401 || status === 403) {
    return copy.toError(
      "auth",
      "SerpApi rejected the server's API key. Ask whoever runs this app to check SERPAPI_API_KEY.",
    );
  }
  if (status === 429) {
    return copy.toError(
      "rate_limit",
      /run out of searches|searches for the month|plan/i.test(detail)
        ? `The app's SerpApi account has used all of its ${copy.searches} for now (the free plan allows about 250 a month, shared by flight and stay search). ${copy.quotaFallback} Try again after the quota resets.`
        : `Too many ${copy.searches} in the last hour (SerpApi's free plan allows about 50 an hour). Wait a while and try again.`,
    );
  }
  if (status === 400) {
    return copy.toError(
      "invalid_request",
      detail
        ? `${copy.service} couldn't run this search: ${detail.replace(/api_key\S*/gi, "").slice(0, 240)}`
        : `${copy.service} couldn't run this search. ${copy.invalidHint}`,
    );
  }
  return copy.toError(
    "unavailable",
    "SerpApi is having trouble right now. Try the search again in a moment.",
  );
}
