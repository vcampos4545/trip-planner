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
| `search_options`                  | Query the research provider                                    |
| `save_research_option`            | Save a suggestion, with provenance if it came from a search    |
| `list_saved_research`             | Reuse what the group already saved                             |
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

`src/server/research/types.ts` defines `ResearchProvider`. The only implementation today is
`NotConfiguredResearchProvider`, which reports that live research is unavailable. The Options tab
and Atlas both say so, and manual entry always works.

To add a live provider:

1. Implement `search(query)` and return `ResearchResult` objects. Only include prices that the
   vendor returned, and set `retrievedAt` to the time of the call.
2. Read its API key from a server-only environment variable and mark the adapter as needing that
   key in the README.
3. Register it in `getResearchProvider()` under a new `RESEARCH_PROVIDER` value.

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
- Model output is rendered as text nodes, never as HTML. Links from users or providers open with
  `rel="noopener noreferrer nofollow"`, and only `http(s)` URLs are accepted.
- `callbackUrl` values are restricted to same-site paths.
- Baseline security headers are set in `next.config.ts`.

## Testing strategy

- Pure logic is unit tested without a database.
- Authorization, invitations, concurrency, and the orchestrator are tested against a real
  PostgreSQL test database, with a scripted provider standing in for the model.
- Playwright drives the production build for the acceptance flows. Atlas runs through the real
  OpenAI provider pointed at a local stub of the Responses API (`e2e/support/openai-stub.mjs`).
