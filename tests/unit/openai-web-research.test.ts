import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInstructions } from "@/server/ai/prompts";
import { EMPTY_DRAFT } from "@/lib/domain/trip-details";
import {
  getResearchProvider,
  ResearchFailedError,
  ResearchUnavailableError,
  type ResearchQuery,
} from "@/server/research";
import {
  cleanUrl,
  OpenAiWebResearchProvider,
} from "@/server/research/openai-web";

type CreateFn = (
  body: Record<string, unknown>,
  options?: unknown,
) => Promise<unknown>;

function fakeClient(response: unknown) {
  const create = vi.fn<CreateFn>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return {
    client: { responses: { create } } as unknown as Pick<OpenAI, "responses">,
    create,
  };
}

const RETRIEVED = new Date("2026-10-15T12:00:00.000Z");

const QUERY: ResearchQuery = {
  category: "LODGING",
  query: "boutique hotel near the Pantheon",
  location: "Rome",
  limit: 6,
};

type Item = {
  title: string;
  url: string;
  sourceName: string;
  description: string | null;
  locationName: string | null;
  price: { amount: string; currency: string; unit: string | null } | null;
  availability: string | null;
};

function item(overrides: Partial<Item>): Item {
  return {
    title: "Hotel",
    url: "https://hotels.example/one",
    sourceName: "Hotels Example",
    description: null,
    locationName: null,
    price: null,
    availability: null,
    ...overrides,
  };
}

function webResponse({
  results,
  sources = [],
  citations = [],
  searchStatus = "completed",
  withSearch = true,
}: {
  results: Item[];
  sources?: string[];
  citations?: { url: string; title: string }[];
  searchStatus?: string;
  withSearch?: boolean;
}) {
  const text = JSON.stringify({ results });
  return {
    id: "resp_1",
    status: "completed",
    error: null,
    model: "gpt-test",
    output: [
      ...(withSearch
        ? [
            {
              type: "web_search_call",
              id: "ws_1",
              status: searchStatus,
              action: {
                type: "search",
                query: "boutique hotel Pantheon Rome",
                sources: sources.map((url) => ({ type: "url", url })),
              },
            },
          ]
        : []),
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text,
            annotations: citations.map((citation) => ({
              type: "url_citation",
              start_index: 0,
              end_index: 1,
              ...citation,
            })),
          },
        ],
      },
    ],
    output_text: text,
  };
}

function provider(response: unknown) {
  const fake = fakeClient(response);
  return {
    ...fake,
    provider: new OpenAiWebResearchProvider({
      client: fake.client,
      model: "gpt-test",
      contextSize: "low",
      now: () => RETRIEVED,
    }),
  };
}

describe("OpenAiWebResearchProvider", () => {
  it("sends one required web_search request with sources included and strict structured output", async () => {
    const { provider: research, create } = provider(
      webResponse({ results: [] }),
    );
    await research.search(QUERY);
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0]![0];
    expect(body).toMatchObject({
      model: "gpt-test",
      tools: [{ type: "web_search", search_context_size: "low" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(String(body.input)).toContain("boutique hotel near the Pantheon");
    expect(String(body.input)).toContain("Location: Rome");
  });

  it("keeps cited results with source, retrieval time, and stated price and availability", async () => {
    const { provider: research } = provider(
      webResponse({
        results: [
          item({
            title: "Hotel Pantheon View",
            url: "https://www.hotels.example/pantheon-view?utm_source=openai",
            sourceName: "Hotels Example",
            description: "Small hotel two minutes from the Pantheon.",
            locationName: "Rome",
            price: { amount: "1,240.50", currency: "eur", unit: "night" },
            availability: "Rooms available for May 20 to 24",
          }),
        ],
        sources: ["https://hotels.example/pantheon-view/"],
      }),
    );
    const [result, ...rest] = await research.search(QUERY);
    expect(rest).toHaveLength(0);
    expect(result).toMatchObject({
      title: "Hotel Pantheon View",
      url: "https://www.hotels.example/pantheon-view",
      sourceName: "Hotels Example",
      description: "Small hotel two minutes from the Pantheon.",
      priceAmount: "1240.50",
      priceCurrency: "EUR",
      priceUnit: "night",
      availabilityNote: "Rooms available for May 20 to 24",
      locationName: "Rome",
      retrievedAt: RETRIEVED,
    });
    expect(result!.payload).toMatchObject({
      provider: "openai_web",
      responseId: "resp_1",
      citedUrl: "https://hotels.example/pantheon-view/",
      searchQueries: ["boutique hotel Pantheon Rome"],
      retrievedAt: RETRIEVED.toISOString(),
    });
  });

  it("drops results whose page the search never consulted or cited", async () => {
    const { provider: research } = provider(
      webResponse({
        results: [
          item({ title: "Cited", url: "https://cited.example/a" }),
          item({
            title: "Made up",
            url: "https://invented.example/b",
            price: { amount: "99", currency: "EUR", unit: "night" },
          }),
          item({ title: "Annotated", url: "https://annotated.example/c" }),
        ],
        sources: ["https://cited.example/a"],
        citations: [{ url: "https://annotated.example/c", title: "Annotated" }],
      }),
    );
    const results = await research.search(QUERY);
    expect(results.map((result) => result.title)).toEqual([
      "Cited",
      "Annotated",
    ]);
  });

  it("drops prices that are not a plain amount with a currency code", async () => {
    const { provider: research } = provider(
      webResponse({
        results: [
          item({
            url: "https://a.example/1",
            price: { amount: "about 200", currency: "EUR", unit: null },
          }),
          item({
            title: "Second",
            url: "https://a.example/2",
            price: { amount: "200", currency: "euros", unit: null },
          }),
        ],
        sources: ["https://a.example/1", "https://a.example/2"],
      }),
    );
    const results = await research.search(QUERY);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.priceAmount).toBeNull();
      expect(result.priceCurrency).toBeNull();
    }
  });

  it("fails instead of returning model knowledge when no search ran", async () => {
    const { provider: research } = provider(
      webResponse({
        results: [item({ url: "https://a.example/1" })],
        withSearch: false,
      }),
    );
    await expect(research.search(QUERY)).rejects.toThrow(ResearchFailedError);
  });

  it("fails when the only search call failed", async () => {
    const { provider: research } = provider(
      webResponse({ results: [], searchStatus: "failed" }),
    );
    await expect(research.search(QUERY)).rejects.toThrow(/did not run/);
  });

  it("fails on output that is not the expected JSON", async () => {
    const response = webResponse({ results: [] });
    response.output_text = "Here are some hotels I know.";
    const { provider: research } = provider(response);
    await expect(research.search(QUERY)).rejects.toThrow(/unexpected format/);
  });

  it("turns API errors into a research failure with a useful message", async () => {
    const auth = new OpenAI.AuthenticationError(
      401,
      { message: "bad key" },
      "bad key",
      new Headers(),
    );
    await expect(provider(auth).provider.search(QUERY)).rejects.toThrow(
      "OpenAI rejected the API key used for web search.",
    );
    const limited = new OpenAI.RateLimitError(
      429,
      { message: "slow down" },
      "slow down",
      new Headers(),
    );
    await expect(provider(limited).provider.search(QUERY)).rejects.toThrow(
      /rate limiting/,
    );
    await expect(
      provider({
        ...webResponse({ results: [] }),
        status: "failed",
        error: { message: "boom" },
      }).provider.search(QUERY),
    ).rejects.toThrow("boom");
  });
});

describe("cleanUrl", () => {
  it("keeps http(s) URLs and strips tracking parameters and fragments", () => {
    expect(cleanUrl("https://a.example/x?utm_source=openai&id=2#top")).toBe(
      "https://a.example/x?id=2",
    );
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("not a url")).toBeNull();
  });
});

describe("getResearchProvider", () => {
  const saved = {
    provider: process.env.RESEARCH_PROVIDER,
    key: process.env.OPENAI_API_KEY,
  };
  afterEach(() => {
    process.env.RESEARCH_PROVIDER = saved.provider;
    process.env.OPENAI_API_KEY = saved.key;
  });

  it("is off when RESEARCH_PROVIDER is none or unset", async () => {
    for (const value of ["none", ""]) {
      process.env.RESEARCH_PROVIDER = value;
      const research = getResearchProvider();
      expect(research).toMatchObject({ id: "none", isConfigured: false });
      expect(research.unavailableReason).toBeUndefined();
      await expect(research.search(QUERY)).rejects.toThrow(
        ResearchUnavailableError,
      );
    }
  });

  it("selects OpenAI web search when the key is set", () => {
    process.env.RESEARCH_PROVIDER = "openai_web";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(getResearchProvider()).toMatchObject({
      id: "openai_web",
      label: "OpenAI web search",
      isConfigured: true,
    });
  });

  it("reports unavailable, not a fallback, when the key is missing", async () => {
    process.env.RESEARCH_PROVIDER = "openai_web";
    process.env.OPENAI_API_KEY = "";
    const research = getResearchProvider();
    expect(research).toMatchObject({ id: "openai_web", isConfigured: false });
    expect(research.unavailableReason).toMatch(/OPENAI_API_KEY is not set/);
    await expect(research.search(QUERY)).rejects.toThrow(
      /Live research is unavailable/,
    );
  });

  it("reports an unknown provider name instead of silently turning search off", () => {
    process.env.RESEARCH_PROVIDER = "bing";
    const research = getResearchProvider();
    expect(research.isConfigured).toBe(false);
    expect(research.unavailableReason).toMatch(/"bing" is not supported/);
  });
});

describe("buildInstructions with live search", () => {
  const base = {
    phase: "trip" as const,
    startMode: "KNOWN_DESTINATION" as const,
    draft: EMPTY_DRAFT,
    today: "2026-10-15",
    userName: "Riley",
  };

  it("tells Atlas to search sparingly, cite links, and not invent prices", () => {
    const instructions = buildInstructions({
      ...base,
      researchAvailable: true,
    });
    expect(instructions).toContain("Live search rules");
    expect(instructions).toMatch(/Call it only when/);
    expect(instructions).toMatch(/Markdown link/);
    expect(instructions).toMatch(/Never estimate or invent prices/);
  });

  it("says live research is unavailable when the provider cannot run", () => {
    const instructions = buildInstructions({
      ...base,
      researchAvailable: false,
      researchUnavailableReason: "OPENAI_API_KEY is not set on the server.",
    });
    expect(instructions).toContain("Live search is selected but unavailable");
    expect(instructions).not.toContain("Live search rules");
  });
});
