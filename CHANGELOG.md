# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Trips with several stops: an ordered list of places with optional dates, kept apart from the
  airports people fly into and home from (`TripStop`, `flyIntoAirport`, `flyOutOfAirport`). The
  trip header shows the route, and a **Stops** dialog edits it. Atlas records stops with the new
  `update_trip_stops` tool; adding stops or missing dates applies directly, other changes wait for
  a member to accept them.
- Atlas records bookings you say you made with the new `record_booking` tool: flights, stays, and
  ground legs such as a friend driving you between stops, for you or a named member, saved under
  Bookings as booked. A flight from an earlier search is matched to the exact result Atlas showed,
  and an ambiguous reference makes Atlas ask which one. The chat shows **Edit** and **Undo** for
  each recorded booking, and nothing is presented as confirmed with the airline.
- Trip themes (`TripTheme`). Atlas records a theme you state, asks "Is this a ski trip?" when the
  season and well-known ski destinations only imply it, proposes a better working title once the
  theme is known, and suggests the usual tasks (rentals, lift passes, lessons, gear) with the new
  `suggest_theme_tasks` tool.
- Itinerary week view: days as columns, hours as rows, and an all-day lane, showing itinerary
  items, everyone's flights labelled Booked or Considering per traveler, ground legs, and stays,
  with a "Who's flying when" strip. Phones start on a three-day view. The day list is still there.

- Flight search with Google Flights results through SerpApi, selected with
  `FLIGHT_PROVIDER="serpapi"` and `SERPAPI_API_KEY`. Results are labelled "Google Flights via
  SerpApi" with their retrieval time, prices are shown as Google returned them, and each result
  links to Google Flights to book. Google's price insight (price level and usual range) is shown
  when returned and labelled as Google's.
- Round trips are searched once; the return options for an outbound flight load only when someone
  clicks **Show return flights** or asks Atlas, through the new `search_return_flights` tool.
- Identical SerpApi searches within `SERPAPI_CACHE_HOURS` (default 3) reuse saved results from
  the new `FlightSearchCache` table instead of spending the quota again, and city lookups are kept
  for 30 days. Reused results say so and keep their original retrieval time.
- Clear messages when the SerpApi quota or hourly limit is reached or SerpApi fails. Failed
  searches change no trip data.

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

### Changed

- Atlas opens as a panel from an **Ask Atlas** button on every trip tab instead of having its own
  Plan with AI tab. The "Try asking" suggestions stay, and "Where Atlas works from" moved behind a
  small info button. Old Plan with AI links open the panel.
- Flight search moved from the Options tab to Bookings > Flights. **Save as considering** adds a
  flight booking with you as considering; **Save to options only** keeps just the option. The
  search prefills the airport people fly into when the trip has one.
- On a trip with one member, nothing is phrased as waiting for the group, and a change Atlas
  proposes to something already set can be accepted or declined in the chat.
- Flight result IDs continue across a conversation, and the results a reply showed are saved with
  it, so later messages can refer back to them.
- `FLIGHT_PROVIDER` now defaults to `serpapi`. Set `FLIGHT_PROVIDER="duffel"` to keep using Duffel
  test mode. Atlas names the configured flight source instead of assuming Duffel.
- Round-trip results show "round-trip total" next to the price.

### Fixed

- Flight search From and To take every form the placeholders advertise, with SerpApi and Duffel
  alike and in Atlas's `search_flights`: city names ("New York", "Lisbon"), airport codes in any
  case ("JFK", "lis"), metro codes ("NYC" searches JFK, LGA, and EWR on Google Flights), a trip's
  own wording with a note in brackets ("New York City (Vaughn)", "Boston (BOS)"), and the
  placeholder text itself ("New York or JFK"). Before, a prefilled place such as "New York City
  (Vaughn)" failed with "No airport or city matches".
- A name that fits more than one city with its own airport, such as "Portland", no longer
  searches the first match. The form lists the candidates under the field and searches the one
  you pick, and Atlas asks which one you mean. A place that matches nothing is named under its
  field instead of at the top of the form. City lookups are now cached as Google's suggestions,
  so earlier cached lookups are looked up again once.

### Upgrade notes

- Run `pnpm db:deploy`. The migration adds stops, airports, and themes, and turns each trip's
  destination into its first stop.
- Flights you told Atlas about before this release were saved as notes, not bookings. Tell Atlas
  again (or search again and say which result you bought) to record them under Bookings > Flights.

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
