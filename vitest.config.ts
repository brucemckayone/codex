import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Global setup file - loads environment variables for all tests
    setupFiles: ['./vitest.setup.ts'],

    // Define all projects in the monorepo
    // NOTE: Workers are excluded because they use Vitest 3.2.x with @cloudflare/vitest-pool-workers
    // which only supports Vitest 2.0.x - 3.2.x. The root uses Vitest 4.x for the rest of the codebase.
    // Run worker tests separately: pnpm test:workers or pnpm test:all
    // Package projects use custom config file naming (vitest.PACKAGENAME.config.ts)
    projects: [
      'apps/web',
      'packages/database/vitest.config.database.ts',
      'packages/validation/vitest.config.validation.ts',
      'packages/cloudflare-clients/vitest.config.cloudflare-clients.ts',
      'packages/security/vitest.config.security.ts',
      'packages/content/vitest.config.content.ts',
      'packages/test-utils/vitest.config.test-utils.ts',
      'packages/identity/vitest.config.identity.ts',
      'packages/worker-utils/vitest.config.worker-utils.ts',
      'packages/observability/vitest.config.observability.ts',
      'packages/service-errors',
      'packages/shared-types',
    ],

    // Global coverage configuration (cannot be overridden in projects)
    coverage: {
      provider: 'v8',
      enabled: false, // Enable via --coverage flag
      reportsDirectory: './coverage',
      reporter: ['text', 'json', 'html', 'lcov'],

      // Include patterns (workspace-wide)
      include: [
        'apps/*/src/**/*.{js,ts,svelte}',
        'packages/*/src/**/*.{js,ts}',
        'workers/*/src/**/*.{js,ts}',
      ],

      // Exclude patterns
      exclude: [
        // Test files
        '**/*.{test,spec}.{js,ts}',
        '**/tests/**',
        '**/__tests__/**',

        // Build artifacts
        '**/node_modules/**',
        '**/dist/**',
        '**/.svelte-kit/**',
        '**/build/**',
        '**/.wrangler/**',

        // Configuration files
        '**/vitest.config.{js,ts}',
        '**/vite.config.{js,ts}',
        '**/wrangler.jsonc',

        // Entry points (usually just re-exports)
        '**/index.{js,ts}',

        // Database migrations
        '**/migrations/**',

        // SvelteKit specific
        'apps/*/src/routes/**/+*.{js,ts}', // Route files
        'apps/*/src/app.{html,d.ts}',
        'apps/*/src/lib/**/*.svelte', // Svelte components (UI only, no logic yet)

        // E2E tests
        '**/e2e/**',
        '**/*.spec.ts',

        // Placeholder files (no actual implementation yet)
        '**/placeholder.{js,ts}',
        '**/*placeholder*.{js,ts}',
        'packages/database/src/client.ts',
        'packages/database/src/schema/index.ts',
        'packages/cloudflare-clients/src/**/*.ts',
        'packages/validation/src/user-schema.ts',
        'packages/test-utils/src/database.ts',
        'packages/test-utils/src/factories.ts',
        'packages/test-utils/src/helpers.ts',
      ],

      // Coverage thresholds - Disabled for clean slate setup
      // Re-enable when actual feature implementation begins
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
        perFile: false,
        autoUpdate: false,
      },

      // Advanced options
      clean: true, // Clean coverage directory before each run
      cleanOnRerun: true,
    },
  },
});
