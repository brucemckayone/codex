/**
 * Wrangler Dev Server Test Utilities
 *
 * Provides utilities for running Cloudflare Workers via wrangler dev
 * during integration tests. This is an alternative to Miniflare that
 * works with Vitest 4.0+ and provides true integration testing against
 * real worker servers.
 *
 * Usage:
 * ```typescript
 * import { startWranglerDev, stopWranglerDev } from '@codex/test-utils';
 *
 * describe('My Worker Integration Tests', () => {
 *   let workerUrl: string;
 *   let cleanup: () => Promise<void>;
 *
 *   beforeAll(async () => {
 *     const result = await startWranglerDev({
 *       workerPath: './workers/auth',
 *       port: 8787,
 *       env: {
 *         DATABASE_URL: process.env.DATABASE_URL,
 *         ENVIRONMENT: 'test',
 *       },
 *     });
 *     workerUrl = result.url;
 *     cleanup = result.cleanup;
 *   });
 *
 *   afterAll(async () => {
 *     await cleanup();
 *   });
 *
 *   it('should respond to requests', async () => {
 *     const response = await fetch(`${workerUrl}/health`);
 *     expect(response.ok).toBe(true);
 *   });
 * });
 * ```
 */

import { spawn, type ChildProcess } from 'child_process';
import { once } from 'events';

export interface WranglerDevOptions {
  /**
   * Path to the worker directory (containing wrangler.toml)
   * @example './workers/auth'
   */
  workerPath: string;

  /**
   * Port for the dev server
   * @default 8787
   */
  port?: number;

  /**
   * Environment variables to pass to the worker
   */
  env?: Record<string, string>;

  /**
   * Wrangler environment to use (staging, production, etc.)
   */
  wranglerEnv?: string;

  /**
   * Timeout for server startup in milliseconds
   * @default 30000
   */
  startupTimeout?: number;

  /**
   * Whether to log wrangler output (useful for debugging)
   * @default false
   */
  verbose?: boolean;
}

export interface WranglerDevServer {
  /**
   * Base URL of the running worker
   * @example 'http://localhost:8787'
   */
  url: string;

  /**
   * Port the worker is running on
   */
  port: number;

  /**
   * Cleanup function to stop the server
   */
  cleanup: () => Promise<void>;

  /**
   * Process ID of the wrangler dev server
   */
  pid: number;
}

/**
 * Start a wrangler dev server for integration testing
 *
 * Spawns a wrangler dev process, waits for it to be ready,
 * and returns connection details plus a cleanup function.
 *
 * @param options - Configuration for the dev server
 * @returns Server details and cleanup function
 *
 * @throws Error if server fails to start within timeout
 */
export async function startWranglerDev(
  options: WranglerDevOptions
): Promise<WranglerDevServer> {
  const {
    workerPath,
    port = 8787,
    env = {},
    wranglerEnv,
    startupTimeout = 30000,
    verbose = false,
  } = options;

  // Build wrangler dev command
  const args = ['wrangler', 'dev', '--port', port.toString(), '--local'];

  if (wranglerEnv) {
    args.push('--env', wranglerEnv);
  }

  // Spawn wrangler dev process
  const childProcess: ChildProcess = spawn('pnpm', args, {
    cwd: workerPath,
    env: {
      // eslint-disable-next-line no-undef
      ...process.env,
      ...env,
      // Disable wrangler update checks in CI/tests
      WRANGLER_SEND_METRICS: 'false',
    },
    stdio: verbose ? 'inherit' : 'pipe',
  });

  if (!childProcess.pid) {
    throw new Error('Failed to spawn wrangler dev process');
  }

  const processId = childProcess.pid;

  // Setup cleanup function
  const cleanup = async (): Promise<void> => {
    if (childProcess.killed) {
      return;
    }

    // Try graceful shutdown first
    childProcess.kill('SIGTERM');

    // Wait up to 5 seconds for graceful shutdown
    const timeout = setTimeout(() => {
      if (!childProcess.killed) {
        childProcess.kill('SIGKILL');
      }
    }, 5000);

    try {
      await once(childProcess, 'exit');
    } catch {
      // Process may have already exited
    } finally {
      clearTimeout(timeout);
    }
  };

  // Setup error handling
  const startupError = new Promise<never>((_, reject) => {
    childProcess.on('error', (error) => {
      reject(
        new Error(`Wrangler dev process error: ${error.message}`, {
          cause: error,
        })
      );
    });

    childProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        reject(
          new Error(
            `Wrangler dev exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`
          )
        );
      }
    });
  });

  // Wait for server to be ready
  const serverReady = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Wrangler dev serverclear did not start within ${startupTimeout}ms timeout`
        )
      );
    }, startupTimeout);

    // Listen for ready signal in output
    // eslint-disable-next-line no-undef
    const checkOutput = (data: Buffer) => {
      const output = data.toString();

      if (verbose) {
        console.log('[wrangler dev]', output);
      }

      // Wrangler logs this when server is ready
      if (
        output.includes('Ready on') ||
        output.includes(`http://localhost:${port}`) ||
        output.includes('⎔ Starting local server')
      ) {
        clearTimeout(timeout);
        resolve();
      }
    };

    if (childProcess.stdout) {
      childProcess.stdout.on('data', checkOutput);
    }
    if (childProcess.stderr) {
      childProcess.stderr.on('data', checkOutput);
    }
  });

  try {
    // Race between server ready and errors/timeout
    await Promise.race([serverReady, startupError]);
  } catch (error) {
    // Cleanup if startup fails
    await cleanup().catch(() => {});
    throw error;
  }

  // Additional verification: try to fetch health endpoint
  const url = `http://localhost:${port}`;
  const maxHealthCheckAttempts = 10;
  const healthCheckDelay = 500;

  for (let attempt = 0; attempt < maxHealthCheckAttempts; attempt++) {
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        // Server is definitely ready
        break;
      }
    } catch (error) {
      // Server not ready yet, wait and retry
      if (attempt === maxHealthCheckAttempts - 1) {
        await cleanup().catch(() => {});
        throw new Error(
          `Worker health check failed after ${maxHealthCheckAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, healthCheckDelay));
    }
  }

  return {
    url,
    port,
    cleanup,
    pid: processId,
  };
}

/**
 * Stop a running wrangler dev server
 *
 * Convenience function if you stored the cleanup function separately.
 *
 * @param server - Server instance returned from startWranglerDev
 */
export async function stopWranglerDev(
  server: WranglerDevServer
): Promise<void> {
  await server.cleanup();
}

/**
 * Create a fetch function bound to a specific worker URL
 *
 * Convenience helper to make test requests cleaner.
 *
 * @param baseUrl - Base URL of the worker
 * @returns Fetch function with baseUrl prepended
 *
 * @example
 * ```typescript
 * const workerFetch = createWorkerFetch(workerUrl);
 * const response = await workerFetch('/health');
 * ```
 */
export function createWorkerFetch(baseUrl: string) {
  return (path: string, init?: RequestInit): Promise<Response> => {
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
    return fetch(url, init);
  };
}
