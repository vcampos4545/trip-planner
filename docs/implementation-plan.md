# Implementation plan (MVP 0.1.0)

This is the short plan for the first release of the group trip planner. The repository
started empty, so there are no prior conventions to preserve.

## Stack

- Next.js 16 (App Router), React 19, TypeScript 6 in strict mode
- Tailwind CSS 4 with shadcn/ui components and lucide icons
- PostgreSQL 17 via `docker-compose.yml`, Prisma 7 with the `pg` driver adapter
- Auth.js (`next-auth` v5) with Google OAuth and database sessions (Prisma adapter)
- OpenAI through the official `openai` SDK, Responses API with function tools
- Zod for validation, React Hook Form for the larger forms
- Vitest (unit plus database integration tests), Playwright (end-to-end)
- pnpm via corepack

## Architecture in one paragraph

Server components read through a small service layer (`src/server/services`). Every
service call takes the signed-in user and checks trip membership before it reads or
writes, so a trip ID from the client is never proof of access. Mutations go through
server actions that validate with Zod, run in transactions where several rows change,
write an activity log entry, and use a `version` column to reject stale edits. Pure
domain logic (budget math, next-action, draft merging, follow-up priorities, status
rules) lives in `src/lib/domain` so it can be unit tested without a database.

## AI design

- One orchestrator (`src/server/ai/orchestrator.ts`) and a small set of tools:
  read trip state, update trip details, search options, save a research option,
  list saved research, suggest a task, propose an itinerary event, summarize
  outstanding decisions.
- The provider interface (`LlmProvider`) hides OpenAI specifics. Tool arguments are
  validated with Zod before anything touches the database.
- The conversation is not the database. Each turn extracts a small validated patch.
  Unknown fields are filled directly. Changing a field that already has a value
  becomes a pending proposal the user must confirm.
- AI suggested tasks, options, and itinerary events are stored with a suggested status
  and need a person to accept them.
- Without `OPENAI_API_KEY` the app still runs. Atlas shows that it needs configuration,
  and every feature has a manual path.

## Research provider

`ResearchProvider` interface with a "not configured" implementation. The UI says live
research is unavailable and offers manual entry. Options keep source URL, provider,
price, currency, origin, and retrieval time.

## Build order

1. Plan (this file)
2. App structure, tooling, environment config, docker compose
3. Prisma schema and first migration
4. Google sign-in, sessions, protected routes, app shell
5. Trips dashboard and trip workspace
6. Conversational trip creation with persisted structured state
7. Members and invitations, tasks and decisions, saved options, bookings and budget,
   itinerary
8. OpenAI provider and research provider wiring
9. Sample seed data, clearly labelled
10. Unit and authorization tests
11. Playwright tests for the section 17 flows
12. Format, lint, typecheck, test, build, and a `pnpm dev` smoke check

## Testing approach

- Unit tests for domain logic and the OpenAI request mapping (mocked client).
- Integration tests (Vitest, real Postgres test database) for authorization,
  invitations, and the orchestrator running against a scripted mock provider.
- Playwright runs against a production build. Sessions are seeded directly into the
  test database, so the app has no test-only sign-in path. AI flows run against a
  local stub of the OpenAI HTTP API through the standard `OPENAI_BASE_URL` setting.

## Scope

Section 18 items are out of scope. The financial-data provider is a documented
interface only, with no schema and no integration.
