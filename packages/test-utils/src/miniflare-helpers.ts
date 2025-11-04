import { Miniflare } from 'miniflare';
import type { MiniflareOptions } from 'miniflare';
import path from 'path';

// Re-export types for convenience
export type { MiniflareOptions } from 'miniflare';

// Miniflare returns its own implementations of these types
// which are compatible but not identical to @cloudflare/workers-types
// Using any here to avoid type conflicts between Miniflare and Workers types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MiniflareKVNamespace = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MiniflareD1Database = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MiniflareR2Bucket = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MiniflareQueue<_Body = any> = any;

type MiniflareWorker = ReturnType<Miniflare['getWorker']>;

/**
 * Helper class for managing Miniflare instances in integration tests.
 * Provides lifecycle management with automatic cleanup.
 */
export class MiniflareTestHelper {
  private mf: Miniflare | null = null;
  private readonly defaultOptions: Partial<MiniflareOptions>;

  constructor(defaultOptions: Partial<MiniflareOptions> = {}) {
    this.defaultOptions = defaultOptions;
  }

  /**
   * Initialize a Miniflare instance with the given options.
   * Merges with default options provided in constructor.
   */
  async setup(options: MiniflareOptions): Promise<Miniflare> {
    if (this.mf) {
      throw new Error(
        'Miniflare instance already initialized. Call cleanup() first.'
      );
    }

    this.mf = new Miniflare({
      ...this.defaultOptions,
      ...options,
    } as MiniflareOptions);

    // Wait for the server to be ready
    await this.mf.ready;

    return this.mf;
  }

  /**
   * Get the current Miniflare instance.
   * Throws if not initialized.
   */
  get instance(): Miniflare {
    if (!this.mf) {
      throw new Error(
        'Miniflare instance not initialized. Call setup() first.'
      );
    }
    return this.mf;
  }

  /**
   * Dispatch a fetch request to the worker.
   * Note: Type casting is needed due to differences between standard fetch types
   * and Miniflare's internal types.
   */
  async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    // Type casting needed due to Miniflare's internal type differences
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return this.instance.dispatchFetch(
      input as any,
      init as any
    ) as unknown as Promise<Response>;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  /**
   * Get all bindings for the worker.
   */
  async getBindings<
    Env extends Record<string, unknown> = Record<string, unknown>,
  >(): Promise<Env> {
    return this.instance.getBindings<Env>();
  }

  /**
   * Get a specific KV namespace binding.
   */
  async getKVNamespace(bindingName: string): Promise<MiniflareKVNamespace> {
    return this.instance.getKVNamespace(bindingName);
  }

  /**
   * Get a specific D1 database binding.
   */
  async getD1Database(bindingName: string): Promise<MiniflareD1Database> {
    return this.instance.getD1Database(bindingName);
  }

  /**
   * Get a specific R2 bucket binding.
   */
  async getR2Bucket(bindingName: string): Promise<MiniflareR2Bucket> {
    return this.instance.getR2Bucket(bindingName);
  }

  /**
   * Get a specific Queue producer binding.
   */
  async getQueueProducer<Body = unknown>(
    bindingName: string
  ): Promise<MiniflareQueue<Body>> {
    return this.instance.getQueueProducer<Body>(bindingName);
  }

  /**
   * Get a worker fetcher (for testing scheduled/queue events).
   */
  async getWorker(): Promise<MiniflareWorker> {
    return this.instance.getWorker();
  }

  /**
   * Clean up the Miniflare instance and shut down the workerd server.
   */
  async cleanup(): Promise<void> {
    if (this.mf) {
      await this.mf.dispose();
      this.mf = null;
    }
  }

  /**
   * Helper to resolve worker script path from a directory containing index.ts or src/index.ts
   */
  static resolveWorkerScript(workerDir: string): string {
    // Try src/index.ts first, then index.ts
    const possibilities = [
      path.join(workerDir, 'src', 'index.ts'),
      path.join(workerDir, 'index.ts'),
    ];

    // Return the first one that exists (we'll let Miniflare handle the error if neither exists)
    return possibilities[0];
  }

  /**
   * Load wrangler.toml configuration path
   */
  static resolveWranglerConfig(workerDir: string): string {
    return path.join(workerDir, 'wrangler.toml');
  }
}

/**
 * Create a Miniflare test helper with common defaults for integration tests.
 */
export function createMiniflareHelper(
  options: Partial<MiniflareOptions> = {}
): MiniflareTestHelper {
  return new MiniflareTestHelper({
    // Default to modules format
    modules: true,
    // Disable cache warnings for tests
    cacheWarnUsage: false,
    // Use in-memory storage by default (no persistence)
    kvPersist: false,
    d1Persist: false,
    r2Persist: false,
    cachePersist: false,
    ...options,
  });
}

/**
 * Vitest lifecycle helper for setting up and cleaning up Miniflare.
 * Use in beforeEach/afterEach hooks.
 */
export function useMiniflare(helper: MiniflareTestHelper) {
  return {
    /**
     * Setup hook - call in beforeEach
     */
    beforeEach: async (options: MiniflareOptions) => {
      await helper.setup(options);
    },

    /**
     * Cleanup hook - call in afterEach
     */
    afterEach: async () => {
      await helper.cleanup();
    },

    /**
     * Get the helper instance
     */
    helper,
  };
}
