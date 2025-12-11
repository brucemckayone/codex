/**
 * Neon Testing Setup
 *
 * DEPRECATED: Per-file ephemeral branching has been replaced with
 * workflow-level Neon branches for better cost efficiency.
 *
 * NEW STRATEGY (GitHub Actions workflow-level branches):
 * ======================================================
 * - Each test domain gets ONE dedicated Neon branch (7 total per CI run):
 *   - ci-unit-tests (shared by all package tests)
 *   - ci-auth-tests (auth worker)
 *   - ci-content-api-tests (content-api worker)
 *   - ci-identity-api-tests (identity-api worker)
 *   - ci-ecom-api-tests (ecom-api worker)
 *   - ci-e2e-api-tests (root E2E tests)
 *   - ci-e2e-web-tests (web app E2E tests)
 *
 * COST SAVINGS:
 * - Before: 200+ ephemeral branches per CI run (per-test-file)
 * - After: 7 branches per CI run (per-domain)
 * - Savings: ~97% fewer Neon branches
 *
 * LOCAL DEVELOPMENT (unchanged):
 * - Uses DATABASE_URL from .env.test (LOCAL_PROXY method)
 * - NO branch creation (FREE, unlimited test runs)
 * - Fast execution with no provisioning delay
 *
 * CI/CD (new approach):
 * - GitHub Actions creates Neon branch per test domain
 * - DATABASE_URL is set at workflow level
 * - Tests use shared branch within their domain
 * - Branches cleaned up after workflow completes
 *
 * Migration: Remove all withNeonTestBranch() calls from test files.
 * Tests will automatically use DATABASE_URL from environment.
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
