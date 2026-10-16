import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build (`.next-e2e`) and the test database.
 * Four app servers share that build: Atlas pointed at a local OpenAI stub with live search off,
 * the same with OpenAI web search on (also served by the stub), web search selected without an
 * API key, and no AI key at all. The first has flight search pointed at a local Duffel stub, and a
 * fifth server has the same Atlas setup with flight search pointed at a local SerpApi stub. Sign-in
 * sessions are inserted straight into the test database by the fixtures, so the app itself has no
 * test-only sign-in path.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://trip:trip@localhost:5433/trip_planner_test?schema=public";
const AI_PORT = 3310;
const NO_AI_PORT = 3311;
const WEB_SEARCH_PORT = 3312;
const WEB_SEARCH_NO_KEY_PORT = 3313;
const SERPAPI_PORT = 3314;
const STUB_PORT = 3319;
const DUFFEL_STUB_PORT = 3318;
const SERPAPI_STUB_PORT = 3317;

const sharedEnv = {
  NODE_ENV: "production",
  NEXT_DIST_DIR: ".next-e2e",
  DATABASE_URL: TEST_DATABASE_URL,
  AUTH_SECRET: "e2e-only-secret-0f1e2d3c4b5a69788796a5b4c3d2e1f0",
  AUTH_GOOGLE_ID: "e2e-google-client-id.apps.googleusercontent.com",
  AUTH_GOOGLE_SECRET: "e2e-google-client-secret",
  RESEARCH_PROVIDER: "none",
  DUFFEL_ACCESS_TOKEN: "",
  SERPAPI_API_KEY: "",
  INVITE_TTL_DAYS: "7",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/support/global-setup.ts",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "with-atlas",
      testIgnore: [
        /no-ai\.spec\.ts/,
        /web-search.*\.spec\.ts/,
        /serpapi.*\.spec\.ts/,
      ],
      use: { baseURL: `http://localhost:${AI_PORT}` },
    },
    {
      name: "with-serpapi",
      testMatch: /serpapi.*\.spec\.ts/,
      use: { baseURL: `http://localhost:${SERPAPI_PORT}` },
    },
    {
      name: "with-web-search",
      testMatch: /web-search\.spec\.ts/,
      use: { baseURL: `http://localhost:${WEB_SEARCH_PORT}` },
    },
    {
      name: "web-search-without-key",
      testMatch: /web-search-no-key\.spec\.ts/,
      use: { baseURL: `http://localhost:${WEB_SEARCH_NO_KEY_PORT}` },
    },
    {
      name: "without-ai",
      testMatch: /no-ai\.spec\.ts/,
      use: { baseURL: `http://localhost:${NO_AI_PORT}` },
    },
  ],
  webServer: [
    {
      command: `node e2e/support/openai-stub.mjs`,
      url: `http://127.0.0.1:${STUB_PORT}/health`,
      env: { OPENAI_STUB_PORT: String(STUB_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node e2e/support/duffel-stub.mjs`,
      url: `http://127.0.0.1:${DUFFEL_STUB_PORT}/health`,
      env: { DUFFEL_STUB_PORT: String(DUFFEL_STUB_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node e2e/support/serpapi-stub.mjs`,
      url: `http://127.0.0.1:${SERPAPI_STUB_PORT}/health`,
      env: { SERPAPI_STUB_PORT: String(SERPAPI_STUB_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next start --port ${AI_PORT}`,
      url: `http://localhost:${AI_PORT}/signin`,
      env: {
        ...sharedEnv,
        AUTH_URL: `http://localhost:${AI_PORT}`,
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "e2e-stub-key",
        OPENAI_MODEL: "gpt-e2e-stub",
        OPENAI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
        FLIGHT_PROVIDER: "duffel",
        DUFFEL_ACCESS_TOKEN: "duffel_test_e2e_stub_token",
        DUFFEL_API_URL: `http://127.0.0.1:${DUFFEL_STUB_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm exec next start --port ${SERPAPI_PORT}`,
      url: `http://localhost:${SERPAPI_PORT}/signin`,
      env: {
        ...sharedEnv,
        AUTH_URL: `http://localhost:${SERPAPI_PORT}`,
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "e2e-stub-key",
        OPENAI_MODEL: "gpt-e2e-stub",
        OPENAI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
        FLIGHT_PROVIDER: "serpapi",
        SERPAPI_API_KEY: "serpapi_e2e_stub_key",
        SERPAPI_API_URL: `http://127.0.0.1:${SERPAPI_STUB_PORT}`,
        SERPAPI_CACHE_HOURS: "3",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm exec next start --port ${WEB_SEARCH_PORT}`,
      url: `http://localhost:${WEB_SEARCH_PORT}/signin`,
      env: {
        ...sharedEnv,
        AUTH_URL: `http://localhost:${WEB_SEARCH_PORT}`,
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "e2e-stub-key",
        OPENAI_MODEL: "gpt-e2e-stub",
        OPENAI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
        RESEARCH_PROVIDER: "openai_web",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm exec next start --port ${WEB_SEARCH_NO_KEY_PORT}`,
      url: `http://localhost:${WEB_SEARCH_NO_KEY_PORT}/signin`,
      env: {
        ...sharedEnv,
        AUTH_URL: `http://localhost:${WEB_SEARCH_NO_KEY_PORT}`,
        OPENAI_API_KEY: "",
        RESEARCH_PROVIDER: "openai_web",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm exec next start --port ${NO_AI_PORT}`,
      url: `http://localhost:${NO_AI_PORT}/signin`,
      env: {
        ...sharedEnv,
        AUTH_URL: `http://localhost:${NO_AI_PORT}`,
        OPENAI_API_KEY: "",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
