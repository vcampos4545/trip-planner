/**
 * Integration and end-to-end tests use their own database so they never touch development data.
 * docker-compose.yml creates `trip_planner_test` next to the development database.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://trip:trip@localhost:5433/trip_planner_test?schema=public";

export function assertTestDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against "${name}". The test database name must end with "_test".`,
    );
  }
}
