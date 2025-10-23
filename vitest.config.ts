import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Define all projects in the monorepo
    projects: [
      'apps/web',
      'packages/database',
      'packages/validation',
      'packages/cloudflare-clients',
      'packages/core-services',
      'packages/auth',
      'packages/notifications',
      'packages/test-utils',
      'workers/queue-consumer',
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

        // E2E tests
        '**/e2e/**',
        '**/*.spec.ts',
      ],

      // Coverage thresholds
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
        perFile: true,
        autoUpdate: false,
      },

      // Advanced options
      all: true, // Include all files, even untested ones
      clean: true, // Clean coverage directory before each run
      cleanOnRerun: true,
    },
  },
});
