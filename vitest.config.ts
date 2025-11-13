import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Define all projects in the monorepo
    projects: [
      'apps/web',
      'packages/database',
      'packages/validation',
      'packages/cloudflare-clients',
      'packages/security',
      'packages/content',
      'packages/test-utils',
      'packages/identity',
      'packages/worker-utils',
      'packages/observability',
      'packages/service-errors',
      'packages/shared-types',
      'workers/auth',
      'workers/stripe-webhook-handler',
      'workers/content-api',
      'workers/identity-api',
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
        '**/wrangler.toml',

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
