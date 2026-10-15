import path from "node:path";

import { defineConfig } from "vitest/config";

const root = path.dirname(new URL(import.meta.url).pathname);

// Keep in sync with tests/support/test-database.ts (imported there by test code).
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://trip:trip@localhost:5433/trip_planner_test?schema=public";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      // `server-only` throws outside a React Server Components bundle; tests import server code directly.
      "server-only": path.join(root, "tests/support/empty-module.ts"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          fileParallelism: false,
          env: {
            DATABASE_URL: TEST_DATABASE_URL,
            OPENAI_API_KEY: "",
            RESEARCH_PROVIDER: "none",
            DUFFEL_ACCESS_TOKEN: "",
          },
        },
      },
    ],
  },
});
