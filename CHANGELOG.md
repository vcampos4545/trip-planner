# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
