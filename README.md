# Trip Planner

A group trip planner with an AI assistant named Atlas. A group shares one workspace per trip:
details and preferences, saved options, votes, tasks, a day-by-day itinerary, bookings, and a
budget summary. Atlas reads and updates that shared record through validated tools instead of
treating each chat as a one-off.

"Trip Planner" is a placeholder product name. Set `NEXT_PUBLIC_APP_NAME` to change it (see
[Product name](#product-name)).

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
   `RESEARCH_PROVIDER="openai_web"` (see [Live web search](#live-web-search)). Leave
   `DATABASE_URL` as it is to use the Docker database.

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

3. Restart the app. The Plan with AI tab shows "Live search: OpenAI web search".

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
  unknown value, the Options and Plan tabs say live research is unavailable and why. If a search
  fails, Atlas shows "Live research failed" and nothing is saved.

Cost: OpenAI bills each web search tool call (about $10 per 1,000 calls at the time of writing)
plus the search content tokens at the model's token rates. Check
https://developers.openai.com/api/docs/pricing for current prices.

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
  OpenAI web search provider against a mocked client). `integration` runs against `trip_planner_test` and covers authorization,
  invitations, concurrency, and the Atlas orchestrator with a scripted provider.
- `pnpm test:e2e` runs Playwright against a production build and the test database. Install the
  browser once with `pnpm exec playwright install chromium`. It starts five local processes on
  ports 3310 to 3313 and 3319: the app with Atlas pointed at a local OpenAI stub (3310), the app
  with no AI key (3311), the app with OpenAI web search served by the stub (3312), the app with web
  search selected but no key (3313), and the stub itself. No test calls the real OpenAI API. Test users get sessions inserted directly into the test database; the
  app has no test-only sign-in route.

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
  financial/         documented extension point for future card and rewards data
tests/               Vitest unit and integration tests
e2e/                 Playwright tests and the local OpenAI stub
```

## Current limitations

- The only live research provider is OpenAI web search. It returns pages and stated prices, not
  structured flight or hotel inventory, so prices can be out of date by the time someone books.
  With `RESEARCH_PROVIDER="none"`, options are added by hand and Atlas suggests unverified ideas
  without prices.
- Atlas replies arrive in one piece (no streaming).
- Rate limiting is in memory, which fits a single server process. Use a shared store if you run
  several instances.
- Budgets do not convert currencies; each currency is summarized separately.
- No maps, calendar sync, messaging, or booking execution. See section 18 of the product spec for
  what is deliberately out of scope.
