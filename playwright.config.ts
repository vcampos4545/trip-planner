import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build (`.next-e2e`) and the test database.
 * Two app servers share that build: one with Atlas pointed at a local OpenAI stub, one with no AI
 * key at all. Sign-in sessions are inserted straight into the test database by the fixtures, so
 * the app itself has no test-only sign-in path.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://trip:trip@localhost:5433/trip_planner_test?schema=public";
const AI_PORT = 3310;
const NO_AI_PORT = 3311;
const STUB_PORT = 3319;

const sharedEnv = {
  NODE_ENV: "production",
  NEXT_DIST_DIR: ".next-e2e",
  DATABASE_URL: TEST_DATABASE_URL,
  AUTH_SECRET: "e2e-only-secret-0f1e2d3c4b5a69788796a5b4c3d2e1f0",
  AUTH_GOOGLE_ID: "e2e-google-client-id.apps.googleusercontent.com",
  AUTH_GOOGLE_SECRET: "e2e-google-client-secret",
  RESEARCH_PROVIDER: "none",
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
      testIgnore: /no-ai\.spec\.ts/,
      use: { baseURL: `http://localhost:${AI_PORT}` },
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
      command: `pnpm exec next start --port ${AI_PORT}`,
      url: `http://localhost:${AI_PORT}/signin`,
      env: {
        ...sharedEnv,
        AUTH_URL: `http://localhost:${AI_PORT}`,
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "e2e-stub-key",
        OPENAI_MODEL: "gpt-e2e-stub",
        OPENAI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
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
