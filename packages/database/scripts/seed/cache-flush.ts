import { SERVICE_PORTS } from '@codex/constants';

/**
 * Flush Miniflare CACHE_KV + AUTH_SESSION_KV via the dev-only worker
 * endpoint. Without this step, a fresh DB seed gets served against stale
 * KV state (versioned tier lists, cached sessions for users that no
 * longer exist), so the storefront pricing page can show tiers whose
 * UUIDs no longer exist in the truncated DB.
 *
 * The endpoint self-gates on ENVIRONMENT === 'development' and returns
 * 404 otherwise. This helper logs and continues on any failure — the DB
 * truncate has already succeeded by the time we get here, and the worker
 * may simply not be running (seed-only flow without `pnpm dev`).
 */
export async function flushDevKv(): Promise<void> {
  const url = `http://localhost:${SERVICE_PORTS.ORGANIZATION}/__dev__/flush-kv`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.log(
        `  Skipped KV flush (${response.status} ${response.statusText} from organization-api).`
      );
      return;
    }

    const body = (await response.json()) as {
      flushed?: { cache?: number; session?: number };
    };
    const cache = body.flushed?.cache ?? 0;
    const session = body.flushed?.session ?? 0;
    console.log(`  Flushed KV: ${cache} cache, ${session} session`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `  Skipped KV flush — organization-api unreachable (${message}). Restart \`pnpm dev\` to ensure caches reflect the new DB.`
    );
  }
}
