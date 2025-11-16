import path from 'node:path';
import { defineConfig, type PluginOption, type UserConfig } from 'vite';
import dts from 'vite-plugin-dts';

export interface PackageViteConfigOptions {
  /**
   * Package name (e.g., 'database', 'validation')
   */
  packageName: string;

  /**
   * Entry point(s) relative to package directory
   * Can be a single string or an object for multiple entry points
   * @default 'src/index.ts'
   * @example 'src/index.ts'
   * @example { index: 'src/index.ts', 'schema/index': 'src/schema/index.ts' }
   */
  entry?: string | Record<string, string>;

  /**
   * Additional external dependencies to exclude from bundle
   * Common externals like zod and @neondatabase/serverless are already included
   * @default []
   */
  additionalExternals?: (string | RegExp)[];

  /**
   * Additional Vite plugins
   * @default []
   */
  plugins?: PluginOption[];
}

/**
 * Create standardized Vite config for shared packages
 *
 * This factory creates consistent Vite configurations for all shared packages,
 * ensuring:
 * - Consistent output paths (dist/)
 * - Common dependencies are externalized (zod, @neondatabase/serverless)
 * - Other @codex/* packages are externalized
 * - TypeScript declarations are generated
 * - Source maps are enabled for debugging
 *
 * @example
 * ```typescript
 * // packages/validation/vite.validation.config.ts
 * import { createPackageConfig } from '../../config/vite/package.config';
 *
 * export default createPackageConfig({
 *   packageName: 'validation',
 * });
 * ```
 *
 * @example With additional externals
 * ```typescript
 * // packages/database/vite.database.config.ts
 * import { createPackageConfig } from '../../config/vite/package.config';
 *
 * export default createPackageConfig({
 *   packageName: 'database',
 *   additionalExternals: [
 *     'drizzle-orm',
 *     'drizzle-kit',
 *     'better-auth',
 *     'better-auth/adapters/drizzle',
 *   ],
 * });
 * ```
 */
export function createPackageConfig(
  options: PackageViteConfigOptions
): UserConfig {
  const {
    packageName,
    entry = 'src/index.ts',
    additionalExternals = [],
    plugins = [],
  } = options;

  // Normalize entry to always be an object or resolved path
  const normalizedEntry: string | Record<string, string> =
    typeof entry === 'string'
      ? path.resolve(__dirname, `../../packages/${packageName}`, entry)
      : Object.fromEntries(
          Object.entries(entry).map(([key, value]) => [
            key,
            path.resolve(__dirname, `../../packages/${packageName}`, value),
          ])
        );

  return defineConfig({
    build: {
      lib: {
        entry: normalizedEntry,
        formats: ['es'],
        fileName: typeof entry === 'string' ? 'index' : undefined,
      },
      outDir: path.resolve(__dirname, `../../packages/${packageName}/dist`),
      sourcemap: true,
      rollupOptions: {
        external: [
          // Common dependencies (never bundle these)
          'zod',
          '@neondatabase/serverless',

          // Shared packages (never bundle @codex/* packages)
          /^@codex\//,

          // Package-specific externals
          ...additionalExternals,
        ],
      },
    },
    plugins: [
      dts({
        outDir: path.resolve(__dirname, `../../packages/${packageName}/dist`),
        entryRoot: path.resolve(__dirname, `../../packages/${packageName}/src`),
        include: [
          path.resolve(__dirname, `../../packages/${packageName}/src/**/*`),
        ],
        exclude: [
          '**/*.test.ts',
          '**/*.spec.ts',
          '**/__test__/**',
          '**/__tests__/**',
        ],
      }) as PluginOption,
      ...plugins,
    ],
  });
}
