/**
 * Creator Studio Earnings — server load (WP9 — Codex-69t7c.9)
 *
 * Handles two Stripe Connect return flows before loading data:
 *   ?connect=success  → call syncMyConnect so the page reflects the new state
 *   ?connect=refresh  → onboarding was abandoned; surface the "resume" banner
 *
 * Data strategy (Shell + Stream):
 *   AWAIT  connectStatus  — drives the connect-state banner (critical for page structure)
 *   STREAM earningsSummary — KPI cards, and the money waiting for setup
 *   STREAM payouts         — paginated ledger, each row with its bank date
 *   STREAM stripeBalance   — the next bank payout and a balance below zero
 *                            (connected accounts only; ecom-api caches it)
 *
 * A streamed read that failed is `{ ok: false }`, so the page shows its error
 * with Retry: never "No payouts yet", empty KPIs or £0.00.
 */
import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  locals,
  url,
  platform,
  cookies,
}) => {
  // Auth guard (layout.server.ts already handles this, but belt-and-suspenders)
  if (!locals.user) {
    redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  // NOTE: do NOT call setHeaders('Cache-Control') here. The studio
  // +layout.server.ts already sets CACHE_HEADERS.PRIVATE for the whole studio
  // subtree. SvelteKit forbids setting the same response header twice across
  // the load chain — on an invalidated __data.json re-run (where both the
  // layout node and this page node re-run), a duplicate setHeaders throws
  // '"Cache-Control" header is already set', surfacing as a studio INTERNAL_ERROR.
  const api = createServerApi(platform, cookies);

  // ── Connect-return handling ────────────────────────────────────────────────
  // Stripe redirects back with ?connect=success (onboarding complete) or
  // ?connect=refresh (onboarding abandoned / link expired).
  // We fire a sync BEFORE the page data load so the returned connectStatus
  // reflects the freshest Stripe state.
  const connectParam = url.searchParams.get('connect');
  let connectReturnBanner: 'success' | 'sync_failed' | 'refresh' | null = null;

  if (connectParam === 'success') {
    try {
      await api.connect.syncMyStatus();
      connectReturnBanner = 'success';
    } catch (err) {
      const errorId = locals.requestId ?? crypto.randomUUID();
      logger.error(
        'earnings-load:syncMyStatus failed on connect=success return',
        {
          errorId,
          error: err instanceof Error ? err.message : String(err),
          userId: locals.user.id,
        }
      );
      // Do NOT report success — tell the UI the sync failed so it can warn
      connectReturnBanner = 'sync_failed';
    }
  } else if (connectParam === 'refresh') {
    connectReturnBanner = 'refresh';
  }

  // ── Critical: connect status (awaited — drives page structure) ────────────
  // On fetch failure return a distinct sentinel so the UI can show "retry",
  // not silently treat the creator as never having set up payouts.
  type ConnectStatusResult =
    | Awaited<ReturnType<typeof api.connect.getMyStatus>>
    | { fetchFailed: true };

  const connectStatus: ConnectStatusResult = await api.connect
    .getMyStatus()
    .catch((err) => {
      const errorId = locals.requestId ?? crypto.randomUUID();
      logger.error('earnings-load:getMyStatus failed', {
        errorId,
        error: err instanceof Error ? err.message : String(err),
        userId: locals.user?.id,
      });
      return { fetchFailed: true as const };
    });

  // ── Streamed: earnings summary + payouts ──────────────────────────────────
  const earningsSummary = api.subscription
    .getMyEarningsSummary(new URLSearchParams())
    .then((summary) => ({ ok: true as const, summary }))
    .catch((err) => {
      const errorId = locals.requestId ?? crypto.randomUUID();
      logger.error('earnings-load:getMyEarningsSummary failed', {
        errorId,
        error: err instanceof Error ? err.message : String(err),
        userId: locals.user?.id,
      });
      return { ok: false as const };
    });

  const payoutsParams = new URLSearchParams();
  payoutsParams.set('status', 'all');
  payoutsParams.set('source', 'all');
  payoutsParams.set('page', '1');
  payoutsParams.set('limit', '20');
  const payouts = api.subscription
    .getMyPayouts(payoutsParams)
    .then((list) => ({ ok: true as const, list }))
    .catch((err) => {
      const errorId = locals.requestId ?? crypto.randomUUID();
      logger.error('earnings-load:getMyPayouts failed', {
        errorId,
        error: err instanceof Error ? err.message : String(err),
        userId: locals.user?.id,
      });
      return { ok: false as const };
    });

  // ── Streamed: the Stripe balance (Codex-2hxff.29, .30) ────────────────────
  // Only a connected account has one (the route 404s otherwise). A failed read
  // is `{ ok: false }`, so the card says it couldn't check, never £0.00. One
  // read per load: nothing polls, and Retry reloads the page.
  const isConnected =
    !('fetchFailed' in connectStatus) && connectStatus.isConnected;
  const stripeBalance = isConnected
    ? api.connect
        .getMyBalance()
        .then((balance) => ({ ok: true as const, balance }))
        .catch((err) => {
          const errorId = locals.requestId ?? crypto.randomUUID();
          logger.error('earnings-load:getMyBalance failed', {
            errorId,
            error: err instanceof Error ? err.message : String(err),
            userId: locals.user?.id,
          });
          return { ok: false as const };
        })
    : Promise.resolve(null);

  return {
    connectStatus,
    connectReturnBanner,
    earningsSummary,
    payouts,
    stripeBalance,
  };
};
