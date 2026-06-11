/**
 * Creator Studio Earnings — server load (WP9 — Codex-69t7c.9)
 *
 * Handles two Stripe Connect return flows before loading data:
 *   ?connect=success  → call syncMyConnect so the page reflects the new state
 *   ?connect=refresh  → onboarding was abandoned; surface the "resume" banner
 *
 * Data strategy (Shell + Stream):
 *   AWAIT  connectStatus  — drives the connect-state banner (critical for page structure)
 *   STREAM earningsSummary — KPI cards
 *   STREAM payouts         — paginated ledger
 */
import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  locals,
  url,
  platform,
  cookies,
  setHeaders,
}) => {
  // Auth guard (layout.server.ts already handles this, but belt-and-suspenders)
  if (!locals.user) {
    redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  setHeaders(CACHE_HEADERS.PRIVATE);

  const api = createServerApi(platform, cookies);

  // ── Connect-return handling ────────────────────────────────────────────────
  // Stripe redirects back with ?connect=success (onboarding complete) or
  // ?connect=refresh (onboarding abandoned / link expired).
  // We fire a sync BEFORE the page data load so the returned connectStatus
  // reflects the freshest Stripe state.
  const connectParam = url.searchParams.get('connect');
  let connectReturnBanner: 'success' | 'refresh' | null = null;

  if (connectParam === 'success') {
    try {
      await api.connect.syncMyStatus();
    } catch {
      // Non-fatal — page will still load, connect status from next call
    }
    connectReturnBanner = 'success';
  } else if (connectParam === 'refresh') {
    connectReturnBanner = 'refresh';
  }

  // ── Critical: connect status (awaited — drives page structure) ────────────
  const connectStatus = await api.connect.getMyStatus().catch(() => null);

  // ── Streamed: earnings summary + payouts ──────────────────────────────────
  const earningsSummary = api.subscription
    .getMyEarningsSummary(new URLSearchParams())
    .catch(() => null);

  const payoutsParams = new URLSearchParams();
  payoutsParams.set('status', 'all');
  payoutsParams.set('source', 'all');
  payoutsParams.set('page', '1');
  payoutsParams.set('limit', '20');
  const payouts = api.subscription
    .getMyPayouts(payoutsParams)
    .catch(() => null);

  return {
    connectStatus,
    connectReturnBanner,
    earningsSummary,
    payouts,
  };
};
