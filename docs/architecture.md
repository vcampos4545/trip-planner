# Architecture

This document describes how the MVP is put together and where future features plug in.

## Request flow

```
Browser
  │  React Server Components render pages; client components call server actions
  ▼
src/app (routes)  ──►  src/server/actions (auth + Zod parsing + revalidation)
                              │
                              ▼
                     src/server/services (membership checks, transactions,
                              │          optimistic concurrency, activity log)
                              ▼
                     Prisma 7 + pg driver adapter  ──►  PostgreSQL
```

Atlas follows the same path. The orchestrator calls the same services the UI uses, so the AI can
never do something the signed-in user could not do by hand.

- `src/proxy.ts` only redirects visitors without a session cookie. It is an optimization, not the
  security boundary.
- Every page calls `requireUser()`, and every service resolves membership with
  `requireTripAccess(tripId, userId)` before touching trip data. A non-member gets the same
  "not found" response as a trip that does not exist, so trip IDs cannot be probed.
- Child records are always looked up with both their ID and the caller's trip ID
  (`findFirst({ where: { id, tripId } })`). A valid ID from another trip is not found.
- Organizer-only operations (invites, member management, resolving decisions, deleting the trip,
  approving options) use `requireOrganizer`.

## Data model

The Prisma schema (`prisma/schema.prisma`) is normalized around `Trip`:

| Area         | Tables                                                                  |
| ------------ | ----------------------------------------------------------------------- |
| Identity     | `User`, `Account`, `Session`, `VerificationToken` (Auth.js)             |
| Membership   | `TripMember` (organizer or member), `TripInvitation` (hashed tokens)    |
| Trip profile | `Trip` (structured details), `TripPreference` (requirement vs. wish)    |
| Atlas        | `Conversation` (one per user per trip), `Message`, `TripDetailProposal` |
| Research     | `ResearchOption` (with provenance), `OptionNote`                        |
| Decisions    | `Decision`, `DecisionChoice`, `Vote` (one per member per decision)      |
| Work         | `Task` (with assignee, links to options, bookings, events)              |
| Itinerary    | `ItineraryEvent` (local date plus minutes, map-friendly location)       |
| Bookings     | `Booking`, `BookingParticipant` (per-traveler status, share, room)      |
| History      | `ActivityLog`                                                           |

Notes:

- Unknown is stored as unknown: nullable columns, `UNKNOWN` enum values, and a null price meaning
  "unpriced", never zero.
- Calendar dates are `DATE` columns plus minutes after midnight, because itineraries are planned
  in destination local time.
- JSON is used only for the pre-trip draft on a conversation, proposed patches, message tool
  summaries, provider payloads, and activity metadata.
- Records that several people edit (`Trip`, `Task`, `ResearchOption`, `ItineraryEvent`,
  `Booking`) carry a `version` column. Updates use `updateMany({ where: { id, version } })` and a
  stale version returns a conflict that the UI explains with a reload action.
- Multi-row changes run in transactions and write an `ActivityLog` entry in the same transaction.

## Statuses and what they mean

- Saved options: suggested, shortlisted, approved, booked, rejected, cancelled. Any member can
  shortlist or reject; organizers approve. "Booked" is never set by hand. It follows from a booking
  record linked to the option that is booked or confirmed.
- Decisions: members vote; an organizer resolves. Resolving approves the linked option. It does not
  create or imply a booking.
- Tasks: open, in progress, completed, cancelled, plus "suggested" for Atlas proposals that a member
  must accept.
- Itinerary: suggested (Atlas, shown apart from the plan), planned, confirmed.
- Bookings: not booked yet, booked, confirmed, cancelled. Each traveler on a booking is either
  booked or considering, so one flight record can hold people at different stages.

## Budget

`src/lib/domain/budget.ts` summarizes bookings in integer cents per currency. A cost is either a
shared total split equally, a per-traveler price, or custom shares. Cancelled bookings are ignored,
unpriced bookings are listed separately, a considering traveler's share counts as an estimate, and
anything not attributable to a person is shown as unassigned.

## Atlas

### Orchestrator

`src/server/ai/orchestrator.ts` handles one message:

1. Loads the conversation (owned by the caller) and re-checks trip membership.
2. Saves the user message.
3. Builds instructions with the known details and the next most useful topics
   (`src/lib/domain/follow-up.ts`), so Atlas does not re-ask for known information.
4. Calls the provider with the tool list for the phase (draft or trip).
5. Saves the reply with the model name and a summary of what the tools did.
6. On provider failure, saves a notice instead of a reply, and lists any changes that tools
   committed before the failure.
7. In the draft phase, creates the trip once the draft is established (a destination, or ideas or
   a vibe plus one more detail). The user can also create it at any time.

### Tools

Defined in `src/server/ai/tools.ts`, each with a Zod schema that doubles as a strict JSON schema:

| Tool                              | Effect                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| `get_trip_state`                  | Read the shared trip record                                    |
| `update_trip_details`             | Fill unknown details; changes to known values become proposals |
| `search_options`                  | Query the research provider (only when current info is needed) |
| `save_research_option`            | Save a suggestion, with provenance if it came from a search    |
| `list_saved_research`             | Reuse what the group already saved                             |
| `search_flights`                  | Query the flight provider (Duffel test mode today)             |
| `save_flight_option`              | Save a flight result from this turn as a suggested option      |
| `suggest_task`                    | Create a task in "suggested" state                             |
| `propose_itinerary_event`         | Create an itinerary item in "suggested" state                  |
| `summarize_outstanding_decisions` | Open votes, proposals, suggestions, unassigned tasks, gaps     |

Rules enforced in code, not just in the prompt:

- Arguments are parsed and validated before any write. Invalid input returns an error to the model
  and changes nothing.
- Before the trip exists, the draft belongs to one user, so stated changes apply directly. On a
  shared trip, Atlas fills unknown fields but never overwrites a value; it creates a
  `TripDetailProposal` that a member accepts or declines.
- Options saved without a search result have no price, no link, and no retrieval time, and are
  labelled as Atlas ideas. A search result's source, price, and retrieval time are copied from the
  provider's response, never from the model's text.
- Proposed itinerary items must fall within the trip dates and carry a rationale and caveats.
- The UI shows the tool effects under each reply, so what Atlas says it did can be checked against
  what actually happened.
- When a reply follows live searches, the orchestrator stores the results' titles, URLs, source
  names, and retrieval times in the message metadata (`sources`), and the chat lists them as links
  under the reply. Atlas is also told to cite results inline as Markdown links.
- A failed search is returned to the model as `{ available: false, failed: true }` and recorded as
  a "Live research failed" effect. A provider that is selected but cannot run reports "Live
  research is unavailable". In both cases nothing is saved as a live result.
- Flight answers come only from `search_flights` results in the same turn. When a result came from
  a provider's test environment, the tool output and the effect say it is test data, and if the
  reply does not say "test data" the orchestrator appends a notice (`labelTestData`).

### Adding an LLM provider

1. Implement `LlmProvider` from `src/server/ai/types.ts`. `generate()` runs the tool loop: call
   the model, run each requested tool through `request.executeTool`, feed results back, and return
   the final text. Map vendor errors to `LlmProviderError` kinds.
2. Add the provider to `getAiStatus()` in `src/server/ai/config.ts` and to `getLlmProvider()` in
   `src/server/ai/provider.ts`, keyed by `AI_PROVIDER`.
3. Add unit tests with a mocked client, like `tests/unit/openai-provider.test.ts`.

The OpenAI implementation uses the Responses API because current OpenAI models only support
function calling there. It sends `store: false` and carries encrypted reasoning items between tool
rounds.

## Research providers

`src/server/research/types.ts` defines `ResearchProvider`. `getResearchProvider()` in
`src/server/research/index.ts` picks one from `RESEARCH_PROVIDER`:

| Value                                     | Provider                        | Behavior                                         |
| ----------------------------------------- | ------------------------------- | ------------------------------------------------ |
| `none` or unset                           | `NotConfiguredResearchProvider` | Live research is off. Manual entry always works  |
| `openai_web`                              | `OpenAiWebResearchProvider`     | OpenAI hosted web search. Needs `OPENAI_API_KEY` |
| `openai_web`, no key, or an unknown value | `UnavailableResearchProvider`   | Reports why live research is unavailable         |

A provider that is selected but cannot run never falls back to anything else. The Options tab,
the Plan tab, and Atlas's instructions all show the reason.

### OpenAI web search

`src/server/research/openai-web.ts` makes one Responses API request per `search_options` call:

- `tools: [{ type: "web_search", search_context_size }]` with `tool_choice: "required"`, so the
  search always runs, and `include: ["web_search_call.action.sources"]`, so the response lists
  every URL the search consulted.
- A strict JSON schema (`text.format`) for the results: title, URL, source name, description,
  location, and a price and availability that are only filled when the page stated them.
- `store: false`, like Atlas's own requests.

The response is checked before anything reaches Atlas:

- If no `web_search_call` ran, or the output is not the expected JSON, the search fails with
  `ResearchFailedError`.
- A result is kept only if its URL matches a consulted source (`web_search_call.action.sources`) or
  a `url_citation` annotation. Matching ignores `utm_*` parameters, `www.`, fragments, and a
  trailing slash. Everything else is dropped.
- Prices must be a plain amount with a three-letter currency code, or they are dropped.
- `retrievedAt` is the time the response arrived. The payload keeps the cited URL, the search
  queries, the model, and the response ID, and is stored as the option's `providerPayload`.

When Atlas saves a result, the option gets `origin = RESEARCH_PROVIDER` (labelled "Live result"),
the URL, source name, price, and retrieval time from the provider, and a price note such as "Price
as stated (Source, retrieved 2026-10-15 09:30 UTC)".

Cost control: the search is a separate tool that Atlas calls only when a request needs current
external information (its instructions say so, and the tool description says each search has a
cost). Ordinary turns never run a web search. The context size defaults to `low`. Structured
outputs can suppress citation annotations, which is why consulted sources are requested with
`include` and used as the main check.

To add another live provider:

1. Implement `search(query)` and return `ResearchResult` objects. Only include prices that the
   vendor returned, and set `retrievedAt` to the time of the call.
2. Read its API key from a server-only environment variable and mark the adapter as needing that
   key in the README.
3. Register it in `getResearchProvider()` under a new `RESEARCH_PROVIDER` value.

## Flight search

Flight search is separate from research providers because it returns structured, priced
itineraries rather than pages.

```
Options tab panel ──► src/server/actions/flights.ts ──┐
Atlas search_flights tool ────────────────────────────┤
                                                      ▼
                         src/server/services/flights.ts (searchFlights, saveFlightOffer)
                                                      │
                                                      ▼
                    FlightSearchProvider (src/server/flights/types.ts)
                                                      │
                                                      ▼
                    DuffelFlightProvider (src/server/flights/duffel.ts)
```

- `getFlightSearchStatus()` and `getFlightProvider()` in `src/server/flights/index.ts` read
  `FLIGHT_PROVIDER` (`duffel` by default, or `none`) and `DUFFEL_ACCESS_TOKEN`. Only tokens that
  start with `duffel_test_` are accepted, so every result today is test data. `DUFFEL_API_URL`
  overrides the base URL for the end-to-end stub.
- The Duffel adapter sends `Duffel-Version: v2`. It resolves city names with
  `GET /places/suggestions` (3-letter codes pass through) and searches with
  `POST /air/offer_requests?return_offers=true&supplier_timeout=15000`: one slice per direction, one
  adult passenger per traveler, `cabin_class`, and `max_connections` for the stop limit. Offers are
  validated one by one (malformed offers are dropped), sorted by price, and capped at ten. Prices
  are kept as the decimal strings Duffel returned, with the currency and the time of the search.
  Segment times are local to each airport and shown as such.
- Duffel errors map to kinds (`auth`, `rate_limit`, `invalid_request`, `unknown_place`,
  `unavailable`, `timeout`, `bad_response`) with messages that never include the token. The service
  turns them into `DomainError`s. A search writes nothing, so a failure changes no trip data.
- Results are sent to the browser for display. Each one carries a token sealed with an HMAC of
  `AUTH_SECRET`, bound to the trip and user and valid for 24 hours (`src/server/flights/seal.ts`).
  Saving opens the token, so the stored price, source, and retrieval time are exactly what the
  provider returned.
- `saveFlightOffer` saves a `FLIGHT` option with origin `RESEARCH_PROVIDER`, the Duffel offer ID in
  `providerPayload` (to avoid duplicates), and a price note that says it is test data. With
  "track as considering" it also creates a `PLANNED` flight booking linked to the option, with the
  caller as a `CONSIDERING` participant. A second member doing the same joins that booking as
  considering. Nothing sets a booking or participant to booked.

To add a live provider or live Duffel tokens later: implement `FlightSearchProvider`, report
`testMode: false`, register it in `getFlightProvider()`, and review the labelling (the "live" prompt
branch already exists). Ordering through Duffel would be a new service; search results already keep
the offer ID and expiry.

## Financial data (future)

`src/server/financial/provider.ts` documents a `FinancialDataProvider` interface for a future,
opt-in card benefits and rewards feature (for example through Plaid). There is no schema and no
integration in the MVP. The constraints for any implementation are written in that file: data is
private to one user and keyed by user rather than trip, no bank credentials are stored, only
provider tokens are kept, and recommendations rely only on data the provider actually exposes.

## Security notes

- Secrets are read only on the server. The only public variable is `NEXT_PUBLIC_APP_NAME`.
- Invitation tokens are 32 random bytes; only their SHA-256 hash is stored. Links expire,
  can be revoked, and can have a use limit that is enforced atomically.
- Sensitive endpoints (Atlas messages, invite creation, invite acceptance) have an in-memory rate
  limit.
- Model output is rendered as React nodes, never as HTML. Markdown links in Atlas replies become
  links only for `http(s)` URLs. Links from users, providers, or Atlas open with
  `rel="noopener noreferrer nofollow"`.
- Web page text returned by search is treated as data. The search request tells the model to
  ignore instructions inside pages, and only URLs the search consulted are kept.
- `callbackUrl` values are restricted to same-site paths.
- Baseline security headers are set in `next.config.ts`.

## Testing strategy

- Pure logic is unit tested without a database.
- Authorization, invitations, concurrency, and the orchestrator are tested against a real
  PostgreSQL test database, with a scripted provider standing in for the model.
- Playwright drives the production build for the acceptance flows. Atlas runs through the real
  OpenAI provider pointed at a local stub of the Responses API (`e2e/support/openai-stub.mjs`).
  The stub also answers `web_search` requests with canned sources and citations, including one
  uncited result that the app must drop, and can simulate a failed search.
- Flight search runs through the real Duffel provider pointed at a local stub of Duffel's API
  (`e2e/support/duffel-stub.mjs`), which checks the version header and test token, resolves place
  names, returns test offers, and simulates an outage. No automated test calls the real Duffel API.
