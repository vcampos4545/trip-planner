# Trip Planner

A group trip planner with an AI assistant named Atlas. A group shares one workspace per trip:
details and preferences, saved options, votes, tasks, a day-by-day itinerary, bookings, and a
budget summary. Atlas reads and updates that shared record through validated tools instead of
treating each chat as a one-off.

"Trip Planner" is a placeholder product name. Set `NEXT_PUBLIC_APP_NAME` to change it (see
[Product name](#product-name)).

## Features

- **Trips with several stops.** A trip is an ordered list of stops, each with optional dates,
  plus the airports people fly into and home from. "Fly in and out of Salt Lake City, Jackson
  Hole then Park City" is two stops and two airports. The trip header shows the route, and the
  **Stops** button edits it directly. Existing trips keep their destination as the first stop.
- **Atlas, from every tab.** The **Ask Atlas** button opens the trip's conversation in a panel
  on any tab. Atlas records details, stops, and preferences as you talk, suggests tasks and
  itinerary items for review, and keeps "Try asking" suggestions above the message box. The
  small info button shows where Atlas works from and which live sources are connected.
- **Bookings you tell Atlas about.** Say "I bought the Southwest flight" after a search and
  Atlas records that exact flight under Bookings > Flights as booked for you, with its times,
  airports, and flight number. It does the same for a named trip member, a stay, or a ground leg
  such as a friend driving you between stops. If more than one flight shown earlier fits, Atlas
  asks which one. Each recorded booking has **Edit** and **Undo** under the reply, and nothing is
  ever presented as confirmed with the airline.
- **Trip themes.** Atlas records a theme such as skiing when you say it, and asks "Is this a ski
  trip?" when only the dates and places suggest it. Once the theme is known it proposes a better
  working title, such as "Out West ski trip", and suggests the usual tasks (rentals, lift passes,
  lessons, gear) for you to accept.
- **One-person trips.** When you are the only member, nothing waits for "the group": a change
  Atlas proposes to something already set can be accepted or declined right in the chat.
- **Flight search in Bookings.** Bookings > Flights has the flight search. Saving a result as
  considering adds a flight booking with you as considering.
- **Itinerary week view.** The itinerary opens on a calendar week (days as columns, hours as rows,
  an all-day lane on top). It shows itinerary items, everyone's flights labelled Booked or
  Considering per traveler, ground legs, and stays, with a "Who's flying when" strip. Phones start
  on a three-day view; the day-by-day list is one click away.
- **The rest of the workspace.** Shared details and preferences, saved options with sources and
  prices, votes, tasks, bookings with several travelers and cost splits, and a budget summary that
  keeps estimates apart from actual costs.

Trips that existed before stops and bookings-from-chat: the destination becomes the first stop
when the migration runs. Flights you only told Atlas about earlier were saved as notes, not
bookings. Open Atlas and say it again, for example "I bought the Southwest flight from LGA to SLC
on Feb 27, leaving 6:00 AM and landing 9:45 AM", or search again and say which result you bought,
and Atlas records it under Bookings > Flights.

## Stack

Next.js 16 (App Router), React 19, TypeScript 6 (strict), Tailwind CSS 4 with shadcn/ui,
PostgreSQL 17, Prisma 7, Auth.js (next-auth v5) with Google OAuth and database sessions, the
official `openai` SDK (Responses API with function tools), Zod, React Hook Form, Vitest, and
Playwright. Package manager: pnpm through corepack.

Architecture notes and extension points live in [docs/architecture.md](docs/architecture.md).

## Requirements

- Node.js 24 or newer
- corepack (ships with Node)
- Docker, for the local PostgreSQL container
- A Google Cloud OAuth client to sign in (instructions below)
- Optional: an OpenAI API key to turn on Atlas
- Optional: a free SerpApi key to turn on flight search (Google Flights results)

## Local setup

Run these from the repository root.

1. Enable pnpm through corepack:

   ```bash
   corepack enable
   corepack prepare pnpm@11.28.2 --activate
   ```

2. Install dependencies. This also generates the Prisma client.

   ```bash
   pnpm install
   ```

3. Create your environment file and fill it in:

   ```bash
   cp .env.example .env
   openssl rand -base64 33   # paste the output into AUTH_SECRET
   ```

   Then set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` (see [Google OAuth](#google-oauth)) and,
   if you want Atlas, `OPENAI_API_KEY` (see [OpenAI](#openai)). For live research, also set
   `RESEARCH_PROVIDER="openai_web"` (see [Live web search](#live-web-search)). For flight search,
   set `SERPAPI_API_KEY` (see [Flight search](#flight-search)). Leave `DATABASE_URL` as it is to
   use the Docker database.

4. Start PostgreSQL. It listens on port 5433 and creates two databases: `trip_planner` for
   development and `trip_planner_test` for tests.

   ```bash
   pnpm db:up
   ```

   Set `POSTGRES_PORT` before this command if 5433 is taken, and update `DATABASE_URL` to match.

5. Apply the migrations:

   ```bash
   pnpm db:deploy
   ```

6. Start the app:

   ```bash
   pnpm dev
   ```

   Open http://localhost:3000 and sign in with Google.

7. Optional sample data. Sign in once so your user exists, then:

   ```bash
   SEED_OWNER_EMAIL=you@gmail.com pnpm db:seed
   ```

   This creates a trip titled "[Sample] Lisbon long weekend" with sample members, options,
   votes, tasks, itinerary items, and bookings, and adds you as an organizer. Everything it
   creates is labelled as sample data. Running it again replaces the sample trip.

To stop the database: `pnpm db:down`. Data persists in the `postgres-data` Docker volume.

## Google OAuth

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or pick a
   project.
2. Go to **APIs & Services > OAuth consent screen**. Choose **External**, fill in the app name
   and support email, and add yourself (and anyone testing with you) as **test users** while the
   app is in testing mode. The default scopes (`openid`, `email`, `profile`) are all the app uses.
3. Go to **APIs & Services > Credentials > Create credentials > OAuth client ID**.
4. Application type: **Web application**.
5. **Authorized JavaScript origins**: `http://localhost:3000`
6. **Authorized redirect URIs**: `http://localhost:3000/api/auth/callback/google`
7. Create the client and copy the values into `.env`:

   ```bash
   AUTH_GOOGLE_ID="....apps.googleusercontent.com"
   AUTH_GOOGLE_SECRET="..."
   ```

8. For a deployed site, add `https://your-domain` as an origin and
   `https://your-domain/api/auth/callback/google` as a redirect URI, and set
   `AUTH_URL=https://your-domain`.

`AUTH_URL` must match the address you open in the browser. If you run on a different port, update
both `AUTH_URL` and the Google redirect URI. Without Google credentials the sign-in page loads and
explains that sign-in is not configured.

Sessions are stored in the database (the `Session` table), last 30 days, and are refreshed daily.
Google access, refresh, and ID tokens are dropped before the account link is saved because the app
does not call Google APIs.

## OpenAI

1. Create an API key at https://platform.openai.com/api-keys.
2. Set it in `.env`:

   ```bash
   AI_PROVIDER="openai"
   OPENAI_API_KEY="sk-..."
   OPENAI_MODEL="gpt-6.1-sol"
   ```

`OPENAI_MODEL` defaults to `gpt-6.1-sol`, which OpenAI describes as near its flagship quality at a
lower cost. `gpt-6-luna` is cheaper and `gpt-6-astra` is the most capable. Any model that supports
function calling through the Responses API works. Optional settings:

- `OPENAI_REASONING_EFFORT`: one of `low`, `medium`, `high`, `xhigh`, `max` (some models also
  accept `none` or `minimal`). Unset means the model default.
- `OPENAI_BASE_URL`: an OpenAI-compatible gateway or proxy. The end-to-end tests use this to point
  at a local stub.

Requests use `store: false`, so OpenAI does not keep the conversation. Without `OPENAI_API_KEY` the
app still runs. Atlas shows that it needs configuration, and every feature has a manual path.

## Live web search

Atlas can search the web for current information through OpenAI's hosted `web_search` tool. It
uses the same `OPENAI_API_KEY`, so there is no extra account.

1. Set up [OpenAI](#openai) first.
2. Turn on live research in `.env`:

   ```bash
   RESEARCH_PROVIDER="openai_web"
   ```

3. Restart the app. The info button in the Atlas panel shows "Live search: OpenAI web search".

Optional settings:

- `OPENAI_WEB_SEARCH_MODEL`: the model that runs searches. Defaults to `OPENAI_MODEL`. It must
  support the web search tool.
- `OPENAI_WEB_SEARCH_CONTEXT_SIZE`: `low` (default), `medium`, or `high`. Larger sizes read more of
  each page and cost more.

How it behaves:

- Atlas searches only when a request needs current information from the web, such as prices,
  availability, opening hours, or specific places to book. Each search is one Responses API request
  that must run the web search tool.
- Results keep the page URL, source name, and retrieval time. Only pages the search actually
  consulted or cited are kept, so nothing from the model's own knowledge is shown as a live
  result. A price or availability note appears only when that page stated it, labelled with the
  source and retrieval time.
- Atlas's replies link the results they use and list them as sources under the reply.
- Options saved from a search are labelled "Live result".
- If `RESEARCH_PROVIDER="openai_web"` but `OPENAI_API_KEY` is missing, or `RESEARCH_PROVIDER` has an
  unknown value, the Options tab and the Atlas panel's info button say live research is
  unavailable and why. If a search fails, Atlas shows "Live research failed" and nothing is saved.

Cost: OpenAI bills each web search tool call (about $10 per 1,000 calls at the time of writing)
plus the search content tokens at the model's token rates. Check
https://developers.openai.com/api/docs/pricing for current prices.

## Flight search

Bookings > Flights has a flight search panel, and Atlas has `search_flights` and
`search_return_flights` tools that use the same service. Two providers are available, picked with
`FLIGHT_PROVIDER`:

- `serpapi` (default): Google Flights results through [SerpApi](https://serpapi.com).
- `duffel`: [Duffel](https://duffel.com) in test mode. Sample data only, kept for later live use.

### SerpApi (Google Flights)

1. Register for a free account at https://serpapi.com.
2. Copy your key from https://serpapi.com/manage-api-key.
3. Set it in `.env` and restart the app:

   ```bash
   FLIGHT_PROVIDER="serpapi"
   SERPAPI_API_KEY="..."
   ```

The info button in the Atlas panel then shows "Flight search: Google Flights via SerpApi".

Quota: the free plan allows about 250 searches a month and 50 an hour (check your plan at
https://serpapi.com/pricing). Paid plans have no pay-as-you-go overage, so when the quota runs out,
searches fail until it resets. The app spends searches carefully:

- A one-way or round-trip search is one SerpApi search. A round trip comes back as outbound
  flights priced with Google's round-trip total; the return options for one outbound flight are
  another search, run only when someone clicks **Show return flights** or asks Atlas for them.
- A city name such as "New York" is looked up once through Google Flights autocomplete (which may
  count as a search) and then reused for 30 days. A 3-letter code such as JFK needs no lookup.
- Identical searches within `SERPAPI_CACHE_HOURS` (default 3) reuse the saved results from the
  database, so restarts keep them. The panel says when results were reused and shows their
  original retrieval time. Only successful searches are cached.
- Atlas is told to search only when the user asks for flights or flight prices.

How it behaves:

- Results are labelled "Google Flights via SerpApi" with their retrieval time. Prices are totals
  for all travelers in US dollars, exactly as Google Flights showed them, and can change before
  booking. Google's price insight (whether prices are low, typical, or high, and the usual range)
  is shown when returned and labelled as Google's estimate.
- Each result links to the search on Google Flights, where you book. "Any cabin" searches economy,
  since Google Flights searches one cabin at a time.
- SerpApi works by reading Google Flights, so it can break or return fewer results when Google
  changes its pages. Errors, an exhausted quota, and the hourly limit each show a clear message,
  and a failed search changes no trip data.

### Duffel (test mode)

1. Create a free account at https://app.duffel.com/join.
2. In the dashboard, make sure the test mode toggle is on, then open **Developers > Access
   tokens** and create a token. Test tokens start with `duffel_test_`.
3. Set it in `.env` and restart the app:

   ```bash
   FLIGHT_PROVIDER="duffel"
   DUFFEL_ACCESS_TOKEN="duffel_test_..."
   ```

Test mode returns sample data from Duffel's test environment, never real flights, fares, or
availability. Results can carry real airline names as well as the fictional "Duffel Airways", so
every result, saved option, booking note, and Atlas reply that uses them says it is Duffel test
data. If Atlas leaves that out, the app adds the notice to the reply. Live tokens
(`duffel_live_...`) are not accepted yet. Duffel does not charge for test searches.

### With either provider

- The search is prefilled from the trip's departure city, the airport people fly into (or the
  destination), dates, and group size. You can type a city name or a 3-letter airport code.
- Results show the airline, local departure and arrival times, stops, duration, total price and
  currency for all travelers, source, and retrieval time.
- **Save as considering** adds a flight booking record that is "Not booked yet" with you marked
  as considering, plus the flight as an option with its source, price, link, and retrieval time.
  **Save to options only** keeps just the option. Searching never marks anything booked, and the
  app never books or pays for flights. When you buy one, click **I booked this** on the booking
  or tell Atlas. A round trip saved before its return is chosen says so in its description.
- Atlas keeps the results it showed in a conversation, so you can say which one you bought a few
  messages later.
- Without a key or token, the panel and Atlas say flight search is not configured.

## Environment variables

| Variable                         | Required    | Purpose                                                         |
| -------------------------------- | ----------- | --------------------------------------------------------------- |
| `DATABASE_URL`                   | Yes         | PostgreSQL connection string                                    |
| `AUTH_SECRET`                    | Yes         | Encrypts Auth.js cookies and tokens. Use a long random value    |
| `AUTH_URL`                       | Yes         | Public base URL, used for OAuth callbacks and invite links      |
| `AUTH_GOOGLE_ID`                 | For sign-in | Google OAuth client ID                                          |
| `AUTH_GOOGLE_SECRET`             | For sign-in | Google OAuth client secret                                      |
| `NEXT_PUBLIC_APP_NAME`           | No          | Product display name. Defaults to "Trip Planner"                |
| `AI_PROVIDER`                    | No          | `openai` (the only provider today)                              |
| `OPENAI_API_KEY`                 | For Atlas   | OpenAI API key. Empty turns Atlas off                           |
| `OPENAI_MODEL`                   | No          | Model ID. Defaults to `gpt-6.1-sol`                             |
| `OPENAI_REASONING_EFFORT`        | No          | Reasoning effort for models that support it                     |
| `OPENAI_BASE_URL`                | No          | OpenAI-compatible base URL                                      |
| `RESEARCH_PROVIDER`              | No          | `none` (default) or `openai_web` for OpenAI web search          |
| `OPENAI_WEB_SEARCH_MODEL`        | No          | Model for web searches. Defaults to `OPENAI_MODEL`              |
| `OPENAI_WEB_SEARCH_CONTEXT_SIZE` | No          | `low` (default), `medium`, or `high` search context             |
| `FLIGHT_PROVIDER`                | No          | `serpapi` (default), `duffel`, or `none` to turn flights off    |
| `SERPAPI_API_KEY`                | For flights | SerpApi key for Google Flights results. Empty turns flights off |
| `SERPAPI_CACHE_HOURS`            | No          | Hours to reuse identical SerpApi searches (0 to 24). Default 3  |
| `SERPAPI_API_URL`                | No          | SerpApi base URL. The end-to-end tests point it at a stub       |
| `DUFFEL_ACCESS_TOKEN`            | For Duffel  | Duffel test token (`duffel_test_...`)                           |
| `DUFFEL_API_URL`                 | No          | Duffel API base URL. The end-to-end tests point it at a stub    |
| `INVITE_TTL_DAYS`                | No          | Default invite link lifetime in days (1 to 30). Defaults to 7   |
| `TEST_DATABASE_URL`              | No          | Overrides the test database URL. Its name must end with `_test` |
| `POSTGRES_PORT`                  | No          | Host port for the Docker database. Defaults to 5433             |

Only `NEXT_PUBLIC_APP_NAME` reaches the browser. Everything else stays on the server.

## Scripts

| Command           | What it does                                                     |
| ----------------- | ---------------------------------------------------------------- |
| `pnpm dev`        | Development server on port 3000                                  |
| `pnpm build`      | Production build                                                 |
| `pnpm start`      | Serve the production build                                       |
| `pnpm lint`       | ESLint                                                           |
| `pnpm typecheck`  | Generate route types and run `tsc`                               |
| `pnpm format`     | Format with Prettier (`pnpm format:check` to verify)             |
| `pnpm test`       | Unit tests and database integration tests (needs `pnpm db:up`)   |
| `pnpm test:unit`  | Unit tests only, no database needed                              |
| `pnpm test:e2e`   | Builds into `.next-e2e` and runs Playwright (needs `pnpm db:up`) |
| `pnpm db:up`      | Start PostgreSQL in Docker                                       |
| `pnpm db:down`    | Stop PostgreSQL                                                  |
| `pnpm db:deploy`  | Apply migrations                                                 |
| `pnpm db:migrate` | Create and apply a new migration during development              |
| `pnpm db:seed`    | Load sample data                                                 |
| `pnpm db:studio`  | Open Prisma Studio                                               |

## Testing

- `pnpm test` runs two Vitest projects. `unit` covers pure logic (budget math, trip-detail
  patching, follow-up priorities, lifecycle rules, schemas, the OpenAI request mapping and the
  OpenAI web search provider, and the SerpApi and Duffel flight providers and the flight search
  cache against mocked clients, stop changes and validation, the theme question, matching a
  purchase to flights shown earlier, and the calendar layout). `integration` runs against
  `trip_planner_test` and covers authorization, invitations, concurrency, saving flights, the
  database search cache, and the Atlas orchestrator with a scripted provider, including a replay
  of a multi-stop ski trip with a friend's rides and flights bought after earlier searches.
- `pnpm test:e2e` runs Playwright against a production build and the test database. Install the
  browser once with `pnpm exec playwright install chromium`. It starts eight local processes on
  ports 3310 to 3314 and 3317 to 3319: the app with Atlas pointed at a local OpenAI stub and flight
  search pointed at a local Duffel stub (3310), the app with no AI key and no flight key (3311), the
  app with OpenAI web search served by the stub (3312), the app with web search selected but no key
  (3313), the app with Atlas and flight search pointed at a local SerpApi stub (3314), the SerpApi
  stub (3317), the Duffel stub (3318), and the OpenAI stub (3319). No test calls the real OpenAI,
  SerpApi, or Duffel API. Test users get sessions inserted directly into the test database; the app
  has no test-only sign-in route. Flow I replays the Park City trip end to end through the stubs
  and checks Bookings > Flights, the week view, and that nothing mentions a group on a one-person
  trip.

Both suites refuse to run against a database whose name does not end in `_test`.

## Product name

The display name lives in `src/config/brand.ts` and reads `NEXT_PUBLIC_APP_NAME`. The assistant's
name, Atlas, is the `ASSISTANT_NAME` constant in the same file. `NEXT_PUBLIC_` values are inlined
at build time, so rebuild after changing the name.

## Project layout

```
prisma/              schema, migrations, sample seed
src/app/             routes: sign-in, trips dashboard, trip workspace tabs, invites, Auth.js handler
src/components/      UI, grouped by area (atlas, options, tasks, itinerary, bookings, overview)
src/lib/             shared logic: domain rules, validation schemas, labels, dates, money
src/server/          server-only code
  access.ts          trip membership checks
  services/          authorized data access and mutations
  actions/           server actions used by the UI
  ai/                Atlas orchestrator, tools, prompts, provider interface, OpenAI provider
  research/          research provider interface, OpenAI web search, and "not configured"
  flights/           flight search provider interface, SerpApi and Duffel, and the search cache
  financial/         documented extension point for future card and rewards data
tests/               Vitest unit and integration tests
e2e/                 Playwright tests and the local OpenAI, SerpApi, and Duffel stubs
```

## Current limitations

- The only live research provider is OpenAI web search. It returns pages and stated prices, not
  structured flight or hotel inventory, so prices can be out of date by the time someone books.
  With `RESEARCH_PROVIDER="none"`, options are added by hand and Atlas suggests unverified ideas
  without prices.
- Flight search shows Google Flights results through SerpApi, limited by the SerpApi plan's
  quota, and depends on SerpApi keeping up with Google's pages. Prices are in US dollars. There is
  no price tracking and no booking through the app. Duffel runs in test mode only.
- Atlas replies arrive in one piece (no streaming).
- Rate limiting is in memory, which fits a single server process. Use a shared store if you run
  several instances.
- Budgets do not convert currencies; each currency is summarized separately.
- No maps, calendar sync, messaging, or booking execution. See section 18 of the product spec for
  what is deliberately out of scope.
