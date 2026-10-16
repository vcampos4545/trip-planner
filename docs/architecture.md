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
- Organizer-only operations (member management, invite settings, resolving decisions, deleting
  the trip, approving options) use `requireOrganizer`. Creating invitations uses `requireInviter`:
  an organizer, or any member when the trip's `membersCanInvite` is on.

## Data model

The Prisma schema (`prisma/schema.prisma`) is normalized around `Trip`:

| Area         | Tables                                                                  |
| ------------ | ----------------------------------------------------------------------- |
| Identity     | `User`, `Account`, `Session`, `VerificationToken` (Auth.js)             |
| Membership   | `TripMember` (organizer or member), `TripInvitation` (links and email)  |
| Trip profile | `Trip` (details, airports, theme), `TripStop`, `TripPreference`         |
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
  summaries (including the flight results a reply showed), provider payloads, and activity
  metadata.
- Records that several people edit (`Trip`, `Task`, `ResearchOption`, `ItineraryEvent`,
  `Booking`) carry a `version` column. Updates use `updateMany({ where: { id, version } })` and a
  stale version returns a conflict that the UI explains with a reload action.
- Multi-row changes run in transactions and write an `ActivityLog` entry in the same transaction.

## Trip route: stops and airports

A trip visits an ordered list of `TripStop` rows (place, position, optional start and end date).
The airports people fly into and home from are `Trip.flyIntoAirport` and `Trip.flyOutOfAirport`,
kept apart from the stops, so "fly in and out of Salt Lake City, Jackson Hole then Park City" is
two stops and two airports. `Trip.destination` stays as the headline destination.

- The migration that added stops turned each existing destination into the trip's first stop.
  New trips get their destination (or the draft's stops) as stops when they are created, and a
  single undated stop that mirrors the destination follows it when the destination changes
  (`syncStopsWithDestination` in `src/lib/domain/stops.ts`).
- `stopListProblem` validates a whole list: names, at most 12 stops, no duplicates, each range in
  order, inside the trip dates, and stops in travel order.
- The Stops dialog in the trip header replaces the list and airports in one versioned update
  (`updateTripRoute`).
- Atlas sends small operations (add, update, remove, move). `applyStopOps` applies them and
  `classifyStopChange` decides what happens: adding stops or filling missing dates applies
  directly; removing, renaming, reordering, or re-dating a stop someone set becomes a proposal
  with a `stops` change, accepted or declined like other proposals.

## Trip themes

`Trip.theme` (`TripTheme`: ski, beach, outdoors, city, food, event, or none) is set only when the
group says it. `themeHint` in `src/lib/domain/theme.ts` decides, the same way every time, whether
Atlas should record a theme the user stated, ask one short question ("Is this a ski trip?") when
the timing and well-known ski destinations only imply it, or say nothing. The hint is in Atlas's
instructions and in the results of `update_trip_details` and `update_trip_stops`, so Atlas can ask
in the same reply that recorded the places and dates. Once a theme is known and the title is one
the app generated (`isAutomaticTitle`), Atlas proposes a better working title, which the user
accepts or edits, and `suggest_theme_tasks` adds the theme's usual tasks (`THEME_TASKS`) as
suggestions.

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
| `update_trip_stops`               | Add, update, remove, or move stops (see Trip route)            |
| `record_booking`                  | Record a booking the user says they made, as booked            |
| `suggest_theme_tasks`             | Suggest the theme's usual tasks, each awaiting review          |
| `search_options`                  | Query the research provider (only when current info is needed) |
| `save_research_option`            | Save a suggestion, with provenance if it came from a search    |
| `list_saved_research`             | Reuse what the group already saved                             |
| `search_flights`                  | Query the flight provider (SerpApi or Duffel test mode)        |
| `search_return_flights`           | Load return options for one round-trip result, only on request |
| `save_flight_option`              | Save a flight result from this turn as a suggested option      |
| `suggest_task`                    | Create a task in "suggested" state                             |
| `propose_itinerary_event`         | Create an itinerary item in "suggested" state                  |
| `summarize_outstanding_decisions` | Open votes, proposals, suggestions, unassigned tasks, gaps     |
| `create_invite_link`              | Create an invite link; the server adds it under the reply      |
| `invite_by_email`                 | Email invitations to addresses the user typed this message     |

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
- `record_booking` records what the user says they already bought or arranged, for them or a
  named member, with members resolved by name and anyone else refused. The booking is `BOOKED`
  with those travelers booked, never `CONFIRMED`, and its notes say it came from the user and was
  not checked with the provider. A purchase that matches an existing record (the same flight
  result, or the same category, title, and start date) marks the travelers booked on it instead
  of adding another. The effect carries the booking ID, so the chat shows **Edit** and, for a new
  record, **Undo**.
- Flight results are numbered `f1`, `f2`, ... across the whole conversation, and the results a
  reply showed are saved in its metadata (`flightResults`). The next turns load the recent ones
  back, list them in Atlas's instructions, and `record_booking` matches a reference such as
  "the American flight that lands at 2:59pm" against them in code (`matchShownFlights` in
  `src/lib/domain/flight-match.ts`). More than one match is returned as ambiguous with the
  candidates, and nothing is recorded until the user says which.
- On a trip with one member, proposal effects read "Needs your OK" and the chat shows Accept and
  Decline under the reply; the instructions tell Atlas never to mention a group. With several
  members, a proposal waits for any member to accept it on the Overview tab.
- Invite tools call the same invitation services as the dialog, so permissions and rate limits
  are the same. `create_invite_link` never returns the token to the model: the orchestrator adds
  the links under the saved reply (`withInviteLinks`), and history sent back to the model hides
  invite tokens (`hideInviteTokens`). `invite_by_email` refuses any address that is not in the
  user's message for this turn, and reports honestly when email is not configured.
- The UI shows the tool effects under each reply, so what Atlas says it did can be checked against
  what actually happened.
- When a reply follows live searches, the orchestrator stores the results' titles, URLs, source
  names, and retrieval times in the message metadata (`sources`), and the chat lists them as links
  under the reply. Atlas is also told to cite results inline as Markdown links.
- A failed search is returned to the model as `{ available: false, failed: true }` and recorded as
  a "Live research failed" effect. A provider that is selected but cannot run reports "Live
  research is unavailable". In both cases nothing is saved as a live result.
- Flight answers come only from `search_flights` results in the same turn. The prompt names the
  configured source (`FlightSearchProvider.label`, such as "Google Flights via SerpApi"). When a
  result came from a provider's test environment, the tool output and the effect say it is test
  data, and if the reply does not say "test data" the orchestrator appends a notice
  (`labelTestData`). With a live provider the prompt also tells Atlas that searches spend a
  limited quota, to search only when the user asks for flights, and to load returns only when
  asked.

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
the Atlas panel's info button, and Atlas's instructions all show the reason.

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
Bookings > Flights panel ──► src/server/actions/flights.ts ──┐
Atlas search_flights / search_return_flights tools ───┤
                                                      ▼
     src/server/services/flights.ts (searchFlights, searchReturnFlights, saveFlightOffer)
                                                      │
                                                      ▼
                    FlightSearchProvider (src/server/flights/types.ts)
                                                      │
                    ┌─────────────────────────────────┴───────────────┐
                    ▼                                                 ▼
  CachedFlightProvider (cache.ts, Postgres store in db-cache.ts)   DuffelFlightProvider
                    │                                              (duffel.ts, test mode)
                    ▼
  SerpApiFlightProvider (serpapi.ts)
```

- `getFlightSearchStatus()` and `getFlightProvider()` in `src/server/flights/index.ts` read
  `FLIGHT_PROVIDER` (`serpapi` by default, `duffel`, or `none`). SerpApi needs `SERPAPI_API_KEY`;
  Duffel needs `DUFFEL_ACCESS_TOKEN`, and only tokens that start with `duffel_test_` are accepted.
  `SERPAPI_API_URL` and `DUFFEL_API_URL` override the base URLs for the end-to-end stubs.
- `FlightSearchProvider` has `search(query)` and an optional `searchReturns(offer)`. Duffel prices a
  whole round trip in one request, so it has no `searchReturns`. Google Flights prices a round trip
  from the outbound choice, so SerpApi returns outbound offers with `pendingReturn` (the return
  date and SerpApi's `departure_token`) and loads return options only through `searchReturns`.
- Offers carry their source name, retrieval time, provider ID, and an optional `bookingUrl`.
  Results can carry `priceInsights` (the source's own view of the route's prices) and `cached`.

### Place names

Both providers read From and To with the same rules (`src/lib/domain/flight-places.ts`) and
resolve the two together (`resolveRoute` in `src/server/flights/places.ts`):

- Codes: a 3-letter code in any case, a list ("JFK, LGA", "JFK or LGA"), or a code in a label
  ("Boston (BOS)", "JFK - John F. Kennedy", the placeholder's own "New York or JFK").
- Names: notes in brackets are dropped ("New York City (Vaughn)" is looked up as "New York City"),
  and the part before the first comma is looked up. The rest ("OR", "Portugal") narrows the
  suggestions, with US state abbreviations spelled out.
- Among suggestions named what was typed, a city with its own airport wins over towns that only
  have one nearby (Lisbon, Portugal over Lisbon, Maine). Two or more such cities are ambiguous
  unless the first has more airports of its own than any other; otherwise the source's first
  suggestion is used.
- An ambiguous or unknown place throws a `RouteLookupError` with one issue per field and no flight
  search. The service turns it into a validation error with `fieldErrors` and, for ambiguous names,
  `fieldChoices` (label and the value that picks it). The panel shows both under the field, and
  picking a choice searches again. Atlas gets the same message, choices included.

### SerpApi (Google Flights)

- Requests go to `GET /search.json` with `engine=google_flights`: `departure_id` and `arrival_id`
  (comma-separated airport codes), `outbound_date`, `type` 1 with `return_date` or `type` 2 for one
  way, `adults`, `travel_class` (1 to 4), `stops` (SerpApi's 1 nonstop, 2 up to one stop, 3 up to
  two), `currency=USD`, `hl=en`, `gl=us`, and `api_key`. The key is only ever in that query string;
  error messages and logs never include the URL.
- City names are resolved with `engine=google_flights_autocomplete`, and every airport of the
  chosen suggestion is searched (New York becomes JFK, LGA, EWR). The suggestions are cached for 30
  days in the same store (`serpapi:suggestions:<name>`), so a pick between candidates costs no
  second lookup. 3-letter codes in any case need no lookup; a metro code is searched as its
  airports (NYC becomes JFK, LGA, EWR), because Google Flights takes airport codes.
- `best_flights` and `other_flights` are merged, validated item by item (items without a price or
  readable times are dropped), sorted by price, and capped at ten. Prices are Google's totals for
  all travelers. Segment times (`YYYY-MM-DD HH:MM`, local to each airport) become the app's local
  timestamps. Google results have no ID, so one is derived from the flights, price, and search to
  avoid saving duplicates. `search_metadata.google_flights_url` is passed on as the booking link
  only if it is an `https://www.google.com/travel/flights` URL. `price_insights` becomes
  `priceInsights`, labelled as Google Flights.
- Return options: `searchReturns` repeats the search parameters with the offer's
  `departure_token`. Each returned item becomes an offer with both legs and the round-trip price
  from that response. It costs one search, so the UI and Atlas run it only on request.
- Errors map to kinds: 401/403 `auth`, 429 `rate_limit` (with separate messages for an exhausted
  monthly quota and the hourly limit), 400 `invalid_request`, others `unavailable`. A 200 response
  whose `error` says Google returned no results is an empty list. `search_metadata.status` of
  `Error` is `unavailable`.

### Search cache

`CachedFlightProvider` wraps the SerpApi provider. A search key is a SHA-256 of the normalized
query (trimmed, lowercased places, dates, travelers, cabin, stops); a returns key covers the
pending return and the outbound departure. Hits are returned with `cached: true` and their original
`retrievedAt`, so the UI can say the results were reused and how old they are. Only successful
results are stored, for `SERPAPI_CACHE_HOURS` (default 3, 0 turns it off). The store is the
`FlightSearchCache` table (`key`, `payload`, `expiresAt`), shared across trips because it holds only
public fare data; writes also delete expired rows. A failing store is logged and skipped, so it
never blocks a search.

### Duffel (test mode)

- The Duffel adapter sends `Duffel-Version: v2`. It resolves city names with
  `GET /places/suggestions` (3-letter codes, metro codes included, pass through in upper case) and
  searches with
  `POST /air/offer_requests?return_offers=true&supplier_timeout=15000`: one slice per direction, one
  adult passenger per traveler, `cabin_class`, and `max_connections` for the stop limit. Offers are
  validated one by one (malformed offers are dropped), sorted by price, and capped at ten. Prices
  are kept as the decimal strings Duffel returned, with the currency and the time of the search.
  Segment times are local to each airport and shown as such.
- Duffel errors map to the same kinds with messages that never include the token.

### Errors, sealing, and saving

- The service turns provider errors into `DomainError`s; non-input failures add "Nothing in the
  trip was changed." A search writes nothing, so a failure changes no trip data.
- Results are sent to the browser for display. Each one carries a token sealed with an HMAC of
  `AUTH_SECRET`, bound to the trip and user and valid for 24 hours (`src/server/flights/seal.ts`).
  Saving and loading returns open the token, so the stored price, source, retrieval time, and
  return token are exactly what the provider returned.
- `saveFlightOffer` saves a `FLIGHT` option with origin `RESEARCH_PROVIDER`, the provider and offer
  ID in `providerPayload` (to avoid duplicates), the booking link when there is one, and a price
  note that names the source or says it is test data. A round trip saved before its return is
  chosen says so in the description and price note. With "track as considering" it also creates a
  `PLANNED` flight booking linked to the option, with the caller as a `CONSIDERING` participant. A
  second member doing the same joins that booking as considering. Nothing sets a booking or
  participant to booked.

To add another provider: implement `FlightSearchProvider`, set `testMode` honestly, register it in
`getFlightProvider()`, and wrap it in `CachedFlightProvider` if searches cost quota. Booking would
be a new service; the app does not execute bookings.

## Atlas panel

Atlas has no tab of its own. The trip layout (`src/app/(app)/trips/[tripId]/layout.tsx`) loads the
user's conversation for the trip and wraps every tab in `AtlasPanelProvider`
(`src/components/atlas/atlas-panel.tsx`): an **Ask Atlas** button opens the conversation in a
slide-over sheet, full width on phones, with the "Try asking" suggestions and a small info button
for where Atlas works from. `?atlas=open` (with an optional `prompt`) opens it from a link; the old
`/plan` route redirects there, and trip creation lands on it. Components inside the workspace open
it with `useAtlasPanel().openAtlas(prompt)`. The pre-trip creation page keeps its own full-page
chat.

## Itinerary week view

The itinerary opens on a calendar (`src/components/itinerary/week-view.tsx`) with the day list as
the alternative (`?view=list`). `src/lib/domain/calendar.ts` turns itinerary events and dated
bookings into calendar items: flights and ground legs at their local times, stays and untimed
items in the all-day lane, and each booking labelled from its travelers' own statuses (booked,
considering, or mixed). Overnight items are cut at midnight, overlapping items share the column,
and all-day items span the days they cover. An event linked to a booking that is already on the
calendar is shown once. A "Who's flying when" strip lists every traveler's flights. Small screens
start on a three-day range, with week and single-day ranges available.

## Invitations and membership

Services: `src/server/services/invitations.ts` and `src/server/services/members.ts`. Pure rules
(status, who may invite, the leave rules, parsing addresses) are in
`src/lib/domain/invitations.ts`.

- A `TripInvitation` without `email` is a shareable link: anyone signed in can use it until it
  expires, is revoked, or reaches `maxUses`. With `email` set it is bound to that lowercased
  address (`maxUses` 1) and can only be accepted by a user whose email matches and is verified.
  Auth.js leaves `emailVerified` empty for OAuth users, so the `signIn` event in `src/auth.ts`
  sets it when Google reports `email_verified`.
- Status is derived, not stored: pending, accepted (`acceptedAt`), expired, revoked, or used up.
  Acceptance claims a use with one conditional `updateMany`, so a limited link can't be over-used
  by concurrent joins.
- Inviting an address that already has a pending invitation renews it with a new token. Resending
  replaces the token too, so only the latest link works. Tokens are never stored; the raw link is
  returned once, to the inviter, or emailed.
- Email goes through `EmailProvider` (`src/server/email`), with one implementation: Resend over
  its REST API. Without `RESEND_API_KEY` and `EMAIL_FROM` the provider is null, the invitation is
  still created, and the link comes back with outcome `not_sent`. `sent` is only reported after
  Resend accepted the message, and a rejection comes back as `failed` with the link.
- The join page lives outside the signed-in layout and is not covered by the proxy, so signed-out
  visitors see the preview (trip title, dates, first organizer's name, member count, expiry, and a
  masked invited address) and sign in with a `callbackUrl` back to the invite. A revoked or unknown
  token reveals nothing about the trip.
- Leaving: the only member can't leave, and an organizer can't leave while they are the only
  organizer (`leaveBlock`). Demoting the last organizer is refused. Role changes, removals,
  transfers, and leaving lock the trip row (`SELECT ... FOR UPDATE`) inside the transaction, so
  two organizers stepping down at once can't leave a trip without one.
- Activity entries: `INVITE_CREATED`, `INVITE_SENT`, `INVITE_ACCEPTED`, `INVITE_REVOKED`,
  `INVITE_SETTINGS_CHANGED`, `MEMBER_ROLE_CHANGED`, `MEMBER_REMOVED`, and `MEMBER_LEFT`. Invited
  addresses appear masked, since the person is not a member yet.
- The trip layout renders one invite dialog (`InviteProvider`). The header button, the next-step
  card, and the members card open it, and `?open=invite` opens it from a link such as a dashboard
  card. Next steps carry an explicit target (`open` or `anchor`) instead of a fixed anchor.

## Financial data (future)

`src/server/financial/provider.ts` documents a `FinancialDataProvider` interface for a future,
opt-in card benefits and rewards feature (for example through Plaid). There is no schema and no
integration in the MVP. The constraints for any implementation are written in that file: data is
private to one user and keyed by user rather than trip, no bank credentials are stored, only
provider tokens are kept, and recommendations rely only on data the provider actually exposes.

## Security notes

- Secrets are read only on the server. The only public variable is `NEXT_PUBLIC_APP_NAME`.
- Invitation tokens are 32 random bytes; only their SHA-256 hash is stored. Links expire,
  can be revoked, and can have a use limit that is enforced atomically. Email invitations only
  work for the matching verified address. The join page sets `referrer: no-referrer`.
- Sensitive endpoints (Atlas messages, invite creation, invitation emails, invite acceptance)
  have an in-memory rate limit.
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
- The SerpApi stub (`e2e/support/serpapi-stub.mjs`) also returns named flights for LGA to SLC and
  SLC to JFK, which the Park City replay (`e2e/flow-i-serpapi-park-city.spec.ts`) uses to check
  that flights bought after a search land in Bookings and on the week view.
