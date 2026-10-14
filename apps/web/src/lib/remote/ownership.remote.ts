/**
 * Organisation Ownership Transfer Remote Functions (Codex-2hxff.2)
 *
 * Wraps the organization-api `/api/organizations/:id/ownership` routes. One
 * owner per organisation: the owner offers ownership to an active admin or
 * creator, who accepts or declines; offers expire after 7 days. The contract is
 * `docs/handover/payments-sources/ownership-transfer/api-contract.md`.
 *
 * Every command refreshes `getOwnership` AND `getMyMembership` server-side, so
 * the new state rides back on the command response (single-flight). That does
 * NOT reach the studio layout: its membership read uses the raw API client (see
 * `studio/+layout.server.ts`), so a caller whose ROLE changes — the recipient on
 * accept, or a creator whose offer closes — must also
 * `invalidate('cache:studio')`.
 *
 * Every call forwards a worker 4xx with its `code` (see
 * `forwardClientErrors`); the card maps the codes to copy.
 *
 * The offer body is the worker's own `offerOwnershipSchema`, extended with the
 * org id this remote routes on, so the two can never drift. The server
 * re-validates either way.
 */

import { offerOwnershipSchema } from '@codex/validation';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { forwardClientErrors } from '$lib/server/forward-client-errors';
import { getMyMembership } from './org.remote';

// ─── Schemas ──────────────────────────────────────────────────────────────

const organizationIdSchema = z.string().uuid();

// `recipientUserId` is a BetterAuth nanoid, not a UUID, and the worker's schema
// rightly validates it as a trimmed non-empty string.
const offerOwnershipArgsSchema = offerOwnershipSchema.extend({
  organizationId: organizationIdSchema,
});

const offerActionArgsSchema = z.object({
  organizationId: organizationIdSchema,
  offerId: z.string().uuid(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function api() {
  const { platform, cookies } = getRequestEvent();
  return createServerApi(platform, cookies);
}

/**
 * Re-run both reads the ownership surfaces depend on. A failed refresh must not
 * fail a mutation that already committed, so each is best-effort — the card
 * refreshes its own query again on its next render if this misses.
 */
async function refreshOwnershipReads(organizationId: string): Promise<void> {
  await Promise.all([
    getOwnership(organizationId)
      .refresh()
      .catch(() => {}),
    getMyMembership(organizationId)
      .refresh()
      .catch(() => {}),
  ]);
}

// ─── Queries ──────────────────────────────────────────────────────────────

/**
 * The Ownership card's view for the caller. A member or subscriber gets 403
 * (`FORBIDDEN`) — the studio guard keeps them out, so in practice the card is
 * only ever rendered for an owner, an admin, or an offer's recipient.
 */
export const getOwnership = query(
  organizationIdSchema,
  async (organizationId) =>
    forwardClientErrors(() => api().ownership.get(organizationId))
);

// ─── Commands ─────────────────────────────────────────────────────────────

/** Owner: offer ownership to an active admin or creator. */
export const offerOwnership = command(
  offerOwnershipArgsSchema,
  async ({ organizationId, recipientUserId, confirmName }) => {
    const offer = await forwardClientErrors(() =>
      api().ownership.offer(organizationId, { recipientUserId, confirmName })
    );
    await refreshOwnershipReads(organizationId);
    return offer;
  }
);

/** Owner: cancel the open offer. */
export const withdrawOwnershipOffer = command(
  offerActionArgsSchema,
  async ({ organizationId, offerId }) => {
    const offer = await forwardClientErrors(() =>
      api().ownership.withdraw(organizationId, offerId)
    );
    await refreshOwnershipReads(organizationId);
    return offer;
  }
);

/** Recipient: accept. The caller becomes the owner; the old owner an admin. */
export const acceptOwnershipOffer = command(
  offerActionArgsSchema,
  async ({ organizationId, offerId }) => {
    const accepted = await forwardClientErrors(() =>
      api().ownership.accept(organizationId, offerId)
    );
    await refreshOwnershipReads(organizationId);
    return accepted;
  }
);

/** Recipient: decline. Ownership is unchanged. */
export const declineOwnershipOffer = command(
  offerActionArgsSchema,
  async ({ organizationId, offerId }) => {
    const offer = await forwardClientErrors(() =>
      api().ownership.decline(organizationId, offerId)
    );
    await refreshOwnershipReads(organizationId);
    return offer;
  }
);
