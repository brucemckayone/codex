import path from 'node:path';
import { neonTesting } from 'neon-testing/vite';
import type { UserProjectConfigExport } from 'vitest/config';
import { defineProject } from 'vitest/config';

export interface PackageVitestConfigOptions {
  /**
   * Package name (e.g., 'database', 'validation')
   * Used for naming the test project and setting up aliases
   */
  packageName: string;

  /**
   * Additional package aliases for resolution
   * Common pattern: '@codex/package-name': path.resolve(__dirname, './src')
   * @default { '@codex/{packageName}': './src' }
   */
  aliases?: Record<string, string>;

  /**
   * Setup files to run before tests
   * @default []
   */
  setupFiles?: string[];

  /**
   * Test timeout in milliseconds
   * @default 10000
   */
  testTimeout?: number;

  /**
   * Hook timeout in milliseconds
   * @default 10000
   */
  hookTimeout?: number;

  /**
   * Whether to run tests sequentially (no parallelism)
   * Useful for database tests that share state
   * @default false
   */
  sequentialTests?: boolean;

  /**
   * Enable Neon Testing plugin for database integration tests
   * Creates ephemeral Neon branches for each test file
   * @default false
   */
  enableNeonTesting?: boolean;

  /**
   * Custom test file patterns
   * @default ['src/**\/*.{test,spec}.{js,ts}']
   */
  include?: string[];

  /**
   * Enable coverage reporting
   * @default true
   */
  enableCoverage?: boolean;

  /**
   * Coverage include patterns
   * @default ['src/**\/*.ts']
   */
  coverageInclude?: string[];

  /**
   * Coverage exclude patterns
   * @default ['src/**\/*.test.ts', 'src/**\/*.spec.ts', 'src/index.ts']
   */
  coverageExclude?: string[];

  /**
   * Additional test configuration overrides
   * @default {}
   */
  additionalTestConfig?: Record<string, unknown>;
}

/**
 * Standard Vitest configuration for shared packages
 *
 * This configuration provides consistent test settings across all packages:
 * - Global test APIs enabled (describe, it, expect)
 * - Node environment for testing
 * - Standard test file patterns
 * - Coverage reporting configured
 * - Package-specific aliases for imports
 *
 * Tests run in Node.js environment, suitable for library code.
 *
 * Usage:
 * ```typescript
 * // packages/validation/vitest.validation.config.ts
 * import { packageVitestConfig } from '../../config/vitest/package.config';
 * export default packageVitestConfig({ packageName: 'validation' });
 * ```
 *
 * For custom configurations:
 * ```typescript
 * // packages/database/vitest.database.config.ts
 * import { createPackageTestConfig } from '../../config/vitest/package.config';
 *
 * export default createPackageTestConfig({
 *   packageName: 'database',
 *   setupFiles: ['../../vitest.setup.ts'],
 *   testTimeout: 60000,
 *   sequentialTests: true,
 * });
 * ```
 */
export function packageVitestConfig(
  options: PackageVitestConfigOptions
): UserProjectConfigExport {
  const {
    packageName,
    aliases = {},
    setupFiles = [],
    testTimeout = 10000,
    hookTimeout = 10000,
    sequentialTests = false,
    enableNeonTesting = false,
    include = ['src/**/*.{test,spec}.{js,ts}'],
    enableCoverage = true,
    coverageInclude = ['src/**/*.ts'],
    coverageExclude = ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/index.ts'],
    additionalTestConfig = {},
  } = options;

  // Build the default alias for the package itself
  const defaultAlias = {
    [`@codex/${packageName}`]: path.resolve(
      process.cwd(),
      `packages/${packageName}/src`
    ),
  };

  // Resolve user-provided aliases
  const resolvedAliases = Object.entries(aliases).reduce(
    (acc, [key, value]) => {
      acc[key] = path.resolve(process.cwd(), value);
      return acc;
    },
    {} as Record<string, string>
  );

  const coverageConfig = enableCoverage
    ? {
        coverage: {
          provider: 'v8' as const,
          reporter: ['text', 'json', 'html'],
          include: coverageInclude,
          exclude: coverageExclude,
        },
      }
    : {};

  const sequentialConfig = sequentialTests
    ? {
        fileParallelism: false,
      }
    : {};

  // COST OPTIMIZATION: Only use neon-testing in CI to avoid local branch creation costs
  // Local development uses DATABASE_URL from .env.dev (LOCAL_PROXY method - FREE)
  // CI uses neon-testing to create ephemeral branches per test file (Isolated)
  const shouldUseNeonTesting = enableNeonTesting && process.env.CI === 'true';
  const plugins = shouldUseNeonTesting ? [neonTesting()] : [];

  return defineProject({
    plugins,
    test: {
      name: `@codex/${packageName}`,
      globals: true,
      environment: 'node',
      include,
      setupFiles,
      testTimeout,
      hookTimeout,
      ...sequentialConfig,
      ...coverageConfig,
      ...additionalTestConfig,
    },
    resolve: {
      alias: {
        ...defaultAlias,
        ...resolvedAliases,
      },
    },
  });
}

/**
 * Alias for packageVitestConfig for consistency with naming patterns
 * @deprecated Use packageVitestConfig instead
 */
export const createPackageTestConfig = packageVitestConfig;
