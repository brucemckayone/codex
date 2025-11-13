import { defineConfig, PluginOption, UserConfig } from 'vite';
import path from 'path';
import dts from 'vite-plugin-dts';

export interface WorkerViteConfigOptions {
  /**
   * Worker name (e.g., 'content-api')
   */
  workerName: string;

  /**
   * Entry point relative to worker directory
   * @default 'src/index.ts'
   */
  entry?: string;

  /**
   * Additional external dependencies to exclude from bundle
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
 * Create standardized Vite config for Cloudflare Worker
 *
 * This factory creates consistent Vite configurations for all Cloudflare Workers,
 * ensuring:
 * - Consistent output paths (dist/index.js)
 * - Shared packages are externalized (@codex/*)
 * - Runtime dependencies are externalized (hono)
 * - TypeScript declarations are generated
 * - Source maps are enabled for debugging
 *
 * @example
 * ```typescript
 * // workers/content-api/vite.config.ts
 * import { createWorkerConfig } from '../../config/vite/worker.config';
 *
 * export default createWorkerConfig({
 *   workerName: 'content-api',
 * });
 * ```
 *
 * @example With additional externals
 * ```typescript
 * // workers/auth/vite.config.ts
 * import { createWorkerConfig } from '../../config/vite/worker.config';
 *
 * export default createWorkerConfig({
 *   workerName: 'auth',
 *   additionalExternals: ['better-auth'],
 * });
 * ```
 */
export function createWorkerConfig(
  options: WorkerViteConfigOptions
): UserConfig {
  const {
    workerName,
    entry = 'src/index.ts',
    additionalExternals = [],
    plugins = [],
  } = options;

  return defineConfig({
    build: {
      target: 'esnext',
      outDir: path.resolve(__dirname, `../../workers/${workerName}/dist`),
      minify: false,
      sourcemap: true,
      lib: {
        entry: path.resolve(__dirname, `../../workers/${workerName}`, entry),
        formats: ['es'],
        fileName: 'index',
      },
      rollupOptions: {
        external: [
          // Shared packages (never bundle @codex/* packages)
          /^@codex\//,

          // Runtime dependencies (provided by Cloudflare Workers)
          'hono',

          // Worker-specific externals
          ...additionalExternals,
        ],
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, `../../workers/${workerName}/src`),
      },
    },
    plugins: [
      dts({
        outDir: path.resolve(__dirname, `../../workers/${workerName}/dist`),
        include: [path.resolve(__dirname, `../../workers/${workerName}/src`)],
      }) as PluginOption,
      ...plugins,
    ],
  });
}
