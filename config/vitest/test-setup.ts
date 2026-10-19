/**
 * Neon Testing Setup
 *
 * DEPRECATED: per-file ephemeral Neon branches are gone, and so are the
 * per-run CI branches that replaced them.
 *
 * - LOCAL: DATABASE_URL_LOCAL_PROXY from .env.test (LOCAL_PROXY method), the
 *   disposable `main_test` on the local Postgres container.
 * - CI: every test job runs a Postgres service container plus the local Neon
 *   proxy (.github/workflows/testing.yml, Codex-75m0t.2), migrated empty from
 *   0001 on every run. DB_METHOD=LOCAL_PROXY and both URLs point at
 *   db.localtest.me:5432/neondb. Only `migration-check` still forks a Neon
 *   branch, of production, to apply the committed migrations to real data.
 *
 * Migration: remove any remaining withNeonTestBranch() calls. Tests use the
 * database URL from the environment.
 */

/**
 * DEPRECATED: withNeonTestBranch() is now a no-op.
 *
 * Neon branch creation has moved to GitHub Actions workflow level.
 * Each test domain gets a dedicated shared branch instead of
 * ephemeral per-file branches.
 *
 * Tests automatically use DATABASE_URL from:
 * - Local: .env.test (LOCAL_PROXY method)
 * - CI: GitHub Actions (NEON_BRANCH method, workflow-created branch)
 *
 * @deprecated Remove calls to this function from test files
 */
export function withNeonTestBranch(): void {
  // No-op - branch created at workflow level
  // Keeping function for backwards compatibility during migration
}
