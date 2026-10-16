# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Flight search on Duffel in test mode, configured with `DUFFEL_ACCESS_TOKEN` (test tokens only)
  and `FLIGHT_PROVIDER`. A search panel on the Options tab is prefilled from the trip and shows
  airline, local times, stops, duration, total price and currency, source, and retrieval time,
  with a link to compare and book elsewhere.
- Every flight result, saved option, booking note, and Atlas reply that uses flight results is
  labelled as Duffel test data, not real fares or availability.
- Save a flight as a suggested option with its provenance, or also track it as a "Not booked yet"
  flight booking with yourself marked as considering. Nothing is booked through the app.
- Atlas `search_flights` and `save_flight_option` tools that use the same service and answer
  only from returned results. Without a token, the panel and Atlas say flight search is not
  configured.

## [0.2.0] - 2026-10-15

### Added

- Live research through OpenAI's hosted web search tool, selected with
  `RESEARCH_PROVIDER="openai_web"` and using the existing `OPENAI_API_KEY`. Optional
  `OPENAI_WEB_SEARCH_MODEL` and `OPENAI_WEB_SEARCH_CONTEXT_SIZE` settings.
- Saved web results keep their source URL, source name, and retrieval time, and are labelled
  "Live result". Prices and availability are kept only when the cited page stated them, with a
  note naming the source and retrieval time.
- Atlas replies that use web search link their citations inline and list the sources under the
  reply.

### Changed

- Atlas searches only when a request needs current information from the web.
- When live research is selected but cannot run (missing key or unknown provider), the Options
  and Plan tabs say it is unavailable and why. A failed search shows "Live research failed" and
  never falls back to presenting model knowledge as live results.
- Atlas replies render Markdown links (`http` and `https` only).

## [0.1.0] - 2026-10-15

First MVP release.

### Added

- Google sign-in with Auth.js and database sessions, a welcome screen, protected routes, and
  handling for failed sign-in and expired sessions.
- Trips dashboard with next-step summaries, drafts, and empty, loading, and error states.
- Conversational trip creation with three starting modes, structured details extracted by Atlas,
  an editable details panel, and a manual path that works without AI.
- Shared trip workspace with Overview, Plan with AI, Options, Itinerary, Bookings, and Tasks and
  decisions tabs.
- Invitations with hashed, expiring, revocable links and optional use limits; organizer and member
  roles; member management.
- Saved options with source, price, and retrieval time; lifecycle statuses; notes; comparison; and
  voting with organizer resolution.
- Tasks with assignees, priorities, due dates, links to trip items, and review of Atlas suggestions.
- Day-by-day itinerary with planned, confirmed, and suggested items, transfers, open-time hints,
  and a map-friendly location model.
- Bookings for flights, stays, ground transport, activities, and other items, with several
  travelers per booking, per-traveler status, room assignments, and cost splitting.
- Budget summary that separates estimates from actual costs and lists unpriced bookings.
- Activity history and optimistic concurrency on shared records.
- Atlas orchestrator with validated tools, proposals for changes to known details, and an OpenAI
  provider on the Responses API.
- Research provider interface with a "not configured" fallback, and a documented financial-data
  extension point.
- Sample seed data, unit and integration tests, and Playwright tests for the acceptance flows.
